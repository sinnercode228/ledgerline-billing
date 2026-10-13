/** How the dashboard reaches Ledgerline, for the parts of the screen that say so. */
export type Connection =
  | { kind: 'demo'; reset: () => void; saveFailed: () => boolean }
  | { kind: 'http'; baseUrl: string; forgetKey: () => void };
