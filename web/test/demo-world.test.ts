import { describe, expect, it } from 'vitest';
import { MAX_PAGE, type LedgerlineApi } from '../src/api/client';
import type { InvoiceDto } from '../src/api/types';
import { createDemoApi } from '../src/demo/demo-api';

const today = new Date('2026-10-13T15:42:00Z');

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

async function allInvoices(api: LedgerlineApi): Promise<InvoiceDto[]> {
  const invoices: InvoiceDto[] = [];
  for (let offset = 0; ; offset += MAX_PAGE) {
    const page = await api.invoices({ limit: MAX_PAGE, offset });
    invoices.push(...page.data);
    if (page.data.length < MAX_PAGE) return invoices;
  }
}

function sequencesByYear(invoices: readonly InvoiceDto[]): Map<string, number[]> {
  const byYear = new Map<string, number[]>();
  for (const { number } of invoices) {
    const [, year, sequence] = /^LL-(\d{4})-(\d{6})$/.exec(number ?? '') ?? [];
    if (!year || !sequence) throw new Error(`unexpected invoice number ${number}`);
    byYear.set(year, [...(byYear.get(year) ?? []), Number(sequence)].sort((a, b) => a - b));
  }
  return byYear;
}

describe('the demo world', () => {
  it('builds six months of history ending today at 09:00 UTC', async () => {
    const api = await createDemoApi({ today, storage: null });
    expect(await api.clock()).toEqual({ enabled: true, now: '2026-10-13T09:00:00.000Z' });
    const oldest = (await allInvoices(api)).at(-1);
    expect(oldest?.createdAt.slice(0, 7)).toBe('2026-04');
    const statuses = new Set((await api.subscriptions({ limit: MAX_PAGE })).data.map((s) => s.status));
    expect([...statuses].sort()).toEqual(['active', 'canceled', 'past_due', 'trialing']);
  });

  it('stays balanced and numbers every invoice consecutively through 90 more days', async () => {
    const api = await createDemoApi({ today, storage: null });
    const advance = await api.advanceClock({ days: 90 });
    expect(advance.days).toHaveLength(90);
    expect((await api.clock()).now).toBe('2027-01-11T09:00:00.000Z');

    const trial = await api.trialBalance();
    expect(trial.balanced).toBe(true);
    expect(trial.currencies.map((c) => c.net)).toEqual([0, 0]);

    const invoices = await allInvoices(api);
    const byYear = sequencesByYear(invoices);
    expect([...byYear.keys()].sort()).toEqual(['2026', '2027']);
    for (const sequences of byYear.values()) expect(sequences).toEqual(sequences.map((_, i) => i + 1));
  }, 60_000);

  it('moves the clock at most 400 days at once, like the server', async () => {
    const api = await createDemoApi({ today, storage: null });
    await expect(api.advanceClock({ to: '2027-11-18T09:00:00.000Z' })).rejects.toMatchObject({ status: 422, code: 'invalid_argument' });
    expect((await api.clock()).now).toBe('2026-10-13T09:00:00.000Z');
  });

  it('builds the same world, id for id, every time', async () => {
    const first = await createDemoApi({ today, storage: null });
    const second = await createDemoApi({ today, storage: null });
    expect(await allInvoices(second)).toEqual(await allInvoices(first));
    expect(await second.journal({ limit: MAX_PAGE })).toEqual(await first.journal({ limit: MAX_PAGE }));
  });

  it('plays dunning to the end: retries on days 1, 3 and 5, then cancellation and a write-off', async () => {
    const api = await createDemoApi({ today, storage: null });
    const customers = (await api.customers({ limit: MAX_PAGE })).data;
    const wayfarer = customers.find((c) => c.name === 'Wayfarer Maps')!;
    const [subscription] = (await api.subscriptions({ customerId: wayfarer.id })).data;
    expect(subscription!.status).toBe('active');

    await api.attachCard(wayfarer.id, { number: '4000 0000 0000 0002', expMonth: 12, expYear: 2029 }, true);
    const renewal = new Date(subscription!.currentPeriodEnd);
    const advance = await api.advanceClock({ to: new Date(renewal.getTime() + 6 * 86_400_000).toISOString() });

    const [invoice] = (await api.invoices({ subscriptionId: subscription!.id, limit: 1 })).data;
    const detail = await api.invoice(invoice!.id);
    expect(detail.status).toBe('uncollectible');
    expect(detail.payments.map((p) => [p.trigger, p.status, p.failureCode])).toEqual([
      ['initial', 'failed', 'card_declined'],
      ['scheduled_retry', 'failed', 'card_declined'],
      ['scheduled_retry', 'failed', 'card_declined'],
      ['scheduled_retry', 'failed', 'card_declined'],
    ]);
    const failingDays = new Set(advance.days.filter((day) => day.paymentsFailed > 0).map((day) => day.at));
    expect(detail.payments.every((payment) => failingDays.has(payment.createdAt))).toBe(true);
    const firstFailure = Date.parse(detail.payments[0]!.createdAt);
    expect(detail.payments.slice(1).map((p) => (Date.parse(p.createdAt) - firstFailure) / 86_400_000)).toEqual([1, 3, 5]);
    expect((await api.subscriptions({ customerId: wayfarer.id })).data[0]!.status).toBe('canceled');
    const writeOffs = await api.journal({ invoiceId: invoice!.id, kind: 'write_off' });
    expect(writeOffs.data).toHaveLength(1);
    expect((await api.trialBalance()).balanced).toBe(true);
  }, 60_000);

  it('saves every change and picks the saved world up again', async () => {
    const storage = new MemoryStorage();
    const first = await createDemoApi({ today, storage });
    await first.advanceClock({ days: 3 });
    const invoices = await allInvoices(first);

    const reopened = await createDemoApi({ today: new Date('2026-11-30T10:00:00Z'), storage });
    expect((await reopened.clock()).now).toBe('2026-10-16T09:00:00.000Z');
    expect(await allInvoices(reopened)).toEqual(invoices);

    await reopened.advanceClock({ days: 1 });
    const again = await createDemoApi({ today, storage });
    expect((await again.clock()).now).toBe('2026-10-17T09:00:00.000Z');
  }, 60_000);
});
