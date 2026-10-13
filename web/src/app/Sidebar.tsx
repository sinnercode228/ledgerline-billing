import { useState } from 'react';
import { useRevision } from '../api/api-context';
import { useI18n } from '../i18n/i18n';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import type { Connection } from './connection';
import { hrefFor, type Route } from './routes';

const SECTIONS = [
  { page: 'overview', to: { page: 'overview' }, label: 'nav.overview' },
  { page: 'customers', to: { page: 'customers' }, label: 'nav.customers' },
  { page: 'invoices', to: { page: 'invoices', status: null }, label: 'nav.invoices' },
  { page: 'ledger', to: { page: 'ledger', tab: 'journal' }, label: 'nav.ledger' },
  { page: 'webhooks', to: { page: 'webhooks' }, label: 'nav.webhooks' },
] as const satisfies ReadonlyArray<{ page: string; to: Route; label: string }>;

/** Detail pages belong to the section of their list. */
function sectionOf(route: Route): string {
  if (route.page === 'customer') return 'customers';
  if (route.page === 'invoice') return 'invoices';
  return route.page;
}

function DemoNote({ reset, saveFailed }: { reset: () => void; saveFailed: () => boolean }) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  // Every change saves the world; read the outcome again after each one.
  useRevision();
  return (
    <div className="side-note">
      <p>{t('demo.note')}</p>
      {saveFailed() && <p className="side-note-warning">{t('demo.notSaved')}</p>}
      <button type="button" className="link-button" onClick={() => setConfirming(true)}>
        <Icon name="reset" size={14} />
        {t('demo.reset')}
      </button>
      {confirming && (
        <Dialog
          title={t('demo.reset')}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
              <Button variant="danger" onClick={reset}>
                {t('demo.reset')}
              </Button>
            </>
          }
        >
          <p>{t('demo.resetConfirm')}</p>
        </Dialog>
      )}
    </div>
  );
}

export function Sidebar({ route, connection }: { route: Route; connection: Connection }) {
  const { t } = useI18n();
  const current = sectionOf(route);
  return (
    <aside className="sidebar">
      <nav className="side-nav" aria-label={t('nav.label')}>
        {SECTIONS.map((section) => (
          <a key={section.page} href={hrefFor(section.to)} aria-current={current === section.page ? 'page' : undefined}>
            {t(section.label)}
          </a>
        ))}
      </nav>
      {connection.kind === 'demo' ? (
        <DemoNote reset={connection.reset} saveFailed={connection.saveFailed} />
      ) : (
        <div className="side-note">
          <p className="mono">{connection.baseUrl}</p>
          <button type="button" className="link-button" onClick={connection.forgetKey}>
            {t('auth.signOut')}
          </button>
        </div>
      )}
    </aside>
  );
}
