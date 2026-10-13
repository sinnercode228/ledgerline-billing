import type { ReactNode } from 'react';
import type { Resource } from '../api/api-context';
import { useI18n } from '../i18n/i18n';
import { Button } from './Button';
import { Icon } from './Icon';

export function ErrorNotice({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="notice notice-negative" role="alert">
      <Icon name="alert" />
      <span>{t('common.error', { message: error.message })}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number | undefined }) {
  const { t } = useI18n();
  return (
    <div className="skeleton" role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

/**
 * Renders a resource: a skeleton on the first load, an error with a retry,
 * then the data. Later reloads keep the data on screen, dimmed.
 */
export function Loaded<T>({ resource, rows, children }: { resource: Resource<T>; rows?: number | undefined; children: (data: T) => ReactNode }) {
  if (resource.data === undefined) {
    return resource.error ? <ErrorNotice error={resource.error} onRetry={resource.reload} /> : <Skeleton rows={rows} />;
  }
  return (
    <div className={resource.loading ? 'is-refreshing' : undefined} aria-busy={resource.loading || undefined}>
      {resource.error && <ErrorNotice error={resource.error} onRetry={resource.reload} />}
      {children(resource.data)}
    </div>
  );
}
