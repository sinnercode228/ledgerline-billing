import { describe, expect, it } from 'vitest';
import { createI18n, detectLanguage } from '../src/i18n/i18n';
import { en, ru, type Plural } from '../src/i18n/messages';

describe('i18n', () => {
  it('takes ?lang= first, then the saved choice, then the browser language', () => {
    expect(detectLanguage('?lang=ru', 'en', ['en-GB'])).toBe('ru');
    expect(detectLanguage('?lang=de', 'ru', ['en-GB'])).toBe('ru');
    expect(detectLanguage('', null, ['ru-RU', 'en'])).toBe('ru');
    expect(detectLanguage('', null, ['de-DE', 'en'])).toBe('en');
  });

  it('has every Russian plural form for every counted phrase', () => {
    const plurals = Object.entries(en).filter(([, message]) => typeof message === 'object').map(([key]) => key as keyof typeof en);
    expect(plurals.length).toBeGreaterThan(0);
    for (const key of plurals) expect(Object.keys(ru[key] as Plural).sort(), key).toEqual(['few', 'many', 'one', 'other']);
  });

  it('picks the plural form the language needs', () => {
    const russian = createI18n('ru');
    expect(russian.plural('count.renewals', 1)).toBe('1 продление');
    expect(russian.plural('count.renewals', 3)).toBe('3 продления');
    expect(russian.plural('count.renewals', 5)).toBe('5 продлений');
    expect(russian.plural('count.renewals', 21)).toBe('21 продление');
    expect(createI18n('en').plural('count.renewals', 1)).toBe('1 renewal');
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    const english = createI18n('en');
    expect(english.t('boot.progress', { day: 12, days: 182 })).toBe('Day 12 of 182');
    expect(english.t('boot.progress', { day: 12 })).toBe('Day 12 of {days}');
  });
});
