import fs from 'node:fs';
import path from 'node:path';

export const DAILY_FREE_TOKEN_LIMIT = 2_500_000;
export const REQUEST_TOKEN_RESERVE = 10_000;
const usageFiles = {
  'gpt-5.6-terra': path.resolve('.local/openai-free-token-usage.json'),
  'gpt-6-luna': path.resolve('.local/openai-decisions-token-usage.json'),
} as const;
export type QuotaModel = keyof typeof usageFiles;

export interface DailyUsage {
  dateUtc: string;
  model: string;
  usedTokens: number;
  requestCount: number;
}

export class DailyQuotaReachedError extends Error {
  constructor(readonly usage: DailyUsage) {
    super(`Daily free-token safety limit reached (${usage.usedTokens.toLocaleString()} / ${DAILY_FREE_TOKEN_LIMIT.toLocaleString()}); stopped before another request could exceed the pool.`);
    this.name = 'DailyQuotaReachedError';
  }
}

function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function readDailyUsage(model: QuotaModel = 'gpt-5.6-terra', now = new Date()): DailyUsage {
  const dateUtc = utcDate(now);
  const usageFile = usageFiles[model];
  if (!fs.existsSync(usageFile))
    return { dateUtc, model, usedTokens: 0, requestCount: 0 };

  const parsed: unknown = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !('dateUtc' in parsed) ||
      !('usedTokens' in parsed) || !('requestCount' in parsed))
    throw new Error(`Invalid daily token ledger: ${usageFile}`);
  const ledger = parsed as DailyUsage;
  if (ledger.dateUtc !== dateUtc)
    return { dateUtc, model, usedTokens: 0, requestCount: 0 };
  if (!Number.isSafeInteger(ledger.usedTokens) || ledger.usedTokens < 0 ||
      !Number.isSafeInteger(ledger.requestCount) || ledger.requestCount < 0)
    throw new Error(`Invalid counters in daily token ledger: ${usageFile}`);
  return ledger;
}

export function readTotalDailyUsage(now = new Date()): DailyUsage {
  const terra = readDailyUsage('gpt-5.6-terra', now);
  const decisions = readDailyUsage('gpt-6-luna', now);
  return {
    dateUtc: terra.dateUtc,
    model: 'combined free-token pool',
    usedTokens: terra.usedTokens + decisions.usedTokens,
    requestCount: terra.requestCount + decisions.requestCount,
  };
}

export function assertDailyBudgetAvailable(model: QuotaModel = 'gpt-5.6-terra', now = new Date()): DailyUsage {
  const usage = readTotalDailyUsage(now);
  if (usage.usedTokens + REQUEST_TOKEN_RESERVE > DAILY_FREE_TOKEN_LIMIT)
    throw new DailyQuotaReachedError({ ...usage, model: `${model} request; shared across models` });
  return usage;
}

export function recordDailyUsage(tokens: number, model: QuotaModel = 'gpt-5.6-terra', now = new Date()): DailyUsage {
  if (!Number.isSafeInteger(tokens) || tokens < 0)
    throw new Error(`Invalid API token usage: ${tokens}`);
  const usageFile = usageFiles[model];
  const current = readDailyUsage(model, now);
  const next = {
    ...current,
    usedTokens: current.usedTokens + tokens,
    requestCount: current.requestCount + 1,
  };
  fs.mkdirSync(path.dirname(usageFile), { recursive: true });
  const tempFile = `${usageFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tempFile, usageFile);
  return next;
}

export function millisecondsUntilUtcReset(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime() + 1_000;
}
