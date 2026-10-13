import type { Currency } from '@ledgerline/core';
import { ApiError, MAX_PAGE } from '../api/client';
import type { ListPage, PlanDto } from '../api/types';
import type { I18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';

/** Reads every page of a list; the API caps a page at 200 rows. */
export async function fetchAll<T>(load: (page: { limit: number; offset: number }) => Promise<ListPage<T>>, maxRows = 2_000): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < maxRows; offset += MAX_PAGE) {
    const page = await load({ limit: MAX_PAGE, offset });
    rows.push(...page.data);
    if (page.data.length < MAX_PAGE) break;
  }
  return rows;
}

export function planLabel(plans: readonly PlanDto[], planId: string): string {
  return plans.find((plan) => plan.id === planId)?.name ?? planId;
}

export function planPrice(plan: PlanDto, currency: Currency): number | null {
  return plan.prices[currency] ?? null;
}

/** Engine line descriptions are English; the dashboard words them from the line kind and plan. */
export function lineDescription(i18n: I18n, plans: readonly PlanDto[], line: { kind: 'plan' | 'proration_credit' | 'proration_charge'; planId: string }): string {
  return i18n.t(`line.${line.kind}`, { plan: planLabel(plans, line.planId) });
}

const ERROR_MESSAGES = new Set<string>([
  'interval_mismatch',
  'same_plan',
  'subscription_not_changeable',
  'plan_unavailable',
  'card_not_supported',
  'not_found',
  'network_error',
]);

/** A refusal from the API in the visitor's language when we have words for it, the server's message otherwise. */
export function errorMessage(i18n: I18n, error: unknown): string {
  if (error instanceof ApiError && ERROR_MESSAGES.has(error.code)) return i18n.t(`error.${error.code}` as MessageKey & `error.${string}`);
  return error instanceof Error ? error.message : String(error);
}
