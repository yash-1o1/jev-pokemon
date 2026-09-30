import fs from 'node:fs';
import { RetroArchObserver } from '../src/platform/retroarch.js';
import { launchRetroArch } from '../src/platform/launch.js';
import { loadProbeConfig } from '../src/platform/config.js';
import { readEmeraldPosition } from '../src/emerald/state.js';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function options(name: string): string[] {
  return process.argv.flatMap((arg, index) => arg === name ? [process.argv[index + 1] ?? ''] : []);
}

function address(value: string): number {
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) throw new Error(`Invalid address: ${value}`);
  return Number(value);
}

function emeraldPointerAddress(): number {
  const raw = option('--save-block-pointer-address');
  if (raw) return address(raw);
  const path = option('--symbol-file');
  if (!path) throw new Error('Emerald needs --symbol-file or --save-block-pointer-address for the exact ROM build');
  const match = fs.readFileSync(path, 'utf8').match(/^([0-9A-Fa-f]{8})\s+gSaveBlock1Ptr\s*$/m);
  if (!match) throw new Error('gSaveBlock1Ptr not found in symbol file');
  return parseInt(match[1], 16);
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Development only: npm run probe -- [--config FILE] [--retroarch EXE --core LIBRETRO_CORE --rom ROM] [--read 0x02000000:16] [--game emerald --symbol-file FILE]');
    return;
  }

  if (process.argv.includes('--game-id') || process.argv.includes('--username'))
    throw new Error('Achievement lookup is separate. Use npm run achievements.');

  const game = option('--game');
  if (game && game !== 'emerald') throw new Error(`No decoder for game: ${game}`);
  const observer = new RetroArchObserver();
  const launchArgs = ['--retroarch', '--core', '--rom'];
  const supplied = launchArgs.filter(arg => process.argv.includes(arg));
  if (supplied.length > 0 && supplied.length !== launchArgs.length)
    throw new Error('To launch RetroArch, provide --retroarch, --core, and --rom together.');
  let launchPaths;
  if (supplied.length === launchArgs.length) {
    const retroarch = option('--retroarch');
    const core = option('--core');
    const rom = option('--rom');
    if (!retroarch || !core || !rom || [retroarch, core, rom].some(value => value.startsWith('--')))
      throw new Error('Launch paths cannot be empty.');
    launchPaths = { retroarch, core, rom };
  } else {
    launchPaths = loadProbeConfig(option('--config') ?? 'config.local.json', process.argv.includes('--config'));
  }
  if (launchPaths) await launchRetroArch(launchPaths, observer);
  const status = await observer.status();
  if (!/^GET_STATUS (PLAYING|PAUSED)\b/.test(status)) throw new Error(`No running content: ${status}`);
  console.log(status);

  for (const spec of options('--read')) {
    const match = spec.match(/^(0x[0-9a-f]+|[0-9]+):([0-9]+)$/i);
    if (!match) throw new Error(`Invalid read request: ${spec}; use ADDRESS:LENGTH`);
    const start = address(match[1]);
    const length = Number(match[2]);
    const bytes = await observer.readMemory(start, length);
    console.log(JSON.stringify({ address: `0x${start.toString(16)}`, hex: bytes.toString('hex') }));
  }

  if (game === 'emerald') {
    console.log(JSON.stringify({ emerald: await readEmeraldPosition(observer, emeraldPointerAddress()) }, null, 2));
  }

  console.log('Development probe only. Do not use it to drive a RetroAchievements achievement run.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
