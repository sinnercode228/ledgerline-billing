import { useResource } from '../../api/api-context';
import { useI18n } from '../../i18n/i18n';
import { Card } from '../../ui/Card';
import { Chip, type Tone } from '../../ui/Chip';
import { Loaded } from '../../ui/Loaded';
import { Money } from '../../ui/Money';
import { DateText, RouteLink } from '../../ui/bits';
import type { Directory } from '../directory';
import { fetchAll } from '../shared';

const HORIZON_DAYS = 30;
const SHOWN = 8;

type Kind = 'trialEnds' | 'renews' | 'cancels' | 'retry';
const TONES: Record<Kind, Tone> = { trialEnds: 'info', renews: 'neutral', cancels: 'warning', retry: 'negative' };

interface Upcoming {
  at: string;
  kind: Kind;
  customerId: string;
  amount: { value: number; currency: 'RUB' | 'EUR' } | null;
}

/** What the engine will do next if the clock moves: the guide to the demo's buttons. */
export function ComingUp({ directory }: { directory: Directory | undefined }) {
  const { t } = useI18n();
  const upcoming = useResource('overview:coming-up', async (api) => {
    const [clock, subscriptions, open] = await Promise.all([
      api.clock(),
      fetchAll((page) => api.subscriptions(page)),
      fetchAll((page) => api.invoices({ status: 'open', ...page })),
    ]);
    const now = clock.now ?? new Date().toISOString();
    const horizon = new Date(Date.parse(now) + HORIZON_DAYS * 86_400_000).toISOString();
    const events: Upcoming[] = [];
    for (const subscription of subscriptions) {
      if (subscription.status !== 'active' && subscription.status !== 'trialing') continue;
      const kind: Kind = subscription.cancelAtPeriodEnd ? 'cancels' : subscription.status === 'trialing' ? 'trialEnds' : 'renews';
      events.push({ at: subscription.currentPeriodEnd, kind, customerId: subscription.customerId, amount: null });
    }
    for (const invoice of open) {
      if (invoice.nextRetryAt === null) continue;
      events.push({ at: invoice.nextRetryAt, kind: 'retry', customerId: invoice.customerId, amount: { value: invoice.amountDue - invoice.amountPaid, currency: invoice.currency } });
    }
    return events.filter((event) => event.at > now && event.at <= horizon).sort((a, b) => a.at.localeCompare(b.at)).slice(0, SHOWN);
  });

  return (
    <Card title={t('overview.comingUp')} subtitle={t('overview.comingUpHint')} flush>
      <Loaded resource={upcoming} rows={5}>
        {(events) =>
          events.length === 0 ? (
            <p className="empty">{t('overview.nothingSoon')}</p>
          ) : (
            <ul className="attention-list">
              {events.map((event) => (
                <li key={`${event.kind}-${event.customerId}-${event.at}`}>
                  <div>
                    <RouteLink to={{ page: 'customer', id: event.customerId }}>{directory?.customers.get(event.customerId)?.name ?? event.customerId}</RouteLink>
                    <span className="cell-sub">
                      <DateText iso={event.at} />
                    </span>
                  </div>
                  <div className="attention-side">
                    <Chip tone={TONES[event.kind]}>{t(`upcoming.${event.kind}`)}</Chip>
                    {event.amount && <Money amount={event.amount.value} currency={event.amount.currency} />}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
    </Card>
  );
}
