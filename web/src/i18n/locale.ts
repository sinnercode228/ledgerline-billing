export const LANGUAGES = ['en', 'ru'] as const;
export type Language = (typeof LANGUAGES)[number];

/** The Intl locale behind each interface language. */
export const INTL_LOCALE: Record<Language, string> = { en: 'en-GB', ru: 'ru-RU' };

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
