import { describe } from 'vitest';
import type { StoreFactory } from './harness.js';
import { ledgerScenarios } from './scenarios/ledger.js';
import { lifecycleScenarios } from './scenarios/lifecycle.js';
import { paymentScenarios } from './scenarios/payments.js';
import { planChangeScenarios } from './scenarios/plan-changes.js';
import { walkScenarios } from './scenarios/walk.js';

/**
 * The behaviour every Store must show. Core runs it against MemoryStore and
 * the server runs the same suite against PgStore.
 */
export function defineStoreScenarios(label: string, factory: StoreFactory): void {
  describe(label, () => {
    lifecycleScenarios(factory);
    paymentScenarios(factory);
    planChangeScenarios(factory);
    ledgerScenarios(factory);
    walkScenarios(factory);
  });
}
