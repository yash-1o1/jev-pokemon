import { getAchievementProgress } from '../src/integrations/retroachievements.js';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm run achievements -- --game-id ID --username NAME (RA_WEB_API_KEY must be set)');
    return;
  }
  const gameId = Number(option('--game-id'));
  const username = option('--username');
  const key = process.env.RA_WEB_API_KEY;
  if (!gameId || !username || !key)
    throw new Error('Provide --game-id, --username, and RA_WEB_API_KEY');
  const progress = await getAchievementProgress(gameId, username, key);
  console.log(JSON.stringify(progress, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
