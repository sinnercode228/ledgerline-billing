/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `mock` runs the engine in the browser instead of calling a server. */
  readonly VITE_API_MODE?: string;
  /** Base URL of the Ledgerline API, such as http://localhost:3000. */
  readonly VITE_API_URL?: string;
}
