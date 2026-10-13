import { MINUTE_MS } from '../calendar.js';
import { DEFAULT_DUNNING_POLICY, type DunningPolicy } from '../dunning.js';
import type { PaymentProvider } from '../ports/provider.js';
import type { Store } from '../ports/store.js';

export interface Logger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface EngineOptions {
  store: Store;
  provider: PaymentProvider;
  dunning?: DunningPolicy;
  /** A payment still pending this long after the provider was last asked is asked again with the same idempotency key. */
  pendingPaymentRetryAfterMs?: number;
  logger?: Logger;
}

export interface EngineContext {
  store: Store;
  provider: PaymentProvider;
  dunning: DunningPolicy;
  pendingPaymentRetryAfterMs: number;
  logger: Logger;
}

export function createContext(options: EngineOptions): EngineContext {
  return {
    store: options.store,
    provider: options.provider,
    dunning: options.dunning ?? DEFAULT_DUNNING_POLICY,
    pendingPaymentRetryAfterMs: options.pendingPaymentRetryAfterMs ?? 10 * MINUTE_MS,
    logger: options.logger ?? silentLogger,
  };
}
