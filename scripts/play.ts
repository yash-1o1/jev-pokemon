import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameChoices, loadProbeConfig } from '../src/platform/config.js';
import { createDevelopmentProfile, assertDevelopmentProfile, createAchievementProfile, assertAchievementProfile } from '../src/platform/dev-profile.js';
import { launchRetroArch } from '../src/platform/launch.js';
import { RetroArchObserver } from '../src/platform/retroarch.js';
import { pressButton, pressButtons, type Button } from '../src/platform/input.js';
import { findDevelopmentRetroArch } from '../src/platform/process.js';
import { observeGame, EMERALD_SAVE_BLOCK_POINTER } from '../src/game/observe.js';
import { chooseAction, GAME_MODEL, TERRA_MODEL, type Backend, type Controller, type StepRecord } from '../src/decisions/decision.js';
import { DAILY_FREE_TOKEN_LIMIT, DailyQuotaReachedError, millisecondsUntilUtcReset, readDailyUsage, readTotalDailyUsage, REQUEST_TOKEN_RESERVE } from '../src/decisions/quota.js';

function loadLocalApiKey(): void {
  if (process.env.OPENAI_API_KEY) return;
  const keyFile = path.resolve('.local/openai-api-key.txt');
  if (fs.existsSync(keyFile)) process.env.OPENAI_API_KEY = fs.readFileSync(keyFile, 'utf8').trim();
}

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForDailyQuotaReset(observer: RetroArchObserver): Promise<void> {
  const quotaDate = readDailyUsage().dateUtc;
  const pauseMarker = path.resolve('.local/ra-run/quota-paused-utc-date.txt');
  const before = await observer.status();
  const markedDate = fs.existsSync(pauseMarker) ? fs.readFileSync(pauseMarker, 'utf8').trim() : '';
  const pauseByRunner = before.includes(' PLAYING ');
  const resumePausedGame = pauseByRunner || (before.includes(' PAUSED ') && markedDate === quotaDate);
  if (pauseByRunner) await observer.togglePause();
  if (resumePausedGame) {
    fs.mkdirSync(path.dirname(pauseMarker), { recursive: true });
    fs.writeFileSync(pauseMarker, quotaDate + '\n');
  }
  const resetAt = new Date(Date.now() + millisecondsUntilUtcReset());
  console.log(`Daily free-token safety limit reached. RetroArch is ${resumePausedGame ? 'paused for the cap' : 'left in its current state'}; waiting until ${resetAt.toISOString()} UTC before continuing.`);
  while (new Date().toISOString().slice(0, 10) === quotaDate) {
    await sleep(Math.min(60_000, millisecondsUntilUtcReset()));
  }
  if (resumePausedGame) {
    const after = await observer.status();
    if (after.includes(' PAUSED ')) await observer.togglePause();
    if (fs.existsSync(pauseMarker)) fs.rmSync(pauseMarker, { force: true });
  }
  console.log('Daily token allowance has reset; resuming the game loop.');
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function integerOption(name: string, fallback: number, min: number, max: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

function emeraldPointerAddress(): number {
  const raw = option('--save-block-pointer-address');
  if (raw) {
    if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(raw)) throw new Error(`Invalid address: ${raw}`);
    return Number(raw);
  }
  const symbolFile = option('--symbol-file');
  if (symbolFile) {
    const match = fs.readFileSync(symbolFile, 'utf8').match(/^([0-9A-Fa-f]{8})\s+gSaveBlock1Ptr\s*$/m);
    if (!match) throw new Error('gSaveBlock1Ptr not found in symbol file');
    return parseInt(match[1], 16);
  }
  return EMERALD_SAVE_BLOCK_POINTER;
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm run play -- [--config FILE] [--retroarch-profile FILE] [--game emerald] [--backend hybrid|responses|mock] [--achievements] [--steps 10] [--button-ms 700] [--goal TEXT] [--instructions EXTRA_FILE] [--symbol-file FILE | --save-block-pointer-address ADDRESS] [--check]');
    return;
  }
  const configFile = option('--config') ?? 'config.local.json';
  const paths = loadProbeConfig(configFile, true);
  if (!paths) throw new Error('Config must contain retroarch, core, and rom');
  const gameChoices = loadGameChoices(configFile);
  for (const [label, file] of Object.entries(paths)) {
    if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`);
  }
  const game = option('--game');
  if (game && game !== 'emerald') throw new Error(`No decoder for game: ${game}`);
  const backend = (option('--backend') ?? 'hybrid') as Backend;
  if (backend !== 'hybrid' && backend !== 'responses' && backend !== 'mock') throw new Error('Use --backend hybrid, responses, or mock');
  const achievements = process.argv.includes('--achievements');
  if (achievements && backend === 'mock') throw new Error('Achievement runs require an OpenAI backend');
  if (backend !== 'mock') loadLocalApiKey();
  if (backend !== 'mock' && !process.env.OPENAI_API_KEY && !process.argv.includes('--check'))
    throw new Error('Set OPENAI_API_KEY or save it in .local/openai-api-key.txt, or use --backend mock for an offline smoke test');
  const goal = option('--goal') ?? 'Play the game and make progress';
  if (process.argv.includes('--instructions') && !option('--instructions'))
    throw new Error('--instructions needs a file path');
  const baseInstructionsFile = fileURLToPath(new URL('../instructions/base.md', import.meta.url));
  const baseInstructions = fs.readFileSync(baseInstructionsFile, 'utf8').trim();
  if (!baseInstructions) throw new Error(`Instructions file is empty: ${baseInstructionsFile}`);
  const extraInstructionsFile = option('--instructions') ? path.resolve(option('--instructions')!) : undefined;
  const extraInstructions = extraInstructionsFile ? fs.readFileSync(extraInstructionsFile, 'utf8').trim() : '';
  const achievementRulesFile = fileURLToPath(new URL('../instructions/emerald-achievement-rules.md', import.meta.url));
  const missableLedgerFile = fileURLToPath(new URL('../instructions/emerald-missables.md', import.meta.url));
  const catchListFile = fileURLToPath(new URL('../instructions/emerald-pokemon-catch-list.md', import.meta.url));
  const defaultCheckpointFile = fileURLToPath(new URL('../instructions/emerald-early-checkpoint.md', import.meta.url));
  const localCheckpointFile = path.resolve('.local/ra-run/current-checkpoint.md');
  const lastSaveFile = path.resolve('.local/ra-run/last-save-at.txt');
  const checkpointFile = fs.existsSync(localCheckpointFile) ? localCheckpointFile : defaultCheckpointFile;
  const instructions = [
    baseInstructions,
    achievements && game === 'emerald' ? fs.readFileSync(achievementRulesFile, 'utf8').trim() : '',
    achievements && game === 'emerald' ? fs.readFileSync(missableLedgerFile, 'utf8').trim() : '',
    achievements && game === 'emerald' ? fs.readFileSync(catchListFile, 'utf8').trim() : '',
    achievements && game === 'emerald' ? fs.readFileSync(checkpointFile, 'utf8').trim() : '',
    extraInstructions,
  ].filter(Boolean).join('\n\n');
  const steps = integerOption('--steps', 10, 1, 1000000);
  const buttonDuration = integerOption('--button-ms', 700, 40, 1000);
  const pointerAddress = game === 'emerald' ? emeraldPointerAddress() : undefined;
  const selectedProfile = option('--retroarch-profile');
  const profile = selectedProfile
    ? path.resolve(selectedProfile)
    : achievements ? createAchievementProfile(paths.retroarch) : createDevelopmentProfile(paths.retroarch);
  if (!fs.existsSync(profile)) throw new Error(`RetroArch profile not found: ${profile}`);
  if (achievements) assertAchievementProfile(profile);
  else assertDevelopmentProfile(profile);
  const outputDir = path.resolve(achievements ? '.local/ra-run' : '.local');
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({ paths, profile, baseInstructionsFile, extraInstructionsFile, missableLedgerFile: achievements && game === 'emerald' ? missableLedgerFile : undefined, catchListFile: achievements && game === 'emerald' ? catchListFile : undefined, checkpointFile: achievements && game === 'emerald' ? checkpointFile : undefined, gameChoices, backend, primaryModel: backend === 'hybrid' ? GAME_MODEL : backend === 'responses' ? TERRA_MODEL : 'mock', fallbackModel: backend === 'hybrid' ? TERRA_MODEL : undefined, sharedDailyTokenLimit: backend === 'hybrid' ? DAILY_FREE_TOKEN_LIMIT : undefined, achievements: achievements ? 'enabled (hardcore)' : 'disabled', networkPort: 55356 }, null, 2));
    return;
  }
  const observer = new RetroArchObserver('127.0.0.1', 55356);
  const attached = await findDevelopmentRetroArch(profile, paths.core, paths.rom);
  const processId = attached ?? await launchRetroArch({ ...paths, retroarchConfig: profile }, observer);
  if (!attached) {
    await observer.toggleFastForward();
    console.log('Enabled RetroArch fast-forward once for this new session.');
  }
  if (attached) {
    const status = await observer.status();
    if (!status.includes(path.parse(paths.rom).name))
      throw new Error(`Development RetroArch is running different content: ${status}`);
  }
  const quotaPauseMarker = path.resolve('.local/ra-run/quota-paused-utc-date.txt');
  const quotaPauseDate = fs.existsSync(quotaPauseMarker) ? fs.readFileSync(quotaPauseMarker, 'utf8').trim() : '';
  if (quotaPauseDate && quotaPauseDate !== readDailyUsage().dateUtc) {
    const status = await observer.status();
    if (status.includes(' PAUSED ')) await observer.togglePause();
    fs.rmSync(quotaPauseMarker, { force: true });
    console.log('UTC day rolled over since the shared-cap pause; resumed the existing RetroArch session.');
  }
  const logFile = path.join(outputDir, 'play.jsonl');
  const history: StepRecord[] = fs.existsSync(logFile)
    ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(-32).flatMap(line => {
      try {
        const record = JSON.parse(line) as Partial<StepRecord>;
        return record.observation && record.action ? [record as StepRecord] : [];
      } catch {
        return [];
      }
    })
    : [];
  let controller: Controller = backend === 'mock' ? 'mock' : backend === 'responses' ? 'terra' : 'decisions';
  let recoveryActionsLeft = 0;
  let ineffectiveActionStreak = 0;
  console.log(`${achievements ? 'Achievement' : 'Development'} session ${attached ? 'attached' : 'started'} on port 55356; controller ${backend === 'hybrid' ? `${GAME_MODEL} primary, ${TERRA_MODEL} stall recovery` : backend === 'responses' ? TERRA_MODEL : 'mock'}; RetroAchievements ${achievements ? 'enabled (hardcore)' : 'disabled'}; PID ${processId}`);
  try {
    for (let step = 0; step < steps; step++) {
      const observation = await observeGame(observer, game, pointerAddress);
      const screenshot = await observer.screenshot(path.join(outputDir, 'screenshots'));
      let stepGoal = goal;
      if (achievements && game === 'emerald') {
        const savedAt = fs.existsSync(lastSaveFile) ? Date.parse(fs.readFileSync(lastSaveFile, 'utf8').trim()) : NaN;
        if (Number.isFinite(savedAt)) {
          const minutes = Math.floor((Date.now() - savedAt) / 60000);
          stepGoal += minutes >= 30 ? ` The last confirmed in-game save was ${minutes} minutes ago: save now before further progression.` : ` Last confirmed in-game save was ${minutes} minutes ago; save again by 30 minutes or before any missable event.`;
        } else stepGoal += ' No confirmed in-game save is recorded yet; save as soon as the game allows it.';
      }
      if (backend === 'hybrid' && history.length > 0) {
        const previous = history[history.length - 1];
        const directional = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'RUN_UP', 'RUN_DOWN', 'RUN_LEFT', 'RUN_RIGHT'].includes(previous.action);
        const oldPos = previous.observation.position;
        const newPos = observation.position;
        const stayedPut = directional && oldPos && newPos && oldPos.x === newPos.x && oldPos.y === newPos.y;
        ineffectiveActionStreak = stayedPut ? ineffectiveActionStreak + 1 : 0;
        if (controller === 'decisions' && (ineffectiveActionStreak >= 3 || (history.slice(-3).length === 3 && history.slice(-3).every(item => item.action === previous.action)))) {
          controller = 'terra-recovery';
          recoveryActionsLeft = 24;
          console.log('Progress watchdog detected repeated ineffective actions; Terra is taking a short recovery episode.');
        }
      }
      if (controller === 'terra-recovery' && recoveryActionsLeft <= 0) {
        console.log('Terra did not identify a safe checkpoint within the recovery limit. Pausing for review.');
        const status = await observer.status();
        if (status.includes(' PLAYING ')) await observer.togglePause();
        return;
      }
      let action;
      try {
        action = await chooseAction(observation, history, backend, screenshot, stepGoal, instructions, gameChoices, controller);
      } catch (error) {
        if (!(error instanceof DailyQuotaReachedError)) throw error;
        await waitForDailyQuotaReset(observer);
        step--;
        continue;
      }
      if (backend === 'hybrid') {
        const model = controller === 'decisions' ? GAME_MODEL : TERRA_MODEL;
        const usage = readDailyUsage(model);
        const total = readTotalDailyUsage();
        console.log(`Daily shared pool: ${total.usedTokens.toLocaleString()} / ${DAILY_FREE_TOKEN_LIMIT.toLocaleString()} tokens (${model}: ${usage.usedTokens.toLocaleString()}; ${total.requestCount} total requests).`);
      } else if (controller === 'terra') {
        const total = readTotalDailyUsage();
        console.log(`Daily token usage: ${total.usedTokens.toLocaleString()} / ${DAILY_FREE_TOKEN_LIMIT.toLocaleString()} tokens across ${total.requestCount} requests.`);
      }
      const record: StepRecord = { observation, action };
      fs.appendFileSync(logFile, JSON.stringify({ step: step + 1, at: new Date().toISOString(), screenshot, ...record }) + '\n');
      console.log(JSON.stringify({ step: step + 1, action, screenshot, position: observation.position ?? null, positionError: observation.positionError ?? null }));
      history.push(record);
      if (action === 'RECOVERY_COMPLETE') {
        controller = 'decisions';
        recoveryActionsLeft = 0;
        ineffectiveActionStreak = 0;
        console.log('Terra verified a safe recovery checkpoint; returning gameplay control to Decisions.');
        continue;
      }
      if (controller === 'terra-recovery' && recoveryActionsLeft > 0) recoveryActionsLeft--;
      if (action === 'NEED_USER_INPUT') {
        const status = await observer.status();
        if (status.includes(' PLAYING ')) await observer.togglePause();
        console.log(`Review needed at ${screenshot}. Check gameChoices in ${path.resolve(configFile)} or the current missable checkpoint, then rerun play to continue this session.`);
        return;
      }
      if (action === 'SAVE_CONFIRMED') {
        if (achievements && game === 'emerald') {
          // RetroArch flushes battery RAM on its autosave interval, not necessarily
          // on the same frame as the game's save-complete message.
          await new Promise(resolve => setTimeout(resolve, 11000));
          const savesDir = path.join(outputDir, 'saves');
          const saveName = `${path.parse(paths.rom).name}.srm`;
          const relativeSave = fs.readdirSync(savesDir, { encoding: 'utf8', recursive: true }).find(file => path.basename(file) === saveName);
          if (!relativeSave) throw new Error(`In-game save was confirmed, but RetroArch has not written ${saveName}`);
          const backupDir = path.join(outputDir, 'backups');
          fs.mkdirSync(backupDir, { recursive: true });
          const savedAt = new Date();
          const backupName = `${savedAt.toISOString().replace(/[:.]/g, '-')}-${saveName}`;
          fs.copyFileSync(path.join(savesDir, relativeSave), path.join(backupDir, backupName));
          fs.writeFileSync(lastSaveFile, savedAt.toISOString() + '\n');
          console.log(`In-game save recorded and backed up: ${path.join(backupDir, backupName)}`);
        }
      }
      else if (action.startsWith('RUN_')) {
        const direction = action.slice(4) as 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
        await pressButtons([direction, 'B'], buttonDuration);
      }
      else if (action !== 'WAIT') await pressButton(action as Button, buttonDuration);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    if (!attached) {
      try { process.kill(processId); } catch { /* Already closed. */ }
    }
    throw error;
  }
  console.log(`Completed ${steps} steps. Session log: ${logFile}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
