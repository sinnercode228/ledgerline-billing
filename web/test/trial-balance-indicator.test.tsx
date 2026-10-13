import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrialBalanceIndicator } from '../src/features/clock/TrialBalanceIndicator';
import { renderWith } from './helpers/render';

const balanced = {
  balanced: true,
  currencies: [
    { currency: 'RUB' as const, debits: 36_824_646, credits: 36_824_646, net: 0 },
    { currency: 'EUR' as const, debits: 431_400, credits: 431_400, net: 0 },
  ],
};

describe('TrialBalanceIndicator', () => {
  it('shows a zero and says the books balance', () => {
    renderWith(<TrialBalanceIndicator trialBalance={balanced} />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveTextContent('Trial balance');
    expect(indicator).toHaveTextContent('0.00');
    expect(indicator).toHaveTextContent('Balanced');
    expect(indicator).toHaveAttribute('data-state', 'balanced');
  });

  it('names each currency that is off, and by how much', () => {
    const off = {
      balanced: false,
      currencies: [
        { currency: 'RUB' as const, debits: 100_000, credits: 98_800, net: 1_200 },
        { currency: 'EUR' as const, debits: 500, credits: 500, net: 0 },
      ],
    };
    renderWith(<TrialBalanceIndicator trialBalance={off} />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveTextContent('Out of balance');
    expect(indicator).toHaveTextContent('₽12.00');
    expect(indicator).not.toHaveTextContent('€');
    expect(indicator).toHaveAttribute('data-state', 'unbalanced');
  });

  it('speaks Russian', () => {
    renderWith(<TrialBalanceIndicator trialBalance={balanced} />, { language: 'ru' });
    expect(screen.getByRole('status')).toHaveTextContent('Сходится');
  });

  it('waits quietly while the first numbers load', () => {
    renderWith(<TrialBalanceIndicator trialBalance={undefined} />);
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'loading');
  });
});
