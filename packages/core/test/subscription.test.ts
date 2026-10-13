import { describe, expect, it } from 'vitest';
import { nextPeriod, transition, type Subscription } from '../src/subscription.js';

describe('subscription state machine', () => {
  it('follows the documented lifecycle', () => {
    expect(transition('trialing', 'trial_ended')).toBe('active');
    expect(transition('active', 'payment_failed')).toBe('past_due');
    expect(transition('past_due', 'payment_failed')).toBe('past_due');
    expect(transition('past_due', 'payment_recovered')).toBe('active');
    expect(transition('past_due', 'dunning_exhausted')).toBe('canceled');
    expect(transition('active', 'period_ended_canceled')).toBe('canceled');
    expect(transition('trialing', 'period_ended_canceled')).toBe('canceled');
  });

  it('rejects transitions that skip a step or leave a terminal state', () => {
    expect(() => transition('trialing', 'payment_recovered')).toThrow(/trialing/);
    expect(() => transition('canceled', 'payment_recovered')).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    expect(() => transition('past_due', 'trial_ended')).toThrow();
  });

  it('computes the next period from the anchor, not from the previous end', () => {
    const sub = {
      billingAnchor: new Date('2026-01-31T09:00:00Z'),
      paidCycles: 1,
      currentPeriodStart: new Date('2026-01-31T09:00:00Z'),
      currentPeriodEnd: new Date('2026-02-28T09:00:00Z'),
    } satisfies Partial<Subscription>;
    const second = nextPeriod(sub, 'month');
    expect(second.start.toISOString()).toBe('2026-02-28T09:00:00.000Z');
    expect(second.end.toISOString()).toBe('2026-03-31T09:00:00.000Z');
    const third = nextPeriod({ ...sub, paidCycles: 2, currentPeriodStart: second.start, currentPeriodEnd: second.end }, 'month');
    expect(third.end.toISOString()).toBe('2026-04-30T09:00:00.000Z');
  });

  it('starts the first paid period exactly where the trial ends', () => {
    const trialEnd = new Date('2026-02-14T09:00:00Z');
    const first = nextPeriod(
      { billingAnchor: trialEnd, paidCycles: 0, currentPeriodStart: new Date('2026-01-31T09:00:00Z'), currentPeriodEnd: trialEnd },
      'month',
    );
    expect(first).toEqual({ start: trialEnd, end: new Date('2026-03-14T09:00:00Z') });
  });
});
