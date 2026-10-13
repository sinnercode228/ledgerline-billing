import type { TrialBalanceDto } from '../../api/types';
import { useI18n } from '../../i18n/i18n';
import { Icon } from '../../ui/Icon';

/**
 * Debits minus credits over the whole ledger, per currency. It must read 0;
 * anything else is shown loudly, with the currency and the difference.
 */
export function TrialBalanceIndicator({ trialBalance }: { trialBalance: TrialBalanceDto | undefined }) {
  const { t, amount, money } = useI18n();
  const state = trialBalance === undefined ? 'loading' : trialBalance.balanced ? 'balanced' : 'unbalanced';
  const off = trialBalance?.currencies.filter((row) => row.net !== 0) ?? [];
  return (
    <a className="trial-indicator" href="#/ledger/trial-balance" role="status" aria-live="polite" data-state={state}>
      <span className="trial-label">{t('trial.label')}</span>
      {state === 'unbalanced' ? (
        <span className="trial-value">
          {off.map((row) => (
            <span key={row.currency} className="num">
              {money(row.net, row.currency)}
            </span>
          ))}
        </span>
      ) : (
        <span className="trial-value num">{state === 'balanced' ? amount(0) : '…'}</span>
      )}
      {state !== 'loading' && (
        <span className="trial-state">
          <Icon name={state === 'balanced' ? 'check' : 'alert'} size={14} />
          {t(state === 'balanced' ? 'trial.balanced' : 'trial.unbalanced')}
        </span>
      )}
    </a>
  );
}
