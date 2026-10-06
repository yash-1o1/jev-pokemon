import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface ProcessInfo {
  ProcessId: number;
  CommandLine?: string;
}

export async function findDevelopmentRetroArch(profile: string, core: string, rom: string): Promise<number | undefined> {
  if (process.platform !== 'win32') return undefined;
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process -Filter "Name = \'retroarch.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
  ], { windowsHide: true, timeout: 5000 });
  if (!stdout.trim()) return undefined;
  const parsed = JSON.parse(stdout) as ProcessInfo | ProcessInfo[];
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  const targets = [profile, core, rom].map(value => value.toLowerCase());
  const matches = processes.filter(item => targets.every(value => item.CommandLine?.toLowerCase().includes(value)));
  if (matches.length > 1) throw new Error('Multiple development RetroArch sessions found; close extras before playing');
  return matches[0]?.ProcessId;
}
