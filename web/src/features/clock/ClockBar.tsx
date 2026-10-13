import { addMonthsClamped } from '@ledgerline/core';
import { useEffect, useRef, useState } from 'react';
import { useApi, useRefresh, useResource } from '../../api/api-context';
import type { ClockAdvanceDto, ClockStep } from '../../api/types';
import { useTheme } from '../../app/theme';
import { useI18n } from '../../i18n/i18n';
import { LANGUAGES } from '../../i18n/locale';
import { Icon } from '../../ui/Icon';
import { AdvanceSummary } from './AdvanceSummary';
import { TrialBalanceIndicator } from './TrialBalanceIndicator';

type StepName = 'day' | 'week' | 'month';

function stepFrom(now: string, step: StepName): ClockStep {
  switch (step) {
    case 'day':
      return { days: 1 };
    case 'week':
      return { days: 7 };
    case 'month':
      return { to: addMonthsClamped(new Date(now), 1).toISOString() };
  }
}

/** The browser's clock, read again twice a minute, for a server that bills on real time. */
function useWallClock(active: boolean): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className="topbar-segmented" role="group" aria-label={t('language.label')}>
      {LANGUAGES.map((option) => (
        <button key={option} type="button" aria-pressed={option === language} onClick={() => setLanguage(option)} lang={option}>
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="topbar-icon" onClick={() => setTheme(next)} aria-label={t(next === 'dark' ? 'theme.dark' : 'theme.light')} title={t(next === 'dark' ? 'theme.dark' : 'theme.light')}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

/**
 * The simulated date and the buttons that move it. After a move it says what
 * the engine did, and the trial balance next to it shows the books still balance.
 */
export function ClockBar() {
  const api = useApi();
  const refresh = useRefresh();
  const { t, date } = useI18n();
  const clock = useResource('clock', (client) => client.clock());
  const trialBalance = useResource('trial-balance', (client) => client.trialBalance());
  const [running, setRunning] = useState<StepName | null>(null);
  const [advance, setAdvance] = useState<ClockAdvanceDto | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const bar = useRef<HTMLElement>(null);

  // The sidebar sticks just below the bar, whose height changes with the summary line and on small screens.
  useEffect(() => {
    const element = bar.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-height', `${element.offsetHeight}px`));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const enabled = clock.data?.enabled ?? false;
  const wallClock = useWallClock(clock.data !== undefined && !enabled);
  // Without a test clock the server bills on real time, which the browser knows as well.
  const now = clock.data === undefined ? null : (clock.data.now ?? wallClock);

  async function move(step: StepName) {
    if (!now) return;
    setRunning(step);
    setFailure(null);
    try {
      setAdvance(await api.advanceClock(stepFrom(now, step)));
      refresh();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(null);
    }
  }

  return (
    <header className="topbar" ref={bar}>
      <div className="topbar-row">
        <a className="brand" href="#/">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" />
            <path d="M9 8v16h14" />
            <path className="brand-lines" d="M14 18h9M14 13h9" />
          </svg>
          <span className="brand-name">{t('app.name')}</span>
        </a>

        <div className="clock" aria-busy={running !== null || undefined}>
          <div className="clock-now">
            <span className="clock-label">
              <Icon name="clock" size={14} />
              {enabled ? t('clock.simulated') : t('clock.live')}
            </span>
            <span className="clock-date" aria-live="polite">
              {now ? (
                <>
                  <time dateTime={now}>
                    <span className="clock-weekday">{date(now, 'weekday')}, </span>
                    {date(now)}
                  </time>
                  <span className="clock-time">
                    {date(now, 'time')} {t('clock.utc')}
                  </span>
                </>
              ) : (
                '…'
              )}
            </span>
          </div>
          {enabled ? (
            <div className="clock-buttons">
              {(['day', 'week', 'month'] as const).map((step) => (
                <button key={step} type="button" className="clock-button" disabled={running !== null || !now} onClick={() => void move(step)}>
                  {running === step && <span className="spinner" aria-hidden />}
                  {t(`clock.${step}`)}
                </button>
              ))}
            </div>
          ) : (
            clock.data && <span className="clock-off">{t('clock.disabled')}</span>
          )}
        </div>

        <div className="topbar-tools">
          <TrialBalanceIndicator trialBalance={trialBalance.data} />
          <LanguageSwitch />
          <ThemeToggle />
        </div>
      </div>
      {running && (
        <div className="topbar-progress" role="status">
          {t('clock.advancing')}
        </div>
      )}
      {failure && (
        <div className="topbar-failure" role="alert">
          <Icon name="alert" size={14} /> {failure}
        </div>
      )}
      {advance && !running && <AdvanceSummary advance={advance} onDismiss={() => setAdvance(null)} />}
    </header>
  );
}
