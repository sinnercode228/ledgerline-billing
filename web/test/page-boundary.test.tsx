import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageBoundary } from '../src/app/PageBoundary';
import { renderWith } from './helpers/render';

let broken = true;

function FlakyPage() {
  if (broken) throw new Error('invoice inv_1 has no lines');
  return <h1>Invoice LL-2026-000001</h1>;
}

describe('PageBoundary', () => {
  afterEach(() => {
    broken = true;
    vi.restoreAllMocks();
  });

  it('keeps a failing page inside its frame and lets the visitor try again', async () => {
    // React reports every caught render error on the console; the test reads it from the screen instead.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWith(
      <>
        <nav>Ledger</nav>
        <PageBoundary>
          <FlakyPage />
        </PageBoundary>
      </>,
    );

    expect(screen.getByRole('heading')).toHaveTextContent('This page could not be shown.');
    expect(screen.getByRole('alert')).toHaveTextContent('invoice inv_1 has no lines');
    expect(screen.getByRole('navigation')).toHaveTextContent('Ledger');

    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('heading')).toHaveTextContent('Invoice LL-2026-000001');
  });
});
