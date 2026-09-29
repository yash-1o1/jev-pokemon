import fs from 'node:fs';
import { RetroArchObserver } from '../src/emerald/retroarch.js';
import { readEmeraldPosition } from '../src/emerald/state.js';
import { getAchievementProgress } from '../src/emerald/achievements.js';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function pointerAddress(): number | undefined {
  const raw = option('--save-block-pointer-address');
  if (raw) return parseInt(raw.replace(/^0x/i, ''), 16);
  const path = option('--symbol-file');
  if (!path) return undefined;
  const match = fs.readFileSync(path, 'utf8').match(/^([0-9A-Fa-f]{8})\s+gSaveBlock1Ptr\s*$/m);
  if (!match) throw new Error('gSaveBlock1Ptr not found in symbol file');
  return parseInt(match[1], 16);
}

async function main() {
  const observer = new RetroArchObserver();
  const status = await observer.status();
  if (!status.startsWith('GET_STATUS PLAYING')) throw new Error(`Expected running content: ${status}`);
  console.log(status);

  const address = pointerAddress();
  if (address !== undefined) {
    console.log(JSON.stringify({ position: await readEmeraldPosition(observer, address) }, null, 2));
  } else {
    console.log('Position skipped: provide --symbol-file or --save-block-pointer-address for the exact ROM build.');
  }

  const gameId = Number(option('--game-id'));
  const username = option('--username');
  const apiKey = process.env.RA_WEB_API_KEY;
  if (gameId && username && apiKey) {
    const progress = await getAchievementProgress(gameId, username, apiKey);
    console.log(JSON.stringify(progress, null, 2));
  } else {
    console.log('Achievements skipped: provide --game-id, --username and RA_WEB_API_KEY.');
  }
  console.log('Hardcore activity is not exposed by these read-only commands. Verify it in RetroArch before and after any live experiment.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
