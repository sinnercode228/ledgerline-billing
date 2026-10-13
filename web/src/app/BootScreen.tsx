import { useI18n } from '../i18n/i18n';

export function BootScreen({ day, days, failure }: { day: number; days: number; failure: string | null }) {
  const { t } = useI18n();
  return (
    <div className="boot">
      <div className="boot-panel">
        <span className="boot-brand">{t('app.name')}</span>
        {failure ? (
          <p className="notice notice-negative" role="alert">
            {t('boot.failed', { message: failure })}
          </p>
        ) : (
          <>
            <h1>{t('boot.title')}</h1>
            <progress max={days} value={day} aria-label={t('boot.title')} />
            <p className="muted num">{t('boot.progress', { day, days })}</p>
          </>
        )}
      </div>
    </div>
  );
}
