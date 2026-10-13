import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ClockAdvanceDto, DayReportDto } from '../src/api/types';
import { AdvanceSummary } from '../src/features/clock/AdvanceSummary';
import { totalsOf } from '../src/features/clock/summary';
import { renderWith } from './helpers/render';

const quiet = { trialsEnded: 0, renewals: 0, retries: 0, canceled: 0, recoveredPayments: 0, paymentsSucceeded: 0, paymentsFailed: 0, writtenOff: 0, errors: [] };
const day = (at: string, report: Partial<DayReportDto> = {}): DayReportDto => ({ ...quiet, at, ...report });

const week: ClockAdvanceDto = {
  from: '2026-10-13T09:00:00.000Z',
  to: '2026-10-16T09:00:00.000Z',
  days: [
    day('2026-10-14T09:00:00.000Z', { retries: 1, paymentsFailed: 1, renewals: 2, paymentsSucceeded: 2 }),
    day('2026-10-15T09:00:00.000Z'),
    day('2026-10-16T09:00:00.000Z', { retries: 1, paymentsFailed: 1, writtenOff: 1, canceled: 1 }),
  ],
};

describe('advance summary', () => {
  it('adds up what the days did', () => {
    expect(totalsOf(week.days)).toEqual({
      renewals: 2,
      trialsEnded: 0,
      paymentsSucceeded: 2,
      paymentsFailed: 2,
      retries: 2,
      canceled: 1,
      writtenOff: 1,
      recoveredPayments: 0,
    });
  });

  it('says what happened in words and lists the busy days on request', async () => {
    renderWith(<AdvanceSummary advance={week} onDismiss={() => undefined} />);
    const summary = screen.getByRole('region', { name: 'What happened' });
    expect(summary).toHaveTextContent('2 renewals');
    expect(summary).toHaveTextContent('2 payments failed');
    expect(summary).toHaveTextContent('1 invoice written off');
    expect(summary).not.toHaveTextContent('trial');

    await userEvent.click(screen.getByRole('button', { name: 'Day by day' }));
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('14 Oct'),
      expect.stringContaining('16 Oct'),
    ]);
  });

  it('says so when nothing was due, and can be dismissed', async () => {
    const onDismiss = vi.fn();
    renderWith(<AdvanceSummary advance={{ ...week, days: [day('2026-10-14T09:00:00.000Z')] }} onDismiss={onDismiss} />, { language: 'ru' });
    expect(screen.getByRole('region')).toHaveTextContent('Ничего не наступило.');
    await userEvent.click(screen.getByRole('button', { name: 'Скрыть' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
