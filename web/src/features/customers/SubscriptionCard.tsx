import { useState } from 'react';
import { useApi, useRefresh } from '../../api/api-context';
import type { InvoiceDto, JournalTransactionDto, PlanDto, SubscriptionDto } from '../../api/types';
import { useI18n } from '../../i18n/i18n';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { StatusChip } from '../../ui/Chip';
import { Money } from '../../ui/Money';
import { DateText, Mono, PeriodText, RouteLink } from '../../ui/bits';
import { errorMessage, planLabel } from '../shared';
import { ChangePlanDialog } from './ChangePlanDialog';
import { subscriptionHistory, type HistoryEvent } from './history';

interface SubscriptionCardProps {
  subscription: SubscriptionDto;
  plans: readonly PlanDto[];
  invoices: readonly InvoiceDto[];
  downgradeCredits: readonly JournalTransactionDto[];
  now: string;
}

function HistoryLine({ event, plans, subscription }: { event: HistoryEvent; plans: readonly PlanDto[]; subscription: SubscriptionDto }) {
  const { t, period } = useI18n();
  const text = {
    subscribed: () => t('history.subscribed', { plan: planLabel(plans, event.planId ?? subscription.planId) }),
    trialEnded: () => t('history.trialEnded'),
    renewed: () => t('history.renewed', { period: event.invoice ? period(event.invoice.periodStart, event.invoice.periodEnd) : '' }),
    prorated: () => t('history.prorated'),
    downgradeCredit: () => t('history.downgradeCredit'),
    paymentFailed: () => t('history.paymentFailed'),
    writtenOff: () => t('history.writtenOff'),
    canceled: () => t('history.canceled'),
  }[event.kind]();
  const tone = event.kind === 'paymentFailed' || event.kind === 'writtenOff' ? 'is-bad' : event.kind === 'canceled' ? 'is-muted' : '';
  return (
    <li className={tone}>
      <span className="timeline-date">
        <DateText iso={event.at} />
      </span>
      <span className="timeline-text">
        {text}
        {event.invoice?.number && (
          <>
            {' · '}
            <RouteLink to={{ page: 'invoice', id: event.invoice.id }}>
              <Mono>{event.invoice.number}</Mono>
            </RouteLink>
          </>
        )}
      </span>
      {event.amount !== undefined && event.amount > 0 && (
        <span className="timeline-amount">
          <Money amount={event.amount} currency={subscription.currency} />
        </span>
      )}
    </li>
  );
}

export function SubscriptionCard({ subscription, plans, invoices, downgradeCredits, now }: SubscriptionCardProps) {
  const api = useApi();
  const refresh = useRefresh();
  const i18n = useI18n();
  const { t } = i18n;
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const plan = plans.find((candidate) => candidate.id === subscription.planId);
  const price = plan?.prices[subscription.currency];
  const live = subscription.status === 'active' || subscription.status === 'trialing';
  const changeable = live && plans.some((other) => other.id !== plan?.id && other.interval === plan?.interval && other.prices[subscription.currency] !== undefined);

  async function toggleCancel() {
    setBusy(true);
    setFailure(null);
    try {
      await (subscription.cancelAtPeriodEnd ? api.resume(subscription.id) : api.cancelAtPeriodEnd(subscription.id));
      refresh();
    } catch (error) {
      setFailure(errorMessage(i18n, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={t('customer.subscription')}
      subtitle={<Mono>{subscription.id}</Mono>}
      actions={
        live && (
          <>
            {changeable && (
              <Button size="sm" variant="primary" onClick={() => setChanging(true)}>
                {t('customer.changePlan')}
              </Button>
            )}
            <Button size="sm" busy={busy} onClick={() => void toggleCancel()}>
              {subscription.cancelAtPeriodEnd ? t('customer.resume') : t('customer.cancel')}
            </Button>
          </>
        )
      }
    >
      <div className="subscription-head">
        <div>
          <div className="subscription-plan">{plan?.name ?? subscription.planId}</div>
          {price !== undefined && plan && (
            <div className="muted">
              <Money amount={price} currency={subscription.currency} /> {t(`interval.${plan.interval}`)}
            </div>
          )}
        </div>
        <StatusChip status={subscription.status} />
      </div>
      <dl className="facts">
        <div>
          <dt>{subscription.status === 'trialing' ? t('customer.trialEnds') : t('customer.currentPeriod')}</dt>
          <dd>
            {subscription.status === 'trialing' ? (
              <DateText iso={subscription.trialEnd} />
            ) : (
              <PeriodText start={subscription.currentPeriodStart} end={subscription.currentPeriodEnd} />
            )}
          </dd>
        </div>
        {subscription.cancelAtPeriodEnd && subscription.status !== 'canceled' && (
          <div>
            <dt>{t('common.status')}</dt>
            <dd className="text-warning">{t('customer.cancelsOn', { date: i18n.date(subscription.currentPeriodEnd) })}</dd>
          </div>
        )}
        {subscription.endedAt && (
          <div>
            <dt>{t('common.status')}</dt>
            <dd>{t('customer.endedOn', { date: i18n.date(subscription.endedAt) })}</dd>
          </div>
        )}
      </dl>
      {failure && (
        <p className="notice notice-negative" role="alert">
          {failure}
        </p>
      )}
      <h3 className="subhead">{t('customer.history')}</h3>
      <ol className="timeline">
        {subscriptionHistory(subscription, invoices, downgradeCredits, now).map((event, i) => (
          <HistoryLine key={`${event.kind}-${event.at}-${i}`} event={event} plans={plans} subscription={subscription} />
        ))}
      </ol>
      {changing && (
        <ChangePlanDialog
          subscription={subscription}
          plans={plans}
          onClose={() => setChanging(false)}
          onChanged={() => {
            setChanging(false);
            refresh();
          }}
        />
      )}
    </Card>
  );
}
