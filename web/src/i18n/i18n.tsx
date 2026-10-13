import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Currency } from '@ledgerline/core';
import { formatDate, formatPeriod, type DateStyle } from '../format/dates';
import { formatMinorUnits, formatMoney } from '../format/money';
import { INTL_LOCALE, isLanguage, type Language } from './locale';
import { en, ru, type MessageKey, type Messages, type Plural } from './messages';

const MESSAGES: Record<Language, Messages> = { en, ru };
const STORAGE_KEY = 'ledgerline.language';

type PluralKey = { [K in MessageKey]: (typeof en)[K] extends Plural ? K : never }[MessageKey];
type TextKey = Exclude<MessageKey, PluralKey>;
type Params = Record<string, string | number>;

function interpolate(text: string, params: Params = {}): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** `?lang=` wins, then the visitor's earlier choice, then the browser's language. */
export function detectLanguage(search: string, saved: string | null, preferred: readonly string[]): Language {
  const fromUrl = new URLSearchParams(search).get('lang');
  if (isLanguage(fromUrl)) return fromUrl;
  if (isLanguage(saved)) return saved;
  return preferred.some((tag) => tag.toLowerCase().startsWith('ru')) ? 'ru' : 'en';
}

export interface I18n {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TextKey, params?: Params) => string;
  plural: (key: PluralKey, count: number) => string;
  money: (amount: number, currency: Currency) => string;
  /** Minor units without a currency symbol, for columns that name the currency. */
  amount: (amount: number) => string;
  date: (iso: string, style?: DateStyle) => string;
  period: (startIso: string, endIso: string) => string;
}

export function createI18n(language: Language, setLanguage: (language: Language) => void = () => undefined): I18n {
  const messages = MESSAGES[language];
  const rules = new Intl.PluralRules(INTL_LOCALE[language]);
  return {
    language,
    setLanguage,
    t: (key, params) => interpolate(messages[key], params),
    plural: (key, count) => {
      const forms = messages[key];
      return interpolate(forms[rules.select(count)] ?? forms.other, { n: count });
    },
    money: (amount, currency) => formatMoney(amount, currency, language),
    amount: (amount) => formatMinorUnits(amount, language),
    date: (iso, style = 'date') => formatDate(iso, style, language),
    period: (startIso, endIso) => formatPeriod(startIso, endIso, language),
  };
}

const I18nContext = createContext<I18n | null>(null);

function readSavedLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Language }) {
  const [language, setLanguageState] = useState<Language>(
    () => initial ?? detectLanguage(window.location.search, readSavedLanguage(), navigator.languages),
  );

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still holds for this visit through the URL.
    }
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const i18n = useMemo(() => createI18n(language, setLanguage), [language, setLanguage]);

  return <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error('useI18n needs an I18nProvider');
  return i18n;
}
