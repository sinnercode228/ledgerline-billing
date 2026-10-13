import { INTL_LOCALE, type Language } from '../i18n/locale';

// Billing runs on UTC instants and UTC days, so the dashboard shows UTC too:
// a renewal "on the 31st" must not appear on the 30th for a visitor in the Americas.
const STYLES = {
  date: { day: 'numeric', month: 'short', year: 'numeric' },
  shortDate: { day: 'numeric', month: 'short' },
  dateTime: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  weekdayDate: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  weekday: { weekday: 'short' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateStyle = keyof typeof STYLES;

const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatDate(iso: string, style: DateStyle, language: Language): string {
  const key = `${language}:${style}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_LOCALE[language], { ...STYLES[style], timeZone: 'UTC' });
    formatters.set(key, format);
  }
  return format.format(new Date(iso));
}

/** The UTC day of an ISO instant, YYYY-MM-DD. */
export const utcDayOf = (iso: string): string => iso.slice(0, 10);
