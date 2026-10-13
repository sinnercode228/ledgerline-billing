import { screen, within } from '@testing-library/react';
import { PLAN_CATALOG } from '@ledgerline/core';
import { describe, expect, it } from 'vitest';
import type { InvoiceDto, PlanDto, SubscriptionDto } from '../src/api/types';
import { SubscriptionCard } from '../src/features/customers/SubscriptionCard';
import { renderWith } from './helpers/render';

const plans: PlanDto[] = structuredClone([...PLAN_CATALOG]);

const pastDue: SubscriptionDto = {
  id: 'sub_riverbend',
  customerId: 'cus_riverbend',
  planId: 'plan_business_monthly',
  currency: 'RUB',
  status: 'past_due',
  billingAnchor: '2026-10-11T09:00:00.000Z',
  paidCycles: 0,
  currentPeriodStart: '2026-10-11T09:00:00.000Z',
  currentPeriodEnd: '2026-11-11T09:00:00.000Z',
  trialEnd: null,
  cancelAtPeriodEnd: false,
  canceledAt: null,
  endedAt: null,
  createdAt: '2026-10-11T09:00:00.000Z',
  updatedAt: '2026-10-12T09:00:00.000Z',
};

const unpaid: InvoiceDto = {
  id: 'inv_riverbend',
  number: 'LL-2026-000056',
  customerId: 'cus_riverbend',
  subscriptionId: 'sub_riverbend',
  kind: 'cycle',
  status: 'open',
  currency: 'RUB',
  periodStart: '2026-10-11T09:00:00.000Z',
  periodEnd: '2026-11-11T09:00:00.000Z',
  lines: [{ kind: 'plan', description: 'Business', amount: 990_000, planId: 'plan_business_monthly', periodStart: '2026-10-11T09:00:00.000Z', periodEnd: '2026-11-11T09:00:00.000Z' }],
  total: 990_000,
  creditApplied: 0,
  amountDue: 990_000,
  amountPaid: 0,
  amountRefunded: 0,
  attemptCount: 2,
  firstFailedAt: '2026-10-11T09:00:00.000Z',
  nextRetryAt: '2026-10-14T09:00:00.000Z',
  scheduledRetries: 1,
  createdAt: '2026-10-11T09:00:00.000Z',
  finalizedAt: '2026-10-11T09:00:00.000Z',
  paidAt: null,
  voidedAt: null,
  uncollectibleAt: null,
};

function renderCard(subscription: SubscriptionDto, invoices: InvoiceDto[], language: 'en' | 'ru' = 'en') {
  renderWith(<SubscriptionCard subscription={subscription} plans={plans} invoices={invoices} downgradeCredits={[]} now="2026-10-13T09:00:00.000Z" />, { language });
  return screen.getByRole('region', { name: language === 'en' ? 'Subscription' : 'Подписка' });
}

describe('SubscriptionCard', () => {
  it('shows how far dunning has got on a past-due subscription', () => {
    const card = renderCard(pastDue, [unpaid]);
    expect(within(card).getByText('Past due')).toBeInTheDocument();
    const fact = within(card).getByText('Dunning').closest('div');
    expect(fact).toHaveTextContent('Attempts: 2 · next retry 14 Oct 2026');
  });

  it('says so in Russian', () => {
    const card = renderCard(pastDue, [unpaid], 'ru');
    expect(card).toHaveTextContent('Попыток: 2 · следующий повтор 14 окт. 2026 г.');
  });

  it('says nothing about dunning while payments go through', () => {
    const card = renderCard({ ...pastDue, status: 'active', paidCycles: 1 }, [{ ...unpaid, status: 'paid', attemptCount: 1, firstFailedAt: null, nextRetryAt: null }]);
    expect(card).not.toHaveTextContent('Dunning');
  });
});
