import { useEffect } from 'react';
import { CustomerPage } from '../features/customers/CustomerPage';
import { CustomersPage } from '../features/customers/CustomersPage';
import { ClockBar } from '../features/clock/ClockBar';
import { InvoicePage } from '../features/invoices/InvoicePage';
import { InvoicesPage } from '../features/invoices/InvoicesPage';
import { LedgerPage } from '../features/ledger/LedgerPage';
import { OverviewPage } from '../features/overview/OverviewPage';
import { WebhooksPage } from '../features/webhooks/WebhooksPage';
import { useI18n } from '../i18n/i18n';
import { PageHeader } from '../ui/bits';
import type { Connection } from './connection';
import { PageBoundary } from './PageBoundary';
import { Sidebar } from './Sidebar';
import { hrefFor, useRoute, type Route } from './routes';

function Page({ route }: { route: Route }) {
  const { t } = useI18n();
  switch (route.page) {
    case 'overview':
      return <OverviewPage />;
    case 'customers':
      return <CustomersPage />;
    case 'customer':
      return <CustomerPage key={route.id} id={route.id} />;
    case 'invoices':
      return <InvoicesPage status={route.status} />;
    case 'invoice':
      return <InvoicePage key={route.id} id={route.id} />;
    case 'ledger':
      return <LedgerPage tab={route.tab} />;
    case 'webhooks':
      return <WebhooksPage />;
    case 'not-found':
      return <PageHeader title={t('common.notFound')} back={{ to: { page: 'overview' }, label: t('nav.overview') }} />;
  }
}

export function App({ connection }: { connection: Connection }) {
  const route = useRoute();
  const { t } = useI18n();

  const location = hrefFor(route);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  useEffect(() => {
    document.title = `${t('app.name')} · ${t('app.tagline')}`;
  }, [t]);

  return (
    <div className="app">
      <ClockBar />
      <div className="shell">
        <Sidebar route={route} connection={connection} />
        <main className="content" id="main">
          <PageBoundary key={location}>
            <Page route={route} />
          </PageBoundary>
        </main>
      </div>
    </div>
  );
}
