import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PLAN_CATALOG } from '@ledgerline/core';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import type { PlanChangePreviewDto, PlanDto, SubscriptionDto } from '../src/api/types';
import { ChangePlanDialog } from '../src/features/customers/ChangePlanDialog';
import { renderWith } from './helpers/render';

const plans: PlanDto[] = structuredClone([...PLAN_CATALOG]);

const subscription: SubscriptionDto = {
  id: 'sub_starter',
  customerId: 'cus_halcyon',
  planId: 'plan_starter_monthly',
  currency: 'EUR',
  status: 'active',
  billingAnchor: '2026-02-15T00:00:00.000Z',
  paidCycles: 1,
  currentPeriodStart: '2026-02-15T00:00:00.000Z',
  currentPeriodEnd: '2026-03-15T00:00:00.000Z',
  trialEnd: null,
  cancelAtPeriodEnd: false,
  canceledAt: null,
  endedAt: null,
  createdAt: '2026-02-15T00:00:00.000Z',
  updatedAt: '2026-02-15T00:00:00.000Z',
};

const upgrade: PlanChangePreviewDto = {
  subscriptionId: 'sub_starter',
  currency: 'EUR',
  fromPlanId: 'plan_starter_monthly',
  toPlanId: 'plan_team_monthly',
  changeAt: '2026-02-22T00:00:00.000Z',
  periodStart: '2026-02-15T00:00:00.000Z',
  periodEnd: '2026-03-15T00:00:00.000Z',
  credit: 675,
  charge: 2_175,
  net: 1_500,
  creditApplied: 0,
  amountDue: 1_500,
  effect: 'invoice_now',
  lines: [
    { kind: 'proration_credit', description: 'Unused time on Starter', amount: -675, planId: 'plan_starter_monthly', periodStart: '2026-02-22T00:00:00.000Z', periodEnd: '2026-03-15T00:00:00.000Z' },
    { kind: 'proration_charge', description: 'Remaining time on Team', amount: 2_175, planId: 'plan_team_monthly', periodStart: '2026-02-22T00:00:00.000Z', periodEnd: '2026-03-15T00:00:00.000Z' },
  ],
};

describe('ChangePlanDialog', () => {
  it('offers only plans with the same interval and shows the engine’s proration lines before confirming', async () => {
    const previewPlanChange = vi.fn(async () => upgrade);
    const changePlan = vi.fn(async () => ({ subscription: { ...subscription, planId: 'plan_team_monthly' }, preview: upgrade, invoice: null }));
    const onChanged = vi.fn();
    renderWith(<ChangePlanDialog subscription={subscription} plans={plans} onClose={() => undefined} onChanged={onChanged} />, {
      api: { previewPlanChange, changePlan },
    });

    const dialog = screen.getByRole('dialog', { name: 'Change plan' });
    const choice = within(dialog).getByRole('combobox', { name: 'New plan' });
    const offered = within(choice).getAllByRole('option').map((option) => option.textContent);
    expect(offered).toEqual(['Choose a plan', 'Team · €29.00 per month', 'Business · €99.00 per month']);
    const confirm = within(dialog).getByRole('button', { name: 'Change plan' });
    expect(confirm).toBeDisabled();

    await userEvent.selectOptions(choice, 'plan_team_monthly');
    expect(previewPlanChange).toHaveBeenCalledWith('sub_starter', 'plan_team_monthly');
    const lines = await within(dialog).findByRole('table');
    const rows = within(lines).getAllByRole('row').map((row) => row.textContent);
    expect(rows).toEqual([
      expect.stringContaining('Unused time on Starter'),
      expect.stringContaining('Remaining time on Team'),
      expect.stringContaining('Net'),
    ]);
    expect(rows[0]).toContain('-€6.75');
    expect(rows[1]).toContain('€21.75');
    expect(rows[2]).toContain('€15.00');
    expect(dialog).toHaveTextContent('Invoiced and charged now.');
    expect(dialog).toHaveTextContent('Takes effect 22 Feb 2026');

    await userEvent.click(confirm);
    expect(changePlan).toHaveBeenCalledWith('sub_starter', 'plan_team_monthly');
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });

  it('shows how much of an upgrade the customer credit pays and what the card is charged', async () => {
    const previewPlanChange = vi.fn(async () => ({ ...upgrade, creditApplied: 500, amountDue: 1_000 }));
    renderWith(<ChangePlanDialog subscription={subscription} plans={plans} onClose={() => undefined} onChanged={() => undefined} />, {
      api: { previewPlanChange },
    });
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'plan_team_monthly');
    const rows = within(await within(dialog).findByRole('table')).getAllByRole('row').map((row) => row.textContent);
    expect(rows.slice(2)).toEqual([expect.stringContaining('€15.00'), expect.stringContaining('-€5.00'), expect.stringContaining('€10.00')]);
    expect(rows[3]).toContain('Customer credit');
    expect(rows[4]).toContain('Charged to the card now');
  });

  it('says when the customer credit pays an upgrade in full', async () => {
    const previewPlanChange = vi.fn(async () => ({ ...upgrade, creditApplied: 1_500, amountDue: 0 }));
    renderWith(<ChangePlanDialog subscription={subscription} plans={plans} onClose={() => undefined} onChanged={() => undefined} />, {
      api: { previewPlanChange },
      language: 'ru',
    });
    await userEvent.selectOptions(screen.getByRole('combobox'), 'plan_team_monthly');
    expect(await screen.findByText('Счёт выставляется сейчас и оплачивается из кредита клиента.')).toBeInTheDocument();
    expect(screen.queryByText('Счёт выставляется и оплачивается сразу.')).not.toBeInTheDocument();
  });

  it('explains a refusal from the engine and keeps the change from being confirmed', async () => {
    const previewPlanChange = vi.fn(async () => {
      throw new ApiError(422, 'plan_unavailable', 'plan plan_team_monthly has no EUR price');
    });
    renderWith(<ChangePlanDialog subscription={subscription} plans={plans} onClose={() => undefined} onChanged={() => undefined} />, {
      api: { previewPlanChange },
      language: 'ru',
    });
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'plan_team_monthly');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Этот тариф не продаётся в валюте клиента.');
    expect(within(dialog).getByRole('button', { name: 'Сменить тариф' })).toBeDisabled();
  });

  it('switches a trial without moving money', async () => {
    const trialing = { ...subscription, status: 'trialing' as const };
    const previewPlanChange = vi.fn(async () => ({ ...upgrade, effect: 'trial_switch' as const, credit: 0, charge: 0, net: 0, lines: [] }));
    renderWith(<ChangePlanDialog subscription={trialing} plans={plans} onClose={() => undefined} onChanged={() => undefined} />, {
      api: { previewPlanChange },
    });
    await userEvent.selectOptions(screen.getByRole('combobox'), 'plan_business_monthly');
    expect(await screen.findByText('The trial continues on the new plan; nothing is charged.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change plan' })).toBeEnabled();
  });
});
