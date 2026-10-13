import { DAY_MS } from '../calendar.js';
import type { BillingEngine } from '../engine/billing-engine.js';
import type { Currency } from '../money.js';
import { PAYRAIL_TEST_CARDS, type FakePayrail } from '../payrail/fake-payrail.js';
import { PLAN_CATALOG } from '../plans.js';

type Card = keyof typeof PAYRAIL_TEST_CARDS;

interface DemoCustomer {
  name: string;
  currency: Currency;
  card: Card;
}

/** Made-up SaaS customers. */
const CUSTOMERS = {
  borealis: { name: 'Borealis Analytics', currency: 'RUB', card: 'succeeds' },
  kettle: { name: 'Kettle & Co', currency: 'EUR', card: 'succeeds' },
  pinegrove: { name: 'Pinegrove Studio', currency: 'RUB', card: 'succeeds' },
  tundra: { name: 'Tundra Freight Ops', currency: 'RUB', card: 'declined' },
  lumen: { name: 'Lumen Forms', currency: 'EUR', card: 'insufficientFunds' },
  saltmarsh: { name: 'Saltmarsh Media', currency: 'EUR', card: 'succeeds' },
  quarry: { name: 'Quarry Metrics', currency: 'RUB', card: 'succeeds' },
  halcyon: { name: 'Halcyon Docs', currency: 'EUR', card: 'succeeds' },
  orchid: { name: 'Orchid Payroll', currency: 'RUB', card: 'succeeds' },
  copperline: { name: 'Copperline CRM', currency: 'RUB', card: 'succeeds' },
  wayfarer: { name: 'Wayfarer Maps', currency: 'EUR', card: 'succeeds' },
  juniper: { name: 'Juniper Events', currency: 'RUB', card: 'succeeds' },
  dune: { name: 'Dune Robotics', currency: 'EUR', card: 'insufficientFunds' },
} satisfies Record<string, DemoCustomer>;

type CustomerKey = keyof typeof CUSTOMERS;

type Action =
  | { kind: 'subscribe'; customer: CustomerKey; planId: string }
  | { kind: 'change_plan'; customer: CustomerKey; planId: string }
  | { kind: 'cancel'; customer: CustomerKey }
  | { kind: 'new_card'; customer: CustomerKey; card: Card }
  | { kind: 'refund_first_invoice'; customer: CustomerKey };

/** What happens on which day; the engine produces everything else (renewals, dunning, credits). */
const TIMELINE: ReadonlyArray<readonly [number, Action]> = [
  [0, { kind: 'subscribe', customer: 'borealis', planId: 'plan_team_monthly' }],
  [0, { kind: 'subscribe', customer: 'kettle', planId: 'plan_business_yearly' }],
  [3, { kind: 'subscribe', customer: 'pinegrove', planId: 'plan_starter_monthly' }],
  [5, { kind: 'subscribe', customer: 'tundra', planId: 'plan_starter_monthly' }],
  [10, { kind: 'subscribe', customer: 'lumen', planId: 'plan_business_monthly' }],
  [12, { kind: 'new_card', customer: 'lumen', card: 'succeeds' }],
  [15, { kind: 'subscribe', customer: 'saltmarsh', planId: 'plan_team_monthly' }],
  [20, { kind: 'subscribe', customer: 'quarry', planId: 'plan_business_monthly' }],
  [30, { kind: 'subscribe', customer: 'halcyon', planId: 'plan_starter_monthly' }],
  [40, { kind: 'change_plan', customer: 'pinegrove', planId: 'plan_team_monthly' }],
  [45, { kind: 'subscribe', customer: 'orchid', planId: 'plan_team_yearly' }],
  [55, { kind: 'subscribe', customer: 'copperline', planId: 'plan_business_monthly' }],
  [60, { kind: 'subscribe', customer: 'wayfarer', planId: 'plan_team_monthly' }],
  [62, { kind: 'refund_first_invoice', customer: 'copperline' }],
  [70, { kind: 'change_plan', customer: 'saltmarsh', planId: 'plan_starter_monthly' }],
  [85, { kind: 'cancel', customer: 'quarry' }],
  [110, { kind: 'subscribe', customer: 'juniper', planId: 'plan_starter_monthly' }],
  [117, { kind: 'subscribe', customer: 'dune', planId: 'plan_business_monthly' }],
];

export interface DemoSeedOptions {
  engine: BillingEngine;
  provider: FakePayrail;
  /** The seeded history ends here; the test clock is left at this instant. */
  end: Date;
  days?: number;
  /** Called as each simulated day starts, before its due work runs. */
  onDay?: (at: Date) => void;
}

export interface DemoSeedSummary {
  from: Date;
  to: Date;
  customers: number;
}

/**
 * Seeds an empty store with a few months of history by driving the engine
 * day by day on the test clock, delivering Payrail webhooks along the way.
 */
export async function seedDemo(options: DemoSeedOptions): Promise<DemoSeedSummary> {
  const { engine, provider, end } = options;
  const days = options.days ?? 120;
  if ((await engine.listCustomers({ limit: 1 })).length > 0) {
    throw new Error('the store already has customers; seed an empty database');
  }
  const from = new Date(end.getTime() - days * DAY_MS);
  await engine.syncPlans(PLAN_CATALOG);
  await engine.setClock(from);

  const customerIds = new Map<CustomerKey, string>();
  const subscriptionIds = new Map<CustomerKey, string>();

  const deliverEvents = async (at: Date) => {
    for (const event of provider.drainEvents()) await engine.receiveProviderEvent(event, at);
  };

  const attachCard = (customerId: string, card: Card, at: Date) =>
    engine.attachPaymentMethod(customerId, { number: PAYRAIL_TEST_CARDS[card], expMonth: 12, expYear: end.getUTCFullYear() + 3 }, at);

  const run = async (action: Action, at: Date) => {
    const subscriptionId = subscriptionIds.get(action.customer);
    switch (action.kind) {
      case 'subscribe': {
        const profile: DemoCustomer = CUSTOMERS[action.customer];
        const slug = profile.name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '');
        const customer = await engine.createCustomer({ name: profile.name, email: `billing@${slug}.example.com`, currency: profile.currency }, at);
        await attachCard(customer.id, profile.card, at);
        customerIds.set(action.customer, customer.id);
        const subscription = await engine.createSubscription({ customerId: customer.id, planId: action.planId }, at);
        subscriptionIds.set(action.customer, subscription.id);
        return;
      }
      case 'change_plan':
        if (subscriptionId) await engine.changePlan(subscriptionId, action.planId, at);
        return;
      case 'cancel':
        if (subscriptionId) await engine.cancelAtPeriodEnd(subscriptionId, at);
        return;
      case 'new_card': {
        const customerId = customerIds.get(action.customer);
        if (customerId) await attachCard(customerId, action.card, at);
        return;
      }
      case 'refund_first_invoice': {
        if (!subscriptionId) return;
        const paid = (await engine.listInvoices({ subscriptionId, status: 'paid' })).at(-1);
        if (paid) await engine.refundInvoice(paid.id, at);
        return;
      }
    }
  };

  let at = from;
  for (let day = 0; ; day++) {
    for (const [when, action] of TIMELINE) {
      if (when === day) await run(action, at);
    }
    await deliverEvents(at);
    if (at >= end) break;
    at = new Date(Math.min(at.getTime() + DAY_MS, end.getTime()));
    options.onDay?.(at);
    await engine.advanceClock(at);
    await deliverEvents(at);
  }

  return { from, to: end, customers: customerIds.size };
}
