import { exactBustProbability, maxConsecutiveLosses, simulateSessions } from '../src/index.js';

const help = `Usage: martingale-bust-simulator [options]

Required:
  --bankroll NUMBER          Starting funds (>= 0)
  --base-bet NUMBER          Initial stake (> 0)
  --win-probability NUMBER   Independent win probability (0..1)
  --rounds INTEGER           Session length (>= 0)

Optional:
  --payout NUMBER            Gross return including stake (default: 2)
  --table-max NUMBER         Maximum stake (default: Infinity)
  --sessions INTEGER         Monte Carlo sessions (default: 10000)
  --seed INTEGER             uint32 seed (default: 0)
  --model streak|bankroll    Simulation model (default: streak)
  --help                    Show this help

Prints JSON. Exact probability always uses the fixed loss-streak threshold.
Bankroll mode carries winnings forward; its probability can differ.
`;

const names = {
  '--bankroll': 'bankroll', '--base-bet': 'baseBet',
  '--win-probability': 'winProbability', '--rounds': 'rounds',
  '--payout': 'payout', '--table-max': 'tableMax',
  '--sessions': 'sessions', '--seed': 'seed', '--model': 'model'
};

function execute(args) {
  if (args.includes('--help')) {
    if (args.length !== 1) throw new Error('--help must be used alone');
    return help;
  }
  const options = { sessions: 10000, seed: 0, model: 'streak' };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!Object.hasOwn(names, flag)) throw new Error(`Unknown option: ${flag}`);
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    const value = args[++index];
    if (value === undefined || value.startsWith('--') || value.trim() === '') {
      throw new Error(`Missing value for ${flag}`);
    }
    if (flag === '--model') options.model = value;
    else if (flag === '--table-max' && value === 'Infinity') options.tableMax = Infinity;
    else {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
        throw new Error(`Invalid number for ${flag}: ${value}`);
      }
      options[names[flag]] = Number(value);
    }
  }
  for (const flag of ['--bankroll', '--base-bet', '--win-probability', '--rounds']) {
    if (!seen.has(flag)) throw new Error(`Required option: ${flag}`);
  }
  const result = {
    maxConsecutiveLosses: maxConsecutiveLosses(options),
    exactStreakBustProbability: exactBustProbability(options),
    simulation: simulateSessions(options)
  };
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** Parse arguments and run the CLI without process-global reads or writes. */
export function runCli(args) {
  try {
    return { status: 0, stdout: execute(args), stderr: '' };
  } catch (error) {
    return { status: 1, stdout: '', stderr: `Error: ${error.message}\nUse --help for usage.\n` };
  }
}
