import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameChoices, loadProbeConfig } from '../src/platform/config.js';
import { createDevelopmentProfile, assertDevelopmentProfile, createAchievementProfile, assertAchievementProfile } from '../src/platform/dev-profile.js';
import { launchRetroArch } from '../src/platform/launch.js';
import { RetroArchObserver } from '../src/platform/retroarch.js';
import { pressButton } from '../src/platform/input.js';
import { findDevelopmentRetroArch } from '../src/platform/process.js';
import { observeGame, EMERALD_SAVE_BLOCK_POINTER } from '../src/game/observe.js';
import { chooseAction, type StepRecord } from '../src/decisions/decision.js';

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
    console.log('Usage: npm run play -- [--config FILE] [--game emerald] [--backend decisions|mock] [--achievements] [--steps 10] [--goal TEXT] [--instructions EXTRA_FILE] [--symbol-file FILE | --save-block-pointer-address ADDRESS] [--check]');
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
  const backend = option('--backend') ?? 'decisions';
  if (backend !== 'decisions' && backend !== 'mock') throw new Error('Use --backend decisions or --backend mock');
  const achievements = process.argv.includes('--achievements');
  if (achievements && backend === 'mock') throw new Error('Achievement runs require the decisions backend');
  if (backend === 'decisions' && !process.env.OPENAI_API_KEY && !process.argv.includes('--check'))
    throw new Error('Set OPENAI_API_KEY for the Decisions API, or use --backend mock for an offline smoke test');
  const goal = option('--goal') ?? 'Play the game and make progress';
  if (process.argv.includes('--instructions') && !option('--instructions'))
    throw new Error('--instructions needs a file path');
  const baseInstructionsFile = fileURLToPath(new URL('../instructions/base.md', import.meta.url));
  const baseInstructions = fs.readFileSync(baseInstructionsFile, 'utf8').trim();
  if (!baseInstructions) throw new Error(`Instructions file is empty: ${baseInstructionsFile}`);
  const extraInstructionsFile = option('--instructions') ? path.resolve(option('--instructions')!) : undefined;
  const extraInstructions = extraInstructionsFile ? fs.readFileSync(extraInstructionsFile, 'utf8').trim() : '';
  const achievementRulesFile = fileURLToPath(new URL('../instructions/emerald-achievement-rules.md', import.meta.url));
  const defaultCheckpointFile = fileURLToPath(new URL('../instructions/emerald-early-checkpoint.md', import.meta.url));
  const localCheckpointFile = path.resolve('.local/ra-run/current-checkpoint.md');
  const lastSaveFile = path.resolve('.local/ra-run/last-save-at.txt');
  const checkpointFile = fs.existsSync(localCheckpointFile) ? localCheckpointFile : defaultCheckpointFile;
  const instructions = [baseInstructions, achievements && game === 'emerald' ? fs.readFileSync(achievementRulesFile, 'utf8').trim() : '', achievements && game === 'emerald' ? fs.readFileSync(checkpointFile, 'utf8').trim() : '', extraInstructions].filter(Boolean).join('\n\n');
  const steps = integerOption('--steps', 10, 1, 1000);
  const pointerAddress = game === 'emerald' ? emeraldPointerAddress() : undefined;
  const profile = achievements ? createAchievementProfile(paths.retroarch) : createDevelopmentProfile(paths.retroarch);
  if (achievements) assertAchievementProfile(profile);
  else assertDevelopmentProfile(profile);
  const outputDir = path.resolve(achievements ? '.local/ra-run' : '.local');
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({ paths, profile, baseInstructionsFile, extraInstructionsFile, checkpointFile: achievements && game === 'emerald' ? checkpointFile : undefined, gameChoices, achievements: achievements ? 'enabled (hardcore)' : 'disabled', networkPort: 55356 }, null, 2));
    return;
  }
  const observer = new RetroArchObserver('127.0.0.1', 55356);
  const attached = await findDevelopmentRetroArch(profile, paths.core, paths.rom);
  const processId = attached ?? await launchRetroArch({ ...paths, retroarchConfig: profile }, observer);
  if (!attached) await observer.toggleFastForward();
  if (attached) {
    const status = await observer.status();
    if (!status.includes(path.parse(paths.rom).name))
      throw new Error(`Development RetroArch is running different content: ${status}`);
  }
  const logFile = path.join(outputDir, 'play.jsonl');
  const history: StepRecord[] = [];
  console.log(`${achievements ? 'Achievement' : 'Development'} session ${attached ? 'attached' : 'started'} on port 55356; RetroAchievements ${achievements ? 'enabled (hardcore)' : 'disabled'}; PID ${processId}`);
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
      const action = await chooseAction(observation, history, backend, screenshot, stepGoal, instructions, gameChoices);
      const record: StepRecord = { observation, action };
      fs.appendFileSync(logFile, JSON.stringify({ step: step + 1, at: new Date().toISOString(), screenshot, ...record }) + '\n');
      console.log(JSON.stringify({ step: step + 1, action, screenshot, position: observation.position ?? null, positionError: observation.positionError ?? null }));
      history.push(record);
      if (action === 'NEED_USER_INPUT') {
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
      else if (action !== 'WAIT') await pressButton(action);
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
