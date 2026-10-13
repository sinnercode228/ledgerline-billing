import { useId, type ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Tables sit edge to edge; text gets padding. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({ title, subtitle, actions, flush = false, className, children }: CardProps) {
  const headingId = useId();
  return (
    <section className={['card', className ?? ''].join(' ').trim()} aria-labelledby={title ? headingId : undefined}>
      {(title ?? actions) && (
        <header className="card-head">
          <div className="card-titles">
            {title && <h2 id={headingId}>{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'card-body card-body-flush' : 'card-body'}>{children}</div>
    </section>
  );
}

/** Wide tables scroll inside their card; the page itself never scrolls sideways. */
export function TableScroll({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
