import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RetroArchObserver } from './retroarch.js';

export interface LaunchPaths {
  retroarch: string;
  core: string;
  rom: string;
  retroarchConfig?: string;
}

function requireFile(label: string, file: string): string {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile())
    throw new Error(`${label} is not a file: ${resolved}`);
  return resolved;
}

export async function launchRetroArch(paths: LaunchPaths, observer: RetroArchObserver): Promise<number> {
  const retroarch = requireFile('RetroArch executable', paths.retroarch);
  const core = requireFile('Libretro core', paths.core);
  const rom = requireFile('ROM', paths.rom);

  // One UDP command port cannot reliably distinguish two running RetroArch instances.
  try {
    await observer.status();
    throw new Error('RetroArch is already responding. Close it to launch these paths, or omit the launch paths to connect.');
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith('RetroArch did not respond')) throw error;
  }

  const args = paths.retroarchConfig
    ? ['--config', requireFile('RetroArch config', paths.retroarchConfig), '-L', core, rom]
    : ['-L', core, rom];
  const child = spawn(retroarch, args, {
    cwd: path.dirname(retroarch),
    detached: true,
    stdio: 'ignore',
  });
  let launchError: Error | undefined;
  child.on('error', error => { launchError = error; });
  child.unref();

  for (let attempt = 0; attempt < 8; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`RetroArch exited with code ${child.exitCode}`);
    try {
      const status = await observer.status();
      if (/^GET_STATUS (PLAYING|PAUSED)\b/.test(status)) {
        if (!child.pid) throw new Error('RetroArch process ID unavailable');
        return child.pid;
      }
    } catch (error) {
      if (launchError) throw launchError;
      if (!(error instanceof Error) || !error.message.startsWith('RetroArch did not respond')) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('RetroArch launched but no running game responded. Enable Network Commands in RetroArch and retry.');
}
