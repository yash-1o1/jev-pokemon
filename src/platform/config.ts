import fs from 'node:fs';
import path from 'node:path';
import type { LaunchPaths } from './launch.js';

interface ProbeConfig {
  retroarch?: string;
  core?: string;
  romsDirectory?: string;
  rom?: string;
}

function stringField(config: Record<string, unknown>, name: keyof ProbeConfig): string | undefined {
  const value = config[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Config field ${name} must be a non-empty path`);
  return value;
}

export function loadProbeConfig(file: string, required = false): LaunchPaths | undefined {
  const configFile = path.resolve(file);
  if (!fs.existsSync(configFile)) {
    if (required) throw new Error(`Config file not found: ${configFile}`);
    return undefined;
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`Config must be a JSON object: ${configFile}`);
  const config = parsed as Record<string, unknown>;
  const retroarch = stringField(config, 'retroarch');
  const core = stringField(config, 'core');
  const romsDirectory = stringField(config, 'romsDirectory');
  const rom = stringField(config, 'rom');
  const values = [retroarch, core, rom];
  if (values.every(value => value === undefined)) return undefined;
  if (values.some(value => value === undefined))
    throw new Error('Config must include retroarch, core, and rom to launch a game');
  const base = path.dirname(configFile);
  const romRoot = romsDirectory ? path.resolve(base, romsDirectory) : base;
  return {
    retroarch: path.resolve(base, retroarch!),
    core: path.resolve(base, core!),
    rom: path.resolve(romRoot, rom!),
  };
}

export function loadGameChoices(file: string): Record<string, string> {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Config must be a JSON object');
  const choices = (parsed as Record<string, unknown>).gameChoices;
  if (choices === undefined) return {};
  if (!choices || typeof choices !== 'object' || Array.isArray(choices))
    throw new Error('gameChoices must be a JSON object');
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(choices)) {
    if (!key.trim() || typeof value !== 'string' || !value.trim())
      throw new Error('Each gameChoices entry needs a name and non-empty text value');
    result[key.trim()] = value.trim();
  }
  return result;
}
