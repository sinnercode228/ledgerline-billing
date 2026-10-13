import { DEFAULT_DUNNING_POLICY, parseRetrySchedule, type DunningPolicy } from '@ledgerline/core';

export interface Config {
  databaseUrl: string;
  apiKey: string;
  webhookSecrets: string[];
  host: string;
  port: number;
  testClock: boolean;
  dunning: DunningPolicy;
  /** Where the bundled fake Payrail delivers its signed webhooks; null keeps them in-process only. */
  payrailWebhookUrl: string | null;
  logLevel: string;
  devMode: boolean;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

const MIN_API_KEY_LENGTH = 32;
const MIN_SECRET_LENGTH = 16;
const PLACEHOLDER = /change[-_ ]?me|example|placeholder|^(.)\1+$/i;
const DEV_API_KEY = 'dev-api-key';
const DEV_WEBHOOK_SECRET = 'whsec_dev_only';

type Env = Record<string, string | undefined>;

const flag = (value: string | undefined) => value === '1' || value === 'true';

export function requireDatabaseUrl(env: Env): string {
  const url = env.LEDGERLINE_DATABASE_URL?.trim();
  if (!url) throw new ConfigError('LEDGERLINE_DATABASE_URL is required');
  return url;
}

/**
 * Reads the environment once at startup and refuses weak secrets: without
 * LEDGERLINE_DEV=1 the API key must be a real random string.
 */
export function loadConfig(env: Env): Config {
  const problems: string[] = [];
  const devMode = flag(env.LEDGERLINE_DEV);

  let databaseUrl = '';
  try {
    databaseUrl = requireDatabaseUrl(env);
  } catch (error) {
    problems.push((error as Error).message);
  }

  let apiKey = env.LEDGERLINE_API_KEY?.trim() ?? '';
  if (apiKey === '' && devMode) apiKey = DEV_API_KEY;
  if (!devMode) {
    if (apiKey === '') problems.push('LEDGERLINE_API_KEY is required (set LEDGERLINE_DEV=1 to use a development key)');
    else if (apiKey.length < MIN_API_KEY_LENGTH) problems.push(`LEDGERLINE_API_KEY must be at least ${MIN_API_KEY_LENGTH} characters`);
    else if (PLACEHOLDER.test(apiKey)) problems.push('LEDGERLINE_API_KEY looks like a placeholder; generate a random key');
  }

  let webhookSecrets = (env.LEDGERLINE_WEBHOOK_SECRET ?? '')
    .split(',')
    .map((secret) => secret.trim())
    .filter((secret) => secret !== '');
  if (webhookSecrets.length === 0 && devMode) webhookSecrets = [DEV_WEBHOOK_SECRET];
  if (webhookSecrets.length === 0) problems.push('LEDGERLINE_WEBHOOK_SECRET is required (comma-separate several during rotation)');
  else if (!devMode && webhookSecrets.some((secret) => secret.length < MIN_SECRET_LENGTH)) {
    problems.push(`every LEDGERLINE_WEBHOOK_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  const portText = env.LEDGERLINE_PORT?.trim() || '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65_535) problems.push(`LEDGERLINE_PORT must be a port number, got "${portText}"`);

  let dunning = DEFAULT_DUNNING_POLICY;
  if (env.LEDGERLINE_DUNNING_RETRY_DAYS !== undefined) {
    try {
      dunning = { retryDays: parseRetrySchedule(env.LEDGERLINE_DUNNING_RETRY_DAYS) };
    } catch (error) {
      problems.push(`LEDGERLINE_DUNNING_RETRY_DAYS: ${(error as Error).message}`);
    }
  }

  if (problems.length > 0) {
    throw new ConfigError(`invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
  return {
    databaseUrl,
    apiKey,
    webhookSecrets,
    host: env.LEDGERLINE_HOST?.trim() || '0.0.0.0',
    port,
    testClock: flag(env.LEDGERLINE_TEST_CLOCK),
    dunning,
    payrailWebhookUrl: env.LEDGERLINE_PAYRAIL_WEBHOOK_URL?.trim() || null,
    logLevel: env.LEDGERLINE_LOG_LEVEL?.trim() || 'info',
    devMode,
  };
}
