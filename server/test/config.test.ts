import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const strongKey = 'lk_live_9c1f3b7e2a4d6f8091b2c3d4e5f60718';
const base = {
  LEDGERLINE_DATABASE_URL: 'postgres://ledgerline:secret@db:5432/ledgerline',
  LEDGERLINE_API_KEY: strongKey,
  LEDGERLINE_WEBHOOK_SECRET: 'whsec_3f0a9c1e5b7d2468',
};

describe('configuration', () => {
  it('reads every setting from the environment', () => {
    const config = loadConfig({
      ...base,
      LEDGERLINE_WEBHOOK_SECRET: 'whsec_new_8a7b6c5d4e3f, whsec_old_1a2b3c4d5e6f',
      LEDGERLINE_PORT: '8080',
      LEDGERLINE_TEST_CLOCK: '1',
      LEDGERLINE_DUNNING_RETRY_DAYS: '2,4,8',
    });
    expect(config).toMatchObject({
      databaseUrl: base.LEDGERLINE_DATABASE_URL,
      apiKey: strongKey,
      webhookSecrets: ['whsec_new_8a7b6c5d4e3f', 'whsec_old_1a2b3c4d5e6f'],
      port: 8080,
      testClock: true,
      dunning: { retryDays: [2, 4, 8] },
      devMode: false,
    });
  });

  it('reads the origins allowed to call the API from a browser', () => {
    const config = loadConfig({ ...base, LEDGERLINE_CORS_ORIGINS: 'https://dashboard.example.com, http://localhost:5173' });
    expect(config.corsOrigins).toEqual(['https://dashboard.example.com', 'http://localhost:5173']);
    expect(loadConfig(base).corsOrigins).toEqual([]);
    expect(() => loadConfig({ ...base, LEDGERLINE_CORS_ORIGINS: '*' })).toThrow(/LEDGERLINE_CORS_ORIGINS/);
    expect(() => loadConfig({ ...base, LEDGERLINE_CORS_ORIGINS: 'https://dashboard.example.com/app' })).toThrow(/LEDGERLINE_CORS_ORIGINS/);
  });

  it('uses safe defaults for optional settings', () => {
    expect(loadConfig(base)).toMatchObject({ port: 3000, host: '0.0.0.0', testClock: false, dunning: { retryDays: [1, 3, 5] }, payrailWebhookUrl: null });
  });

  it('refuses to start without a strong API key', () => {
    expect(() => loadConfig({ ...base, LEDGERLINE_API_KEY: undefined })).toThrow(/LEDGERLINE_API_KEY/);
    expect(() => loadConfig({ ...base, LEDGERLINE_API_KEY: 'short-key' })).toThrow(/at least 32 characters/);
    expect(() => loadConfig({ ...base, LEDGERLINE_API_KEY: 'change-me-change-me-change-me-change-me' })).toThrow(/placeholder/);
  });

  it('refuses to start without a webhook secret or with an invalid schedule', () => {
    expect(() => loadConfig({ ...base, LEDGERLINE_WEBHOOK_SECRET: '' })).toThrow(/LEDGERLINE_WEBHOOK_SECRET/);
    expect(() => loadConfig({ ...base, LEDGERLINE_DUNNING_RETRY_DAYS: '5,3' })).toThrow(/increasing/);
    expect(() => loadConfig({ ...base, LEDGERLINE_PORT: 'eighty' })).toThrow(/LEDGERLINE_PORT/);
  });

  it('allows development defaults only with the dev flag', () => {
    const config = loadConfig({ LEDGERLINE_DEV: '1', LEDGERLINE_DATABASE_URL: base.LEDGERLINE_DATABASE_URL });
    expect(config.devMode).toBe(true);
    expect(config.apiKey).toBe('dev-api-key');
    expect(config.webhookSecrets).toEqual(['whsec_dev_only']);
  });
});
