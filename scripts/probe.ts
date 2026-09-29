import fs from 'node:fs';
import { RetroArchObserver } from '../src/platform/retroarch.js';
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
    console.log('Development only: npm run probe -- [--read 0x02000000:16] [--game emerald --symbol-file FILE]');
    return;
  }

  if (process.argv.includes('--game-id') || process.argv.includes('--username'))
    throw new Error('Achievement lookup is separate. Use npm run achievements.');

  const game = option('--game');
  if (game && game !== 'emerald') throw new Error(`No decoder for game: ${game}`);
  const observer = new RetroArchObserver();
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
