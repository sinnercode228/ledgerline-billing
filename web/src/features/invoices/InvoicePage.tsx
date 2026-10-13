import { useResource } from '../../api/api-context';
import type { InvoiceDetail, JournalTransactionDto, PlanDto } from '../../api/types';
import { useI18n, type I18n } from '../../i18n/i18n';
import { Button } from '../../ui/Button';
import { Card, TableScroll } from '../../ui/Card';
import { StatusChip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { Loaded } from '../../ui/Loaded';
import { Money } from '../../ui/Money';
import { DateText, Mono, PageHeader, PeriodText, RouteLink } from '../../ui/bits';
import { JournalEntries } from '../ledger/JournalEntries';
import { fetchAll, lineDescription } from '../shared';
import { invoiceTimeline, type InvoiceEvent } from './timeline';

const KNOWN_FAILURES = ['card_declined', 'insufficient_funds', 'payment_method_missing'] as const;

/** Payrail's failure code in words, or the code itself when it is one we have no words for. */
function failureReason(t: I18n['t'], code: string | null): string {
  const known = KNOWN_FAILURES.find((failure) => failure === code);
  return known ? t(`failure.${known}`) : (code ?? '');
}

function TimelineText({ event }: { event: InvoiceEvent }) {
  const { t } = useI18n();
  switch (event.kind) {
    case 'created':
      return <>{t('timeline.created')}</>;
    case 'finalized':
      return <>{t('timeline.finalized', { number: event.number })}</>;
    case 'attempt': {
      const { attempt, status, failureCode } = event.payment;
      if (status === 'failed') return <>{t('timeline.attemptFailed', { attempt, reason: failureReason(t, failureCode) })}</>;
      if (status === 'succeeded') return <>{t('timeline.attemptSucceeded', { attempt })}</>;
      return <>{t('timeline.attemptPending', { attempt })}</>;
    }
    case 'paid':
      return <>{t('timeline.paid')}</>;
    case 'uncollectible':
      return <>{t('timeline.uncollectible')}</>;
    case 'refunded':
      return <>{t('timeline.refunded')}</>;
    case 'retryScheduled':
      return <>{t('timeline.retryScheduled')}</>;
  }
}

function toneOf(event: InvoiceEvent): string {
  if (event.kind === 'uncollectible' || (event.kind === 'attempt' && event.payment.status === 'failed')) return 'is-bad';
  if (event.kind === 'paid' || (event.kind === 'attempt' && event.payment.status === 'succeeded')) return 'is-good';
  if (event.kind === 'retryScheduled') return 'is-future';
  return '';
}

function InvoiceDocument({ invoice, plans, customer }: { invoice: InvoiceDetail; plans: readonly PlanDto[]; customer: { name: string; email: string } }) {
  const i18n = useI18n();
  const { t } = i18n;
  const outstanding = invoice.status === 'uncollectible' || invoice.status === 'open' ? invoice.amountDue - invoice.amountPaid : 0;
  return (
    <article className="card invoice-doc">
      <header className="invoice-doc-head">
        <div className="invoice-issuer">
          <span className="invoice-issuer-name">{t('app.name')}</span>
          <span className="muted">{t('app.tagline')}</span>
        </div>
        <div className="invoice-id">
          <span className="invoice-id-label">{invoice.number ? t('invoice.label') : t('invoice.draft')}</span>
          <Mono>{invoice.number ?? invoice.id}</Mono>
          <StatusChip status={invoice.status} />
        </div>
      </header>
      <dl className="invoice-meta">
        <div>
          <dt>{t('invoice.billTo')}</dt>
          <dd>
            <RouteLink to={{ page: 'customer', id: invoice.customerId }}>{customer.name}</RouteLink>
            <span className="cell-sub">{customer.email}</span>
          </dd>
        </div>
        <div>
          <dt>{t('invoice.issued')}</dt>
          <dd>
            <DateText iso={invoice.finalizedAt} />
          </dd>
        </div>
        <div>
          <dt>{t('invoice.period')}</dt>
          <dd>
            <PeriodText start={invoice.periodStart} end={invoice.periodEnd} />
          </dd>
        </div>
        <div>
          <dt>{t('invoice.paidAt')}</dt>
          <dd>
            <DateText iso={invoice.paidAt} />
          </dd>
        </div>
      </dl>
      <TableScroll label={t('invoice.description')}>
        <table className="table invoice-lines">
          <thead>
            <tr>
              <th scope="col">{t('invoice.description')}</th>
              <th scope="col">{t('common.period')}</th>
              <th scope="col" className="cell-num">
                {t('common.amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, i) => (
              <tr key={`${line.kind}-${i}`}>
                <td>{lineDescription(i18n, plans, line)}</td>
                <td>
                  <PeriodText start={line.periodStart} end={line.periodEnd} />
                </td>
                <td className="cell-num">
                  <Money amount={line.amount} currency={invoice.currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <dl className="totals">
        <div>
          <dt>{t('invoice.total')}</dt>
          <dd>
            <Money amount={invoice.total} currency={invoice.currency} />
          </dd>
        </div>
        {invoice.creditApplied > 0 && (
          <div>
            <dt>{t('invoice.creditApplied')}</dt>
            <dd>
              <Money amount={-invoice.creditApplied} currency={invoice.currency} />
            </dd>
          </div>
        )}
        <div className="totals-strong">
          <dt>{t('invoice.amountDue')}</dt>
          <dd>
            <Money amount={invoice.amountDue} currency={invoice.currency} />
          </dd>
        </div>
        <div>
          <dt>{t('invoice.amountPaid')}</dt>
          <dd>
            <Money amount={invoice.amountPaid} currency={invoice.currency} />
          </dd>
        </div>
        {invoice.amountRefunded > 0 && (
          <div>
            <dt>{t('invoice.refunded')}</dt>
            <dd>
              <Money amount={invoice.amountRefunded} currency={invoice.currency} />
            </dd>
          </div>
        )}
        {outstanding > 0 && (
          <div className="totals-alert">
            <dt>{t('invoice.outstanding')}</dt>
            <dd>
              <Money amount={outstanding} currency={invoice.currency} />
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}

function Payments({ invoice }: { invoice: InvoiceDetail }) {
  const { t } = useI18n();
  return (
    <Card title={t('invoice.payments')} flush className="print-hidden">
      {invoice.payments.length === 0 ? (
        <p className="empty">{t('invoice.noPayments')}</p>
      ) : (
        <TableScroll label={t('invoice.payments')}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('invoice.attempt')}</th>
                <th scope="col">{t('common.date')}</th>
                <th scope="col">{t('invoice.trigger')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('invoice.failure')}</th>
                <th scope="col" className="cell-num">
                  {t('common.amount')}
                </th>
                <th scope="col">{t('invoice.providerId')}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="num">#{payment.attempt}</td>
                  <td className="cell-date">
                    <DateText iso={payment.createdAt} style="dateTime" />
                  </td>
                  <td>{t(`trigger.${payment.trigger}`)}</td>
                  <td>
                    <StatusChip status={payment.status} />
                  </td>
                  <td>{payment.failureCode ? failureReason(t, payment.failureCode) : <span className="faint">—</span>}</td>
                  <td className="cell-num">
                    <Money amount={payment.amount} currency={payment.currency} />
                  </td>
                  <td>{payment.providerPaymentId ? <Mono>{payment.providerPaymentId}</Mono> : <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}

function Timeline({ invoice, journal }: { invoice: InvoiceDetail; journal: readonly JournalTransactionDto[] }) {
  const { t } = useI18n();
  return (
    <Card title={t('invoice.timeline')} className="print-hidden">
      <ol className="timeline timeline-with-time">
        {invoiceTimeline(invoice, journal).map((event, i) => (
          <li key={`${event.kind}-${i}`} className={toneOf(event)}>
            <span className="timeline-date">
              <DateText iso={event.at} style="dateTime" />
            </span>
            <span className="timeline-text">
              <TimelineText event={event} />
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function InvoicePage({ id }: { id: string }) {
  const { t } = useI18n();
  const data = useResource(`invoice:${id}`, async (api) => {
    const invoice = await api.invoice(id);
    const [customer, plans, journal] = await Promise.all([
      api.customer(invoice.customerId),
      api.plans(),
      fetchAll((page) => api.journal({ invoiceId: id, ...page })),
    ]);
    return { invoice, customer, plans, journal };
  });
  return (
    <Loaded resource={data} rows={10}>
      {({ invoice, customer, plans, journal }) => (
        <>
          <PageHeader
            back={{ to: { page: 'invoices', status: null }, label: t('invoices.title') }}
            title={invoice.number ? t('invoice.title', { number: invoice.number }) : t('invoice.draft')}
            actions={
              <Button onClick={() => window.print()}>
                <Icon name="printer" />
                {t('invoice.print')}
              </Button>
            }
          />
          <div className="grid-main-side">
            <InvoiceDocument invoice={invoice} plans={plans} customer={customer} />
            <Timeline invoice={invoice} journal={journal} />
          </div>
          <Payments invoice={invoice} />
          <Card title={t('ledger.journal')} flush className="print-hidden">
            <JournalEntries transactions={[...journal].reverse()} />
          </Card>
        </>
      )}
    </Loaded>
  );
}
