import type { BillingEngine } from '@ledgerline/core';
import type { Clock } from '../clock.js';

export interface ApiContext {
  engine: BillingEngine;
  clock: Clock;
  testClockEnabled: boolean;
}
