import { assertMinorUnits, type Currency } from '@ledgerline/core';
import { INTL_LOCALE, type Language } from '../i18n/locale';

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(language: Language, currency: Currency | null): Intl.NumberFormat {
  const key = `${language}:${currency ?? ''}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.NumberFormat(INTL_LOCALE[language], {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      ...(currency ? { style: 'currency', currency, currencyDisplay: 'narrowSymbol' } : {}),
    });
    formatters.set(key, format);
  }
  return format;
}

/**
 * Minor units as an exact decimal string. Intl formats the string digit by
 * digit, so an amount never passes through a float division by 100.
 */
function toDecimal(amount: number): Intl.StringNumericLiteral {
  assertMinorUnits(amount);
  const digits = String(Math.abs(amount)).padStart(3, '0');
  return `${amount < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}` as Intl.StringNumericLiteral;
}

export function formatMoney(amount: number, currency: Currency, language: Language): string {
  return formatter(language, currency).format(toDecimal(amount));
}

/** The number alone, for columns whose header names the currency. */
export function formatMinorUnits(amount: number, language: Language): string {
  return formatter(language, null).format(toDecimal(amount));
}
