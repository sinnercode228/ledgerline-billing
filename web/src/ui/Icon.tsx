const PATHS = {
  check: 'M3.5 8.5l3 3 6-7',
  alert: 'M8 2.5l6 11H2l6-11zM8 6.5v3.2M8 11.6v.1',
  clock: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3.2l2.2 1.4',
  close: 'M4 4l8 8M12 4l-8 8',
  chevronLeft: 'M10 3.5L5.5 8l4.5 4.5',
  chevronRight: 'M6 3.5L10.5 8 6 12.5',
  card: 'M2 4.5h12v7H2zM2 7h12M4.5 9.5h2.5',
  sun: 'M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
  moon: 'M12.8 10.2A5.3 5.3 0 0 1 5.8 3.2a5.3 5.3 0 1 0 7 7z',
  printer: 'M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2M4.5 9.5h7v4h-7z',
  reset: 'M3 8a5 5 0 1 0 1.5-3.6M3 2.8v2.6h2.6',
  ledger: 'M3 2.5h10v11H3zM5.5 2.5v11M7.5 5.5h3.5M7.5 8h3.5',
} as const;

export type IconName = keyof typeof PATHS;

/** Line icons on a 16px grid; they inherit the text color. */
export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
