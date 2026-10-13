import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ApiProvider } from '../../src/api/api-context';
import type { LedgerlineApi } from '../../src/api/client';
import { I18nProvider } from '../../src/i18n/i18n';
import type { Language } from '../../src/i18n/locale';

/** Renders inside the providers every screen needs; methods the test does not stub throw. */
export function renderWith(ui: ReactElement, options: { api?: Partial<LedgerlineApi>; language?: Language } = {}): RenderResult {
  const api = new Proxy(options.api ?? {}, {
    get(target, method: string) {
      const stub = (target as Record<string, unknown>)[method];
      if (stub) return stub;
      return () => Promise.reject(new Error(`the test did not stub api.${method}`));
    },
  }) as LedgerlineApi;
  return render(
    <I18nProvider initial={options.language ?? 'en'}>
      <ApiProvider api={api}>{ui}</ApiProvider>
    </I18nProvider>,
  );
}
