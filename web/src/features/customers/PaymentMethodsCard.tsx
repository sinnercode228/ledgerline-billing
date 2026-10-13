import { useId, useState } from 'react';
import { useApi, useRefresh } from '../../api/api-context';
import type { CustomerDetail, PaymentMethodDto } from '../../api/types';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/messages';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { errorMessage } from '../shared';

/** Payrail's test cards and how each behaves. */
const TEST_CARDS = [
  { last4: '4242', number: '4242 4242 4242 4242', label: 'card.succeeds', tone: 'positive' },
  { last4: '0002', number: '4000 0000 0000 0002', label: 'card.declined', tone: 'negative' },
  { last4: '9995', number: '4000 0000 0000 9995', label: 'card.insufficient', tone: 'warning' },
] as const satisfies ReadonlyArray<{ last4: string; number: string; label: MessageKey; tone: string }>;

function AttachCardDialog({ customerId, expYear, onClose }: { customerId: string; expYear: number; onClose: () => void }) {
  const api = useApi();
  const refresh = useRefresh();
  const i18n = useI18n();
  const { t } = i18n;
  const name = useId();
  const [number, setNumber] = useState<string>(TEST_CARDS[1].number);
  const [makeDefault, setMakeDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function attach() {
    setBusy(true);
    setFailure(null);
    try {
      await api.attachCard(customerId, { number, expMonth: 12, expYear }, makeDefault);
      refresh();
      onClose();
    } catch (error) {
      setFailure(errorMessage(i18n, error));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('card.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={busy} onClick={() => void attach()}>
            {t('card.attach')}
          </Button>
        </>
      }
    >
      <fieldset className="choices">
        <legend className="visually-hidden">{t('card.title')}</legend>
        {TEST_CARDS.map((card) => (
          <label key={card.number} className="choice">
            <input type="radio" name={name} value={card.number} checked={number === card.number} onChange={() => setNumber(card.number)} />
            <span className="choice-body">
              <span className="mono">{card.number}</span>
              <Chip tone={card.tone}>{t(card.label)}</Chip>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="checkbox">
        <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
        {t('card.makeDefault')}
      </label>
      <p className="field-hint">{t('card.retryNote')}</p>
      {failure && (
        <div className="notice notice-negative" role="alert">
          <Icon name="alert" />
          <span>{failure}</span>
        </div>
      )}
    </Dialog>
  );
}

function CardRow({ method, customerId }: { method: PaymentMethodDto; customerId: string }) {
  const api = useApi();
  const refresh = useRefresh();
  const i18n = useI18n();
  const { t } = i18n;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const behaviour = TEST_CARDS.find((card) => card.last4 === method.last4);

  async function makeDefault() {
    setBusy(true);
    try {
      await api.setDefaultPaymentMethod(customerId, method.id);
      refresh();
    } catch (error) {
      setFailure(errorMessage(i18n, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card-row">
      <Icon name="card" />
      <div className="card-row-main">
        <span>
          <span className="card-brand">{method.brand.toUpperCase()}</span> <span className="mono">•••• {method.last4}</span>
        </span>
        <span className="cell-sub">
          {t('customer.expires', { date: `${String(method.expMonth).padStart(2, '0')}/${method.expYear}` })}
          {behaviour && ` · ${t(behaviour.label)}`}
        </span>
        {failure && <span className="text-negative">{failure}</span>}
      </div>
      {method.isDefault ? (
        <Chip tone="info">{t('customer.default')}</Chip>
      ) : (
        <Button size="sm" variant="ghost" busy={busy} onClick={() => void makeDefault()}>
          {t('customer.makeDefault')}
        </Button>
      )}
    </li>
  );
}

export function PaymentMethodsCard({ customer, now }: { customer: CustomerDetail; now: string }) {
  const { t } = useI18n();
  const [attaching, setAttaching] = useState(false);
  return (
    <Card
      title={t('customer.paymentMethods')}
      actions={
        <Button size="sm" onClick={() => setAttaching(true)}>
          {t('customer.attachCard')}
        </Button>
      }
    >
      {customer.paymentMethods.length === 0 ? (
        <p className="muted">{t('customer.noCards')}</p>
      ) : (
        <ul className="card-list">
          {customer.paymentMethods.map((method) => (
            <CardRow key={method.id} method={method} customerId={customer.id} />
          ))}
        </ul>
      )}
      {attaching && <AttachCardDialog customerId={customer.id} expYear={new Date(now).getUTCFullYear() + 4} onClose={() => setAttaching(false)} />}
    </Card>
  );
}
