/**
 * Independent binary outcomes, gross payouts, and unrounded recovery bets.
 * No platform APIs, global random state, or I/O are used by this module.
 */

function finite(name, value, minimum, inclusive = true) {
  if (typeof value !== 'number' || !Number.isFinite(value) ||
      (inclusive ? value < minimum : value <= minimum)) {
    throw new RangeError(`${name} must be a finite number ${inclusive ? '>=' : '>'} ${minimum}`);
  }
  return value;
}

function integer(name, value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function probability(value) {
  finite('winProbability', value, 0);
  if (value > 1) throw new RangeError('winProbability must be <= 1');
  return value;
}

function progression(options) {
  const { bankroll, baseBet, payout = 2, tableMax = Infinity } = options;
  finite('bankroll', bankroll, 0);
  finite('baseBet', baseBet, 0, false);
  finite('payout', payout, 1, false);
  if (tableMax !== Infinity) finite('tableMax', tableMax, 0);
  return { bankroll, baseBet, payout, tableMax };
}

function logExpm1(value) {
  return value > 50 ? value + Math.log1p(-Math.exp(-value)) : Math.log(Math.expm1(value));
}

/**
 * Number of consecutive losing bets that can be placed before the next bet
 * exceeds the starting bankroll or table maximum. Zero means no initial bet.
 * Payout is the gross return: payout=2 gives stakes b, 2b, 4b, ... .
 */
export function maxConsecutiveLosses(options) {
  const { bankroll, baseBet, payout, tableMax } = progression(options);
  if (baseBet > bankroll || baseBet > tableMax) return 0;
  const growth = 1 + 1 / (payout - 1);
  const logGrowth = Math.log1p(1 / (payout - 1));

  function affordable(count) {
    if (count === 0) return true;
    // Powers give exact integer boundaries for ordinary doubling progressions.
    // log1p/expm1 preserve precision for growth factors close to one.
    const power = Math.pow(growth, count);
    const sum = growth >= 1.01
      ? baseBet * ((power - 1) / (growth - 1))
      : baseBet * (Math.expm1(count * logGrowth) * (payout - 1));
    const stake = baseBet * (growth >= 1.01
      ? Math.pow(growth, count - 1)
      : Math.exp((count - 1) * logGrowth));
    const fitsBankroll = Number.isFinite(sum) && sum > 0
      ? sum <= bankroll
      : Math.log(baseBet) + logExpm1(count * logGrowth) + Math.log(payout - 1) <= Math.log(bankroll);
    const fitsTable = tableMax === Infinity || (Number.isFinite(stake) && stake > 0
      ? stake <= tableMax
      : Math.log(baseBet) + (count - 1) * logGrowth <= Math.log(tableMax));
    return fitsBankroll && fitsTable;
  }

  // Exponential search followed by binary search avoids a loop per loss level.
  let low = 0;
  let high = 1;
  while (affordable(high)) {
    low = high;
    if (high === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('loss capacity exceeds the safe integer range');
    }
    high = Math.min(Number.MAX_SAFE_INTEGER, high * 2);
  }
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (affordable(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * Exact finite-session probability of at least one run of maxLosses losses.
 * DP tracks surviving probability at each current loss-run length, so
 * overlapping streaks are counted once. "Exact" means no sampling or
 * independence approximation; arithmetic still uses JavaScript numbers.
 */
export function exactStreakProbability({ rounds, winProbability, maxLosses }) {
  integer('rounds', rounds);
  probability(winProbability);
  integer('maxLosses', maxLosses);
  if (maxLosses === 0) return 1;
  if (rounds < maxLosses || winProbability === 1) return 0;
  if (winProbability === 0) return 1;
  const lossProbability = 1 - winProbability;
  const states = new Float64Array(maxLosses);
  states[0] = 1;
  let busted = 0;
  for (let round = 0; round < rounds; round++) {
    let surviving = 0;
    for (let run = 0; run < maxLosses; run++) surviving += states[run];
    busted += states[maxLosses - 1] * lossProbability;
    for (let run = maxLosses - 1; run > 0; run--) {
      states[run] = states[run - 1] * lossProbability;
    }
    states[0] = surviving * winProbability;
  }
  return Math.min(1, Math.max(0, busted));
}

/** Exact probability of reaching the fixed starting-bankroll loss capacity. */
export function exactBustProbability(options) {
  return exactStreakProbability({
    rounds: options.rounds,
    winProbability: options.winProbability,
    maxLosses: maxConsecutiveLosses(options)
  });
}

/** Return a fresh deterministic Mulberry32 stream. Seed is a uint32. */
export function createSeededRng(seed) {
  integer('seed', seed);
  if (seed > 0xffffffff) throw new RangeError('seed must be a uint32 (0..4294967295)');
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sessionSettings(options) {
  const settings = progression(options);
  const { rounds, winProbability, model = 'streak' } = options;
  integer('rounds', rounds);
  probability(winProbability);
  if (model !== 'streak' && model !== 'bankroll') {
    throw new RangeError('model must be "streak" or "bankroll"');
  }
  return { ...settings, rounds, winProbability, model, maxLosses: maxConsecutiveLosses(settings) };
}

function draw(rng) {
  const value = rng();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('rng must return a finite number in [0, 1)');
  }
  return value;
}

function runSession(settings, rng) {
  const { baseBet, payout, tableMax, rounds, winProbability, model, maxLosses } = settings;
  let bankroll = settings.bankroll;
  let stake = baseBet;
  let cycleLosses = 0;
  let lossRun = 0;
  let longestLossRun = 0;
  let roundsPlayed = 0;
  let busted = maxLosses === 0;
  while (!busted && roundsPlayed < rounds) {
    const won = draw(rng) < winProbability;
    roundsPlayed++;
    lossRun = won ? 0 : lossRun + 1;
    longestLossRun = Math.max(longestLossRun, lossRun);
    if (model === 'streak') {
      busted = lossRun >= maxLosses;
    } else {
      if (won) {
        bankroll += stake * (payout - 1);
        cycleLosses = 0;
        stake = baseBet;
      } else {
        bankroll -= stake;
        cycleLosses += stake;
        stake = baseBet + cycleLosses / (payout - 1);
      }
      if (!Number.isFinite(bankroll)) {
        throw new RangeError('bankroll exceeds finite number precision');
      }
      busted = stake > bankroll || stake > tableMax;
    }
  }
  const result = { busted, roundsPlayed, longestLossRun };
  if (model === 'bankroll') result.endingBankroll = bankroll;
  return result;
}

/**
 * Simulate one session using an explicit RNG. This has no hidden randomness;
 * pass createSeededRng(seed) or a deterministic stream of outcomes.
 */
export function simulateSession(options, rng) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
  return runSession(sessionSettings(options), rng);
}

/** Simulate independent sessions using a fresh seeded stream on every call. */
export function simulateSessions(options) {
  const { sessions, seed = 0 } = options;
  integer('sessions', sessions, 1);
  const settings = sessionSettings(options);
  const rng = createSeededRng(seed);
  let busts = 0;
  let totalRoundsPlayed = 0;
  let meanEndingBankroll = 0;
  for (let session = 0; session < sessions; session++) {
    const result = runSession(settings, rng);
    if (result.busted) busts++;
    totalRoundsPlayed += result.roundsPlayed;
    if (settings.model === 'bankroll') {
      meanEndingBankroll += (result.endingBankroll - meanEndingBankroll) / (session + 1);
    }
  }
  const result = {
    model: settings.model, seed, sessions, maxLosses: settings.maxLosses,
    busts, bustProbability: busts / sessions,
    meanRoundsPlayed: totalRoundsPlayed / sessions
  };
  if (settings.model === 'bankroll') result.meanEndingBankroll = meanEndingBankroll;
  return result;
}
