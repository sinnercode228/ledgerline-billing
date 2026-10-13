import { useId, useState } from 'react';
import { useApi } from '../../api/api-context';
import type { PlanChangePreviewDto, PlanChangeResultDto, PlanDto, SubscriptionDto } from '../../api/types';
import { useI18n } from '../../i18n/i18n';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Money } from '../../ui/Money';
import { Skeleton } from '../../ui/Loaded';
import { Icon } from '../../ui/Icon';
import { errorMessage, lineDescription, planLabel } from '../shared';

interface ChangePlanDialogProps {
  subscription: SubscriptionDto;
  plans: readonly PlanDto[];
  onClose: () => void;
  onChanged: (result: PlanChangeResultDto) => void;
}

/** An upgrade the customer's credit covers completely: invoiced, but nothing reaches the card. */
const paidFromCredit = (preview: PlanChangePreviewDto) => preview.effect === 'invoice_now' && preview.amountDue === 0;

type Preview = { planId: string } & ({ state: 'loading' } | { state: 'ready'; preview: PlanChangePreviewDto } | { state: 'refused'; message: string });

/**
 * Asks the engine what a plan change would do and shows exactly that, line by
 * line, before anything changes. Confirming applies the same calculation.
 */
export function ChangePlanDialog({ subscription, plans, onClose, onChanged }: ChangePlanDialogProps) {
  const api = useApi();
  const i18n = useI18n();
  const { t, money, date } = i18n;
  const selectId = useId();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const current = plans.find((plan) => plan.id === subscription.planId);
  const choices = plans.filter(
    (plan) => plan.id !== subscription.planId && plan.interval === current?.interval && plan.prices[subscription.currency] !== undefined,
  );

  async function choose(planId: string) {
    setFailure(null);
    if (!planId) {
      setPreview(null);
      return;
    }
    setPreview({ planId, state: 'loading' });
    try {
      const result = await api.previewPlanChange(subscription.id, planId);
      setPreview((shown) => (shown?.planId === planId ? { planId, state: 'ready', preview: result } : shown));
    } catch (error) {
      setPreview((shown) => (shown?.planId === planId ? { planId, state: 'refused', message: errorMessage(i18n, error) } : shown));
    }
  }

  async function confirm() {
    if (preview?.state !== 'ready') return;
    setApplying(true);
    setFailure(null);
    try {
      onChanged(await api.changePlan(subscription.id, preview.planId));
    } catch (error) {
      setFailure(errorMessage(i18n, error));
      setApplying(false);
    }
  }

  return (
    <Dialog
      title={t('planChange.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={preview?.state !== 'ready' || applying} busy={applying} onClick={() => void confirm()}>
            {t('planChange.confirm')}
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor={selectId}>{t('planChange.to')}</label>
        <select id={selectId} value={preview?.planId ?? ''} onChange={(event) => void choose(event.target.value)}>
          <option value="">{t('planChange.choose')}</option>
          {choices.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name} · {money(plan.prices[subscription.currency] ?? 0, subscription.currency)} {t(`interval.${plan.interval}`)}
            </option>
          ))}
        </select>
        <p className="field-hint">
          {t('planChange.current', { plan: planLabel(plans, subscription.planId) })} {t('planChange.sameInterval')}
        </p>
      </div>

      {preview?.state === 'loading' && <Skeleton rows={3} />}
      {preview?.state === 'refused' && (
        <div className="notice notice-negative" role="alert">
          <Icon name="alert" />
          <span>{preview.message}</span>
        </div>
      )}
      {preview?.state === 'ready' && (
        <div className="preview">
          <h3>{t('planChange.preview')}</h3>
          <p className="preview-effect">
            <span>{paidFromCredit(preview.preview) ? t('planChange.paidFromCredit') : t(`planChange.effect.${preview.preview.effect}`)}</span>{' '}
            <span className="muted">{t('planChange.changeAt', { date: date(preview.preview.changeAt) })}</span>
          </p>
          {preview.preview.lines.length > 0 && (
            <table className="table table-compact">
              <tbody>
                {preview.preview.lines.map((line) => (
                  <tr key={line.kind}>
                    <td>
                      {lineDescription(i18n, plans, line)}
                      <span className="cell-sub">{i18n.period(line.periodStart, line.periodEnd)}</span>
                    </td>
                    <td className="cell-num">
                      <Money amount={line.amount} currency={preview.preview.currency} />
                    </td>
                  </tr>
                ))}
                <tr className="row-total">
                  <th scope="row">{t('planChange.net')}</th>
                  <td className="cell-num">
                    <Money amount={preview.preview.net} currency={preview.preview.currency} />
                  </td>
                </tr>
                {preview.preview.creditApplied > 0 && (
                  <>
                    <tr>
                      <td>{t('planChange.creditApplied')}</td>
                      <td className="cell-num">
                        <Money amount={-preview.preview.creditApplied} currency={preview.preview.currency} />
                      </td>
                    </tr>
                    <tr className="row-total">
                      <th scope="row">{t('planChange.chargedNow')}</th>
                      <td className="cell-num">
                        <Money amount={preview.preview.amountDue} currency={preview.preview.currency} />
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
      {failure && (
        <div className="notice notice-negative" role="alert">
          <Icon name="alert" />
          <span>{failure}</span>
        </div>
      )}
    </Dialog>
  );
}
