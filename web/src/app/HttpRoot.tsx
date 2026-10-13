import { useId, useMemo, useState, type FormEvent } from 'react';
import { ApiProvider } from '../api/api-context';
import { ApiError } from '../api/client';
import { HttpApi } from '../api/http-client';
import { useI18n } from '../i18n/i18n';
import { Button } from '../ui/Button';
import { App } from './App';

const KEY_STORAGE = 'ledgerline.api-key';

function readKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

function writeKey(key: string | null): void {
  try {
    if (key === null) localStorage.removeItem(KEY_STORAGE);
    else localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // Without storage the key is asked for on every visit.
  }
}

function ApiKeyScreen({ baseUrl, refused, onConnect }: { baseUrl: string; refused: boolean; onConnect: (key: string) => void }) {
  const { t } = useI18n();
  const inputId = useId();
  const [key, setKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(refused ? t('auth.refused') : null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setChecking(true);
    setProblem(null);
    try {
      await new HttpApi({ baseUrl, apiKey: key.trim() }).plans();
      onConnect(key.trim());
    } catch (error) {
      setProblem(error instanceof ApiError && error.status === 401 ? t('auth.refused') : t('auth.unreachable', { message: error instanceof Error ? error.message : String(error) }));
      setChecking(false);
    }
  }

  return (
    <div className="boot">
      <form className="boot-panel" onSubmit={(event) => void submit(event)}>
        <span className="boot-brand">{t('app.name')}</span>
        <h1>{t('auth.title')}</h1>
        <p className="muted">
          {t('auth.server')}: <span className="mono">{baseUrl}</span>
        </p>
        <div className="field">
          <label htmlFor={inputId}>{t('auth.key')}</label>
          <input id={inputId} type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} required />
          <p className="field-hint">{t('auth.hint')}</p>
        </div>
        {problem && (
          <p className="notice notice-negative" role="alert">
            {problem}
          </p>
        )}
        <Button type="submit" variant="primary" busy={checking} disabled={key.trim() === '' || checking}>
          {t('auth.connect')}
        </Button>
      </form>
    </div>
  );
}

/** The dashboard against a real Ledgerline server; the API key is asked for once and kept in this browser. */
export function HttpRoot({ baseUrl }: { baseUrl: string }) {
  const [key, setKey] = useState<string | null>(readKey);
  const [refused, setRefused] = useState(false);

  const api = useMemo(
    () =>
      key === null
        ? null
        : new HttpApi({
            baseUrl,
            apiKey: key,
            onUnauthorized: () => {
              writeKey(null);
              setKey(null);
              setRefused(true);
            },
          }),
    [baseUrl, key],
  );

  if (!api) {
    return (
      <ApiKeyScreen
        baseUrl={baseUrl}
        refused={refused}
        onConnect={(accepted) => {
          writeKey(accepted);
          setRefused(false);
          setKey(accepted);
        }}
      />
    );
  }
  return (
    <ApiProvider api={api}>
      <App
        connection={{
          kind: 'http',
          baseUrl,
          forgetKey: () => {
            writeKey(null);
            setKey(null);
          },
        }}
      />
    </ApiProvider>
  );
}
