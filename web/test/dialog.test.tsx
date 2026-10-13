import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../src/ui/Dialog';
import { renderWith } from './helpers/render';

function Opener({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    // A sticky sidebar is a stacking context of its own: a dialog left inside it can end up under the page.
    <aside style={{ position: 'sticky', top: 0 }}>
      <button type="button" onClick={() => setOpen(true)}>
        Reset
      </button>
      {open && (
        <Dialog
          title="Reset the demo"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          footer={<button type="button">Start over</button>}
        >
          <p>Start over with a fresh six months of history?</p>
        </Dialog>
      )}
    </aside>
  );
}

describe('Dialog', () => {
  it('opens at the top of the document, whatever opened it', async () => {
    renderWith(<Opener onClose={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    const dialog = screen.getByRole('dialog', { name: 'Reset the demo' });
    expect(dialog.closest('aside')).toBeNull();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it('takes focus, closes on Escape and gives focus back', async () => {
    const onClose = vi.fn();
    renderWith(<Opener onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Reset' });
    await userEvent.click(opener);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});
