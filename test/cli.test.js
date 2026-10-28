import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../bin/cli.js';
import { exactBustProbability, simulateSessions } from '../src/index.js';

const required = ['--bankroll', '7', '--base-bet', '1', '--win-probability', '0.5', '--rounds', '5'];
const run = runCli;

test('CLI prints reproducible JSON consistent with the library', () => {
  const args = [...required, '--sessions', '1000', '--seed', '42'];
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  const options = { bankroll: 7, baseBet: 1, winProbability: 0.5, rounds: 5, sessions: 1000, seed: 42 };
  assert.equal(output.maxConsecutiveLosses, 3);
  assert.equal(output.exactStreakBustProbability, exactBustProbability(options));
  assert.deepEqual(output.simulation, simulateSessions(options));
  assert.equal(run(args).stdout, result.stdout);
});

test('CLI handles bankroll mode, payout, table maximum, and scientific notation', () => {
  const result = run([...required, '--model', 'bankroll', '--payout', '3', '--table-max', '1.5e0', '--sessions', '20']);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.maxConsecutiveLosses, 2);
  assert.equal(output.simulation.model, 'bankroll');
  assert.equal(typeof output.simulation.meanEndingBankroll, 'number');
  assert.equal(run([...required, '--table-max', 'Infinity']).status, 0);
});

test('CLI help exits successfully without required arguments', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /gross|Gross/);
  assert.equal(result.stderr, '');
});

test('CLI rejects missing, malformed, duplicate, and unknown arguments', () => {
  for (const args of [
    [], ['--bankroll'], [...required, '--seed'], [...required, '--seed', '--model', 'streak'],
    [...required, '--unknown', '1'], [...required, '--rounds', '6'],
    [...required, '--seed', 'NaN'], [...required, '--seed', '0x10'],
    [...required, '--seed', ''], [...required, '--seed', '1x'],
    [...required, '--sessions', '0'], [...required, '--sessions', '1.5'],
    [...required, '--payout', '1'], [...required, '--model', 'other'],
    [...required, '--help'], ['positional'],
    ['--bankroll', '-1', ...required.slice(2)]
  ]) {
    const result = run(args);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, /^Error:/);
    assert.equal(result.stdout, '');
  }
});
