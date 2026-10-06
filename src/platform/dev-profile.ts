import fs from 'node:fs';
import path from 'node:path';

const OVERRIDES: Record<string, string> = {
  cheevos_enable: 'false',
  cheevos_hardcore_mode_enable: 'false',
  cheevos_username: '',
  cheevos_token: '',
  cheevos_password: '',
  network_cmd_enable: 'true',
  network_cmd_port: '55356',
  network_remote_enable: 'true',
  network_remote_enable_user_p1: 'true',
  network_remote_base_port: '55420',
  pause_nonactive: 'false',
  config_save_on_exit: 'false',
};

export function makeDevelopmentConfig(source: string, saves: string, screenshots = saves): string {
  const overrides: Record<string, string> = {
    ...OVERRIDES,
    savefile_directory: saves.replaceAll('\\', '/'),
    savestate_directory: saves.replaceAll('\\', '/'),
    screenshot_directory: screenshots.replaceAll('\\', '/'),
  };
  const seen = new Set<string>();
  const lines = source.split(/\r?\n/).map(line => {
    const key = line.match(/^\s*([a-z0-9_]+)\s*=/i)?.[1];
    if (!key || !(key in overrides)) return line;
    seen.add(key);
    return `${key} = ${JSON.stringify(overrides[key])}`;
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (!seen.has(key)) lines.push(`${key} = ${JSON.stringify(value)}`);
  }
  return lines.join('\n').trimEnd() + '\n';
}

export function createDevelopmentProfile(retroarchExe: string, directory = '.local'): string {
  const source = path.join(path.dirname(retroarchExe), 'retroarch.cfg');
  if (!fs.existsSync(source)) throw new Error(`RetroArch config not found: ${source}`);
  const targetDir = path.resolve(directory);
  const saves = path.join(targetDir, 'saves');
  const screenshots = path.join(targetDir, 'screenshots');
  fs.mkdirSync(saves, { recursive: true });
  fs.mkdirSync(screenshots, { recursive: true });
  const target = path.join(targetDir, 'retroarch-dev.cfg');
  const config = makeDevelopmentConfig(fs.readFileSync(source, 'utf8'), saves, screenshots);
  fs.writeFileSync(target, config, { mode: 0o600 });
  return target;
}

export function assertDevelopmentProfile(file: string): void {
  const content = fs.readFileSync(file, 'utf8');
  for (const [key, expected] of Object.entries(OVERRIDES)) {
    const value = [...content.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'gm'))].at(-1)?.[1];
    if (value !== expected) throw new Error(`Unsafe development config: ${key} must be ${JSON.stringify(expected)}`);
  }
}
