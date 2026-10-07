import fs from 'node:fs';
import path from 'node:path';
import { loadProbeConfig } from '../src/platform/config.js';
import { createDevelopmentProfile, assertDevelopmentProfile } from '../src/platform/dev-profile.js';
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
    console.log('Usage: npm run play -- [--config FILE] [--game emerald] [--backend decisions|mock] [--steps 10] [--goal TEXT] [--symbol-file FILE | --save-block-pointer-address ADDRESS] [--check]');
    return;
  }
  const paths = loadProbeConfig(option('--config') ?? 'config.local.json', true);
  if (!paths) throw new Error('Config must contain retroarch, core, and rom');
  for (const [label, file] of Object.entries(paths)) {
    if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`);
  }
  const game = option('--game');
  if (game && game !== 'emerald') throw new Error(`No decoder for game: ${game}`);
  const backend = option('--backend') ?? 'decisions';
  if (backend !== 'decisions' && backend !== 'mock') throw new Error('Use --backend decisions or --backend mock');
  if (backend === 'decisions' && !process.env.OPENAI_API_KEY && !process.argv.includes('--check'))
    throw new Error('Set OPENAI_API_KEY for the Decisions API, or use --backend mock for an offline smoke test');
  const goal = option('--goal') ?? 'Play the game and make progress';
  const steps = integerOption('--steps', 10, 1, 1000);
  const pointerAddress = game === 'emerald' ? emeraldPointerAddress() : undefined;
  const profile = createDevelopmentProfile(paths.retroarch);
  assertDevelopmentProfile(profile);
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({ paths, profile, achievements: 'disabled', networkPort: 55356 }, null, 2));
    return;
  }
  const observer = new RetroArchObserver('127.0.0.1', 55356);
  const attached = await findDevelopmentRetroArch(profile, paths.core, paths.rom);
  const processId = attached ?? await launchRetroArch({ ...paths, retroarchConfig: profile }, observer);
  if (attached) {
    const status = await observer.status();
    if (!status.includes(path.parse(paths.rom).name))
      throw new Error(`Development RetroArch is running different content: ${status}`);
  }
  const logFile = path.resolve('.local/play.jsonl');
  const history: StepRecord[] = [];
  console.log(`Development session ${attached ? 'attached' : 'started'} on port 55356; RetroAchievements disabled; PID ${processId}`);
  try {
    for (let step = 0; step < steps; step++) {
      const observation = await observeGame(observer, game, pointerAddress);
      const screenshot = await observer.screenshot(path.resolve('.local/screenshots'));
      const action = await chooseAction(observation, history, backend, screenshot, goal);
      const record: StepRecord = { observation, action };
      fs.appendFileSync(logFile, JSON.stringify({ step: step + 1, at: new Date().toISOString(), screenshot, ...record }) + '\n');
      console.log(JSON.stringify({ step: step + 1, action, screenshot, position: observation.position ?? null, positionError: observation.positionError ?? null }));
      history.push(record);
      if (action !== 'WAIT') await pressButton(action);
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
