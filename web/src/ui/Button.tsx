import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  busy?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', busy = false, className, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', className ?? ''].join(' ').trim()}
      disabled={disabled ?? busy}
      aria-busy={busy || undefined}
    >
      {busy && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}
