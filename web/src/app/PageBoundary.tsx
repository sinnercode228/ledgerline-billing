import { Component, type ReactNode } from 'react';
import { useI18n } from '../i18n/i18n';
import { ErrorNotice } from '../ui/Loaded';

function Fallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <>
      <h1>{t('common.failed')}</h1>
      <ErrorNotice error={error} onRetry={onRetry} />
    </>
  );
}

/** A page that fails to render shows the error in place; the clock bar and navigation keep working. */
export class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render() {
    return this.state.error ? <Fallback error={this.state.error} onRetry={() => this.setState({ error: null })} /> : this.props.children;
  }
}
