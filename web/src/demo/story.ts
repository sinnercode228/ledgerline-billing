import type { DemoStory } from '@ledgerline/core';

/** About six months of history; day 0 is the first seeded day and the last day is today. */
export const DEMO_DAYS = 182;

/**
 * The customers of the in-browser demo and what they do. Everything else
 * (trial ends, renewals, retries, write-offs, credits) is the engine's doing.
 * The last weeks are arranged so that advancing the clock shows something at once:
 * a past-due customer with retries left, a trial about to fail and a cancellation due.
 */
export const BROWSER_STORY: DemoStory = {
  customers: {
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
    marigold: { name: 'Marigold Supply', currency: 'RUB', card: 'succeeds' },
    fernhill: { name: 'Fernhill Clinic', currency: 'EUR', card: 'succeeds' },
    gristmill: { name: 'Gristmill Tools', currency: 'RUB', card: 'declined' },
    alder: { name: 'Alder & Finch', currency: 'EUR', card: 'succeeds' },
    riverbend: { name: 'Riverbend Logistics', currency: 'RUB', card: 'declined' },
  },
  timeline: [
    [0, { kind: 'subscribe', customer: 'borealis', planId: 'plan_team_monthly' }],
    [0, { kind: 'subscribe', customer: 'kettle', planId: 'plan_business_yearly' }],
    [4, { kind: 'subscribe', customer: 'pinegrove', planId: 'plan_starter_monthly' }],
    // The trial ends on day 23 with a declining card: retried, then written off.
    [9, { kind: 'subscribe', customer: 'tundra', planId: 'plan_starter_monthly' }],
    // Charged at once and refused; a new card two days later settles it.
    [15, { kind: 'subscribe', customer: 'lumen', planId: 'plan_business_monthly' }],
    [17, { kind: 'new_card', customer: 'lumen', card: 'succeeds' }],
    [20, { kind: 'subscribe', customer: 'saltmarsh', planId: 'plan_team_monthly' }],
    [26, { kind: 'subscribe', customer: 'quarry', planId: 'plan_business_monthly' }],
    [33, { kind: 'subscribe', customer: 'halcyon', planId: 'plan_starter_monthly' }],
    [41, { kind: 'subscribe', customer: 'orchid', planId: 'plan_team_yearly' }],
    [52, { kind: 'subscribe', customer: 'copperline', planId: 'plan_business_monthly' }],
    [58, { kind: 'refund_first_invoice', customer: 'copperline' }],
    [63, { kind: 'subscribe', customer: 'wayfarer', planId: 'plan_team_monthly' }],
    [70, { kind: 'change_plan', customer: 'pinegrove', planId: 'plan_team_monthly' }],
    [88, { kind: 'subscribe', customer: 'juniper', planId: 'plan_starter_monthly' }],
    // A downgrade: the unused time becomes credit that later renewals spend.
    [95, { kind: 'change_plan', customer: 'saltmarsh', planId: 'plan_starter_monthly' }],
    [110, { kind: 'subscribe', customer: 'dune', planId: 'plan_business_monthly' }],
    [132, { kind: 'subscribe', customer: 'marigold', planId: 'plan_team_monthly' }],
    [145, { kind: 'subscribe', customer: 'fernhill', planId: 'plan_business_monthly' }],
    [150, { kind: 'change_plan', customer: 'juniper', planId: 'plan_team_monthly' }],
    [160, { kind: 'cancel', customer: 'quarry' }],
    // Still trialing today; the trial ends four days from now and the card declines.
    [172, { kind: 'subscribe', customer: 'gristmill', planId: 'plan_starter_monthly' }],
    [175, { kind: 'cancel', customer: 'halcyon' }],
    [178, { kind: 'subscribe', customer: 'alder', planId: 'plan_team_monthly' }],
    // Past due today: refused on day 180 and day 181, retries left on days 183 and 185.
    [180, { kind: 'subscribe', customer: 'riverbend', planId: 'plan_business_monthly' }],
  ],
};
