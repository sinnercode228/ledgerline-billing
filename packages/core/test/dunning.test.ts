import { describe, expect, it } from 'vitest';
import { decideAfterFailure, parseRetrySchedule } from '../src/dunning.js';

const firstFailedAt = new Date('2026-05-10T06:00:00Z');
const policy = { retryDays: [1, 3, 5] };

describe('dunning', () => {
  it('retries 1, 3 and 5 days after the first failure, then gives up', () => {
    const at = (scheduledRetries: number, now = firstFailedAt) => decideAfterFailure({ policy, firstFailedAt, scheduledRetries, now });
    expect(at(0)).toEqual({ action: 'retry', at: new Date('2026-05-11T06:00:00Z') });
    expect(at(1, new Date('2026-05-11T06:00:00Z'))).toEqual({ action: 'retry', at: new Date('2026-05-13T06:00:00Z') });
    expect(at(2, new Date('2026-05-13T06:00:00Z'))).toEqual({ action: 'retry', at: new Date('2026-05-15T06:00:00Z') });
    expect(at(3, new Date('2026-05-15T06:00:00Z'))).toEqual({ action: 'give_up' });
  });

  it('keeps the schedule when an out-of-band retry fails', () => {
    // A retry after a new card was attached does not consume a scheduled slot.
    const decision = decideAfterFailure({ policy, firstFailedAt, scheduledRetries: 1, now: new Date('2026-05-12T00:00:00Z') });
    expect(decision).toEqual({ action: 'retry', at: new Date('2026-05-13T06:00:00Z') });
  });

  it('retries immediately when the failure is learned after the scheduled time', () => {
    const now = new Date('2026-05-14T00:00:00Z');
    expect(decideAfterFailure({ policy, firstFailedAt, scheduledRetries: 1, now })).toEqual({ action: 'retry', at: now });
  });

  it('gives up on the first failure when no retries are configured', () => {
    expect(decideAfterFailure({ policy: { retryDays: [] }, firstFailedAt, scheduledRetries: 0, now: firstFailedAt })).toEqual({
      action: 'give_up',
    });
  });

  it('parses a schedule from configuration', () => {
    expect(parseRetrySchedule('1,3,5')).toEqual([1, 3, 5]);
    expect(parseRetrySchedule(' 2, 4 ,7 ')).toEqual([2, 4, 7]);
    expect(parseRetrySchedule('')).toEqual([]);
    expect(() => parseRetrySchedule('3,1')).toThrow(/increasing/);
    expect(() => parseRetrySchedule('0,2')).toThrow(/positive/);
    expect(() => parseRetrySchedule('1,two')).toThrow(/positive/);
  });
});
