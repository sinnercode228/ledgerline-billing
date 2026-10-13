import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClockBar } from '../src/features/clock/ClockBar';
import { renderWith } from './helpers/render';

const balanced = async () => ({ balanced: true, currencies: [] });

describe('ClockBar', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the simulated date and the buttons that move it', async () => {
    renderWith(<ClockBar />, { api: { clock: async () => ({ enabled: true, now: '2026-10-13T09:00:00.000Z' }), trialBalance: balanced } });
    expect(await screen.findByRole('button', { name: '+1 day' })).toBeEnabled();
    expect(screen.getByText('Simulated date')).toBeInTheDocument();
    expect(document.querySelector('.clock-date')).toHaveTextContent('Tue, 13 Oct 202609:00 UTC');
  });

  it('shows the real date and time when the server runs on the wall clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T10:59:30Z'));
    renderWith(<ClockBar />, { api: { clock: async () => ({ enabled: false, now: null }), trialBalance: balanced } });
    expect(await screen.findByText('The test clock is off on this server')).toBeInTheDocument();
    expect(screen.getByText('Live clock')).toBeInTheDocument();
    expect(document.querySelector('.clock-date')).toHaveTextContent('Tue, 13 Oct 202610:59 UTC');
    expect(screen.queryByRole('button', { name: '+1 day' })).not.toBeInTheDocument();
  });
});
