import { useId, useState } from 'react';
import type { ClockAdvanceDto } from '../../api/types';
import { useI18n, type I18n } from '../../i18n/i18n';
import { Icon } from '../../ui/Icon';
import { ACTIVITIES, isQuiet, totalsOf, type Activity, type Totals } from './summary';

const PHRASES: Record<Activity, Parameters<I18n['plural']>[0]> = {
  renewals: 'count.renewals',
  trialsEnded: 'count.trialsEnded',
  paymentsSucceeded: 'count.paymentsSucceeded',
  paymentsFailed: 'count.paymentsFailed',
  retries: 'count.retries',
  canceled: 'count.canceled',
  writtenOff: 'count.writtenOff',
  recoveredPayments: 'count.recovered',
};

const BAD_NEWS = new Set<Activity>(['paymentsFailed', 'canceled', 'writtenOff']);

function Phrases({ totals }: { totals: Totals }) {
  const { plural } = useI18n();
  return (
    <span className="summary-phrases">
      {ACTIVITIES.filter((activity) => totals[activity] > 0).map((activity) => (
        <span key={activity} className={BAD_NEWS.has(activity) ? 'summary-phrase is-bad' : 'summary-phrase'}>
          {plural(PHRASES[activity], totals[activity])}
        </span>
      ))}
    </span>
  );
}

/** What the engine did while the clock moved, from the day reports the advance returned. */
export function AdvanceSummary({ advance, onDismiss }: { advance: ClockAdvanceDto; onDismiss: () => void }) {
  const { t, date } = useI18n();
  const [showDays, setShowDays] = useState(false);
  const titleId = useId();
  const totals = totalsOf(advance.days);
  const busyDays = advance.days.filter((day) => !isQuiet(totalsOf([day])));
  const errors = advance.days.flatMap((day) => day.errors);

  return (
    <section className="advance-summary" aria-labelledby={titleId}>
      <div className="advance-summary-row">
        <h2 id={titleId} className="summary-title">
          {t('summary.title')}
        </h2>
        <span className="summary-range">{t('summary.range', { from: date(advance.from, 'shortDate'), to: date(advance.to, 'shortDate') })}</span>
        {isQuiet(totals) ? <span className="summary-phrases">{t('summary.nothing')}</span> : <Phrases totals={totals} />}
        <span className="summary-actions">
          {busyDays.length > 0 && (
            <button type="button" className="link-button" aria-expanded={showDays} onClick={() => setShowDays((shown) => !shown)}>
              {showDays ? t('summary.hideDays') : t('summary.days')}
            </button>
          )}
          <button type="button" className="icon-button" onClick={onDismiss} aria-label={t('summary.dismiss')}>
            <Icon name="close" size={14} />
          </button>
        </span>
      </div>
      {errors.length > 0 && (
        <p className="summary-errors">
          {t('summary.errors')}: {errors.map((error) => error.message).join('; ')}
        </p>
      )}
      {showDays && (
        <ol className="summary-days">
          {busyDays.map((day) => (
            <li key={day.at}>
              <span className="summary-day">{date(day.at, 'shortDate')}</span>
              <Phrases totals={totalsOf([day])} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
