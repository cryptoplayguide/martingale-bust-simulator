# martingale-bust-simulator

Small, dependency-free JavaScript package for Martingale recovery progressions, exact finite-session losing-streak probabilities, and seedable Monte Carlo simulation. Runs in Node.js 18+ and modern browsers; MIT licensed.

For an interactive explanation, see the [risk of ruin simulator](https://cryptoplay.guide/tools/risk-of-ruin-simulator/).

## Install from git

Replace `<repository-clone-url>` with this repository's HTTPS clone URL:

```sh
npm install 'git+<repository-clone-url>'
```

Or clone the source to run the examples and tests directly:

```sh
git clone <repository-clone-url> martingale-bust-simulator
cd martingale-bust-simulator
npm test
```

There are no runtime or development dependencies and no registry publishing configuration.

## Model

Inputs are `bankroll` (finite, >= 0), `baseBet` (finite, > 0), `winProbability` (0..1), `payout` (finite, > 1; default 2), `tableMax` (>= 0; default Infinity), and `rounds` (nonnegative safe integer). Outcomes are independent binary wins/losses with constant probability. There are no pushes, fees, bet increments, or rounded stakes.

**Payout is the gross return including the stake.** A winning stake of 1 with payout 2 earns net profit 1. After `k` consecutive losses, the next stake is:

```text
growth = payout / (payout - 1)
stake(k) = baseBet * growth^k
total losses after L bets = baseBet * (growth^L - 1) / (growth - 1)
```

A win recovers that cycle's losses, earns `baseBet * (payout - 1)`, and resets the next stake to `baseBet`. Payout 2 is ordinary doubling; other payouts use the recovery growth above.

`maxConsecutiveLosses` returns the number **L of losing bets that can be placed**, checking both their cumulative cost against the starting bankroll and each stake against the table maximum. After L losses the next required bet cannot be placed: that is a bust, even if money remains. With bankroll 7, base bet 1, payout 2, and no table limit, L = 3 (stakes 1, 2, 4). A table maximum of 2 reduces L to 2. If the first bet cannot be placed, L = 0 and the session is immediately busted, including a zero-round session.

Two simulation models make the treatment of profits explicit:

- **`streak` (default):** stop at the first run of L losses, keeping L fixed from the starting bankroll. This measures exactly the same event as the dynamic programming calculation. It does not track an ending cash balance.
- **`bankroll`:** carry all gains and losses forward and stop when the next recovery bet exceeds the current balance or table maximum. This also checks the next bet after the final scheduled outcome. Earlier profits may allow a longer run of losses, so this simulation need not agree with the fixed-threshold exact probability. No exact evolving-bankroll calculation is claimed.

The exact calculation tracks probability at each surviving current streak length and absorbs mass when L losses are reached. This counts overlapping streaks once; it does not treat possible streak windows as independent. Time is O(rounds × L), memory O(L), with immediate returns for impossible streaks and deterministic outcomes. Large inputs can be expensive.

“Exact” describes the probability model and recurrence, not arbitrary-precision arithmetic. All calculations use JavaScript floating-point numbers; monetary boundaries can be affected by rounding, and extremely small probabilities can underflow. Capacities beyond the safe integer range are rejected. This is an educational model, not a guarantee of an operator's rules or your outcome.

## Library usage

```js
import {
  maxConsecutiveLosses,
  exactBustProbability,
  exactStreakProbability,
  simulateSessions
} from 'martingale-bust-simulator';

const options = {
  bankroll: 7,
  baseBet: 1,
  winProbability: 0.5,
  payout: 2,
  tableMax: 100,
  rounds: 5
};

console.log(maxConsecutiveLosses(options)); // 3
console.log(exactBustProbability(options)); // 0.25
console.log(exactStreakProbability({
  rounds: 3, winProbability: 0.5, maxLosses: 2
})); // 0.375

const sampled = simulateSessions({ ...options, sessions: 100000, seed: 42 });
console.log(sampled.bustProbability); // sampled estimate, not an exact result

const cash = simulateSessions({
  ...options, sessions: 100000, seed: 42, model: 'bankroll'
});
console.log(cash.meanEndingBankroll);
```

When using a clone, change the import to `./src/index.js`. Browsers can import that same file from a server with `<script type="module">`; the library has no Node imports or I/O. Inputs are not mutated. Repeating `simulateSessions` with identical options produces identical output, without reading global randomness.

`simulateSessions` requires a positive safe-integer `sessions` count. `seed` defaults to 0 and must be an integer from 0 through 4294967295. Each call creates a fresh Mulberry32 stream, shared across its sessions; it is deterministic and is not a cryptographic random generator. Results contain `model`, `seed`, `sessions`, `maxLosses`, `busts`, `bustProbability`, and `meanRoundsPlayed`. Bankroll mode also returns `meanEndingBankroll`. Sessions stop at a bust or their round limit. Estimates vary by seed and sample size and have sampling error.

For a single session, supply an explicit random stream. The returned generator owns its local state; consuming it advances that stream, without changing any global state:

```js
import { createSeededRng, simulateSession } from 'martingale-bust-simulator';

const session = simulateSession({
  bankroll: 7, baseBet: 1, winProbability: 0.5,
  rounds: 5, model: 'bankroll'
}, createSeededRng(42));
console.log(session);
// { busted, roundsPlayed, longestLossRun, endingBankroll }
```

Custom RNGs must return finite numbers in [0, 1). Streak-mode session results omit `endingBankroll`. Invalid arguments throw rather than being coerced or silently clamped.

## CLI usage

From a source clone:

```sh
node bin/martingale-bust-simulator.js \
  --bankroll 7 --base-bet 1 --win-probability 0.5 \
  --payout 2 --table-max 100 --rounds 5 --sessions 100000 --seed 42
```

After installing from git, the same options work with the local executable:

```sh
npx --no-install martingale-bust-simulator \
  --bankroll 100 --base-bet 1 --win-probability 0.49 \
  --rounds 100 --sessions 10000 --seed 42 --model bankroll
```

The CLI prints JSON containing `maxConsecutiveLosses`, `exactStreakBustProbability`, and `simulation`. The exact field always refers to the fixed loss-streak event, including when `--model bankroll` is selected. Defaults are payout 2, unlimited table maximum, 10000 sessions, seed 0, and model `streak`. All other inputs are required. Use `--help` for options. Invalid arguments print an error to stderr and exit with status 1. No network requests are made.

## Tests

```sh
npm test
```

Uses Node's built-in test runner. Tests cover affordable bet boundaries, non-even payouts, overlapping streaks, exhaustive small-session enumeration, seeded simulations, evolving balances, invalid inputs, and the CLI.

## Responsible gambling

18+ only. No strategy beats the house edge. Martingale progressions can lead to rapid losses and cannot guarantee recovery. If gambling is causing harm, stop and contact local help resources, such as your local gambling support service, a healthcare professional, or a national gambling helpline.

## License

MIT. Copyright (c) 2026 CryptoPlay Guide.
