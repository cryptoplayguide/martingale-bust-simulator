import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maxConsecutiveLosses, exactStreakProbability, exactBustProbability,
  createSeededRng, simulateSession, simulateSessions
} from '../src/index.js';

const defaults = { bankroll: 7, baseBet: 1, winProbability: 0.5, rounds: 5 };
const close = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};
const outcomes = (values) => {
  let index = 0;
  return () => {
    assert.ok(index < values.length, 'unexpected extra random draw');
    return values[index++];
  };
};

test('doubling loss capacity includes the final affordable bet', () => {
  for (let losses = 1; losses <= 40; losses++) {
    const bankroll = 2 ** losses - 1;
    assert.equal(maxConsecutiveLosses({ bankroll, baseBet: 1 }), losses);
    assert.equal(maxConsecutiveLosses({ bankroll: bankroll - 0.25, baseBet: 1 }), losses - 1);
  }
  assert.equal(maxConsecutiveLosses({ bankroll: 10, baseBet: 1 }), 3);
  assert.equal(maxConsecutiveLosses({ bankroll: 1023, baseBet: 1 }), 10);
});

test('bankroll, base bet, and table maximum all limit loss capacity', () => {
  assert.equal(maxConsecutiveLosses({ bankroll: 100, baseBet: 5, tableMax: 20 }), 3);
  assert.equal(maxConsecutiveLosses({ bankroll: 100, baseBet: 5, tableMax: 19 }), 2);
  assert.equal(maxConsecutiveLosses({ bankroll: 4, baseBet: 5 }), 0);
  assert.equal(maxConsecutiveLosses({ bankroll: 100, baseBet: 5, tableMax: 4 }), 0);
  assert.equal(maxConsecutiveLosses({ bankroll: 0, baseBet: 1 }), 0);
  assert.equal(maxConsecutiveLosses({ bankroll: 100, baseBet: 1, tableMax: 0 }), 0);
  assert.equal(maxConsecutiveLosses({ bankroll: 1.75, baseBet: 0.25 }), 3);
});

test('gross payouts other than two use a recovery progression', () => {
  // Gross payout 3: 1, 1.5, 2.25. Each win recovers losses and nets 2.
  assert.equal(maxConsecutiveLosses({ bankroll: 4.75, baseBet: 1, payout: 3 }), 3);
  assert.equal(maxConsecutiveLosses({ bankroll: 4.74, baseBet: 1, payout: 3 }), 2);
  assert.equal(maxConsecutiveLosses({ bankroll: 100, baseBet: 1, payout: 3, tableMax: 2.25 }), 3);
  // Gross payout 1.5: 1, 3, 9.
  assert.equal(maxConsecutiveLosses({ bankroll: 13, baseBet: 1, payout: 1.5 }), 3);
  assert.equal(maxConsecutiveLosses({ bankroll: 12, baseBet: 1, payout: 1.5 }), 2);
});

test('capacity search handles large counts and extreme finite scales', () => {
  assert.equal(maxConsecutiveLosses({ bankroll: 1e6, baseBet: 1, payout: 1e12 }), 999999);
  assert.equal(maxConsecutiveLosses({ bankroll: 1e300, baseBet: 1e-300 }), 1993);
  assert.throws(() => maxConsecutiveLosses({ bankroll: 1e300, baseBet: 1, payout: 1e300 }), /safe integer/);
});

test('exact DP agrees with known overlapping-streak probabilities', () => {
  const calculate = (rounds, maxLosses, winProbability = 0.5) =>
    exactStreakProbability({ rounds, maxLosses, winProbability });
  assert.equal(calculate(2, 2), 1 / 4);
  assert.equal(calculate(3, 2), 3 / 8);
  assert.equal(calculate(4, 2), 1 / 2);
  assert.equal(calculate(5, 3), 1 / 4);
  assert.equal(calculate(6, 3), 5 / 16);
  close(calculate(4, 1, 0.7), 1 - 0.7 ** 4);
  close(calculate(4, 4, 0.7), 0.3 ** 4);
  assert.equal(exactBustProbability(defaults), 1 / 4);
  assert.equal(exactBustProbability({ ...defaults, tableMax: 2, rounds: 3 }), 3 / 8);
});

function enumerateProbability(rounds, maxLosses, winProbability) {
  let result = 0;
  for (let sequence = 0; sequence < 2 ** rounds; sequence++) {
    let weight = 1;
    let run = 0;
    let hit = maxLosses === 0;
    for (let round = 0; round < rounds; round++) {
      const won = (sequence & (1 << round)) !== 0;
      weight *= won ? winProbability : 1 - winProbability;
      run = won ? 0 : run + 1;
      if (run >= maxLosses) hit = true;
    }
    if (hit) result += weight;
  }
  return result;
}

test('DP matches independent exhaustive enumeration for small sessions', () => {
  for (const winProbability of [0, 0.2, 0.5, 0.73, 1]) {
    for (let rounds = 0; rounds <= 9; rounds++) {
      for (let maxLosses = 0; maxLosses <= rounds + 1; maxLosses++) {
        close(exactStreakProbability({ rounds, maxLosses, winProbability }),
          enumerateProbability(rounds, maxLosses, winProbability));
      }
    }
  }
});

test('empty sessions, impossible streaks, and deterministic outcomes', () => {
  assert.equal(exactStreakProbability({ rounds: 0, maxLosses: 1, winProbability: 0 }), 0);
  assert.equal(exactStreakProbability({ rounds: 0, maxLosses: 0, winProbability: 1 }), 1);
  assert.equal(exactStreakProbability({ rounds: 5, maxLosses: 6, winProbability: 0 }), 0);
  assert.equal(exactStreakProbability({ rounds: 5, maxLosses: 5, winProbability: 0 }), 1);
  assert.equal(exactStreakProbability({ rounds: 100, maxLosses: 1, winProbability: 1 }), 0);
  assert.equal(exactBustProbability({ ...defaults, bankroll: 0, rounds: 0 }), 1);
});

test('rare streaks retain small probabilities rather than subtracting from one', () => {
  const p = 0.999999;
  const actual = exactStreakProbability({ rounds: 4, maxLosses: 4, winProbability: p });
  assert.ok(actual > 0);
  close(actual / (1 - p) ** 4, 1);
  const longSession = exactStreakProbability({ rounds: 1000, maxLosses: 3, winProbability: 0.2 });
  assert.ok(longSession <= 1 && longSession > 0.999999);
});

test('seeded streams are reproducible, separate, bounded, and allow zero', () => {
  const a = createSeededRng(0);
  const b = createSeededRng(0);
  const c = createSeededRng(1);
  let differs = false;
  for (let index = 0; index < 1000; index++) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
    if (value !== c()) differs = true;
  }
  assert.ok(differs);
  assert.equal(createSeededRng(0xffffffff)(), createSeededRng(0xffffffff)());
});

test('streak simulation resets after wins and stops on the busting loss', () => {
  assert.deepEqual(simulateSession({ ...defaults, rounds: 10 }, outcomes([0.9, 0.9, 0, 0.9, 0.9, 0.9])), {
    busted: true, roundsPlayed: 6, longestLossRun: 3
  });
  assert.deepEqual(simulateSession(defaults, outcomes([0.9, 0.9, 0, 0.9, 0.9])), {
    busted: false, roundsPlayed: 5, longestLossRun: 2
  });
  assert.deepEqual(simulateSession({ ...defaults, rounds: 3 }, () => 0.9), {
    busted: true, roundsPlayed: 3, longestLossRun: 3
  });
});

test('zero-round and initially unplayable sessions draw no randomness', () => {
  const noDraw = () => { assert.fail('unexpected draw'); };
  for (const model of ['streak', 'bankroll']) {
    assert.equal(simulateSession({ ...defaults, rounds: 0, model }, noDraw).busted, false);
    const initialBust = simulateSession({ ...defaults, bankroll: 0, rounds: 0, model }, noDraw);
    assert.equal(initialBust.busted, true);
    assert.equal(initialBust.roundsPlayed, 0);
  }
});

test('bankroll mode recovers cycle losses and resets stake on a win', () => {
  const result = simulateSession({ ...defaults, payout: 3, model: 'bankroll', rounds: 4 },
    outcomes([0.9, 0.9, 0, 0]));
  assert.deepEqual(result, { busted: false, roundsPlayed: 4, longestLossRun: 2, endingBankroll: 11 });
});

test('bankroll mode counts an unaffordable next bet as bust, including the last round', () => {
  assert.deepEqual(simulateSession({ ...defaults, bankroll: 10, rounds: 3, model: 'bankroll' }, () => 0.9), {
    busted: true, roundsPlayed: 3, longestLossRun: 3, endingBankroll: 3
  });
  assert.deepEqual(simulateSession({ ...defaults, bankroll: 100, tableMax: 2, model: 'bankroll' }, () => 0.9), {
    busted: true, roundsPlayed: 2, longestLossRun: 2, endingBankroll: 97
  });
});

test('accumulated profits can make bankroll mode differ from the fixed threshold', () => {
  const options = { ...defaults, bankroll: 3, rounds: 6 };
  const values = [0, 0, 0, 0, 0.9, 0.9];
  assert.equal(simulateSession(options, outcomes(values)).busted, true);
  const actual = simulateSession({ ...options, model: 'bankroll' }, outcomes(values));
  assert.equal(actual.busted, false);
  assert.equal(actual.endingBankroll, 4);
});

test('Monte Carlo output is reproducible and input options are unchanged', () => {
  const options = Object.freeze({ ...defaults, sessions: 1000, seed: 42 });
  const a = simulateSessions(options);
  assert.deepEqual(a, simulateSessions(options));
  assert.notEqual(a.busts, simulateSessions({ ...options, seed: 43 }).busts);
  assert.equal(a.model, 'streak');
  assert.equal(a.maxLosses, 3);
  assert.equal(a.bustProbability, a.busts / 1000);
  assert.ok(a.meanRoundsPlayed > 0 && a.meanRoundsPlayed <= defaults.rounds);
});

test('seeded Monte Carlo agrees with the exact streak calculation', () => {
  const options = { ...defaults, rounds: 12, winProbability: 0.57, sessions: 80000, seed: 123456 };
  close(simulateSessions(options).bustProbability, exactBustProbability(options), 0.008);
});

test('deterministic simulation summaries are exact in both models', () => {
  for (const model of ['streak', 'bankroll']) {
    const wins = simulateSessions({ ...defaults, winProbability: 1, sessions: 8, model });
    assert.equal(wins.busts, 0);
    assert.equal(wins.meanRoundsPlayed, 5);
    if (model === 'bankroll') assert.equal(wins.meanEndingBankroll, 12);
    const losses = simulateSessions({ ...defaults, winProbability: 0, sessions: 8, model });
    assert.equal(losses.bustProbability, 1);
    assert.equal(losses.meanRoundsPlayed, 3);
    if (model === 'bankroll') assert.equal(losses.meanEndingBankroll, 0);
  }
});

test('large finite balances do not overflow when averaging sessions', () => {
  const options = { ...defaults, bankroll: 1e308, rounds: 0, sessions: 4, model: 'bankroll' };
  assert.equal(simulateSessions(options).meanEndingBankroll, 1e308);
});

test('an overflowing next stake is a bust, while overflowing winnings are rejected', () => {
  const options = { ...defaults, bankroll: 1e308, baseBet: 1e308, rounds: 1, model: 'bankroll' };
  const result = simulateSession(options, () => 0.9);
  assert.equal(result.busted, true);
  assert.equal(result.endingBankroll, 0);
  assert.throws(() => simulateSession(options, () => 0), /finite number/);
});

test('invalid financial inputs are rejected rather than coerced', () => {
  for (const patch of [
    { bankroll: -1 }, { bankroll: Infinity }, { bankroll: NaN }, { bankroll: '7' },
    { baseBet: 0 }, { baseBet: -1 }, { baseBet: Infinity }, { baseBet: null },
    { payout: 1 }, { payout: 0 }, { payout: NaN }, { payout: Infinity },
    { tableMax: -1 }, { tableMax: NaN }, { tableMax: '10' }, { tableMax: null }
  ]) {
    assert.throws(() => maxConsecutiveLosses({ ...defaults, ...patch }), RangeError);
    assert.throws(() => simulateSessions({ ...defaults, sessions: 1, ...patch }), RangeError);
  }
});

test('invalid probabilities and counts are consistently rejected', () => {
  for (const winProbability of [-0.1, 1.1, NaN, Infinity, '0.5', undefined]) {
    assert.throws(() => exactBustProbability({ ...defaults, winProbability }), RangeError);
    assert.throws(() => simulateSessions({ ...defaults, sessions: 1, winProbability }), RangeError);
  }
  for (const rounds of [-1, 1.5, NaN, Infinity, '5', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => exactBustProbability({ ...defaults, rounds }), RangeError);
    assert.throws(() => simulateSessions({ ...defaults, sessions: 1, rounds }), RangeError);
  }
  for (const maxLosses of [-1, 1.5, Infinity, '3']) {
    assert.throws(() => exactStreakProbability({ rounds: 5, winProbability: 0.5, maxLosses }), RangeError);
  }
  for (const sessions of [0, -1, 1.5, NaN, Infinity, '10']) {
    assert.throws(() => simulateSessions({ ...defaults, sessions }), RangeError);
  }
  for (const seed of [-1, 1.5, 2 ** 32, NaN, Infinity, '1']) {
    assert.throws(() => createSeededRng(seed), RangeError);
    assert.throws(() => simulateSessions({ ...defaults, sessions: 1, seed }), RangeError);
  }
  assert.throws(() => simulateSessions({ ...defaults, sessions: 1, model: 'unknown' }), /model/);
});

test('injected random streams must return values in [0, 1)', () => {
  assert.throws(() => simulateSession(defaults), /rng/);
  for (const value of [-0.1, 1, NaN, Infinity, '0.5', undefined]) {
    assert.throws(() => simulateSession(defaults, () => value), /rng/);
  }
});
