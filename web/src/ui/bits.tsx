import type { ReactNode } from 'react';
import { hrefFor, type Route } from '../app/routes';
import type { DateStyle } from '../format/dates';
import { useI18n } from '../i18n/i18n';
import { Icon } from './Icon';

export function DateText({ iso, style = 'date' }: { iso: string | null; style?: DateStyle }) {
  const { date } = useI18n();
  if (iso === null) return <span className="muted">—</span>;
  return (
    <time dateTime={iso} title={iso}>
      {date(iso, style)}
    </time>
  );
}

export function PeriodText({ start, end }: { start: string; end: string }) {
  const { period } = useI18n();
  return (
    <span className="nowrap" title={`${start} – ${end}`}>
      {period(start, end)}
    </span>
  );
}

export function RouteLink({ to, children, className }: { to: Route; children: ReactNode; className?: string }) {
  return (
    <a href={hrefFor(to)} className={className}>
      {children}
    </a>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: Route; label: string } }) {
  const { t } = useI18n();
  return (
    <header className="page-head">
      {back && (
        <RouteLink to={back.to} className="back-link">
          <Icon name="chevronLeft" size={14} />
          {t('common.backTo', { page: back.label })}
        </RouteLink>
      )}
      <div className="page-head-row">
        <div className="page-titles">
          <h1>{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

/** Previous and next for offset paging; the API does not count rows, so a short page means the last one. */
export function Pager({ offset, limit, shown, onChange }: { offset: number; limit: number; shown: number; onChange: (offset: number) => void }) {
  const { t } = useI18n();
  if (offset === 0 && shown < limit) return null;
  return (
    <nav className="pager" aria-label={t('common.page', { page: offset / limit + 1 })}>
      <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        <Icon name="chevronLeft" size={14} />
        {t('common.previous')}
      </button>
      <span className="muted">{t('common.page', { page: offset / limit + 1 })}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={shown < limit} onClick={() => onChange(offset + limit)}>
        {t('common.next')}
        <Icon name="chevronRight" size={14} />
      </button>
    </nav>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="mono">{children}</code>;
}
