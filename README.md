# Ledgerline

Subscription billing for a SaaS: plans, trials, proration, gapless invoices, a double-entry ledger and dunning.

## Dashboard

`web/` is the dashboard: customers and their subscriptions, plan changes with the engine's proration preview, printable invoices with every payment attempt, the double-entry journal with its trial balance, the webhook log, and a test clock that moves the simulated date forward.

- **Against a server.** Run the API with `LEDGERLINE_TEST_CLOCK=1` and `LEDGERLINE_CORS_ORIGINS=http://localhost:5173`, then `npm run dev:web`. The dashboard asks for the API key once and calls `VITE_API_URL` (default `http://localhost:3000`).
- **In the browser alone.** `VITE_API_MODE=mock npm run dev:web` runs the billing engine in the page on a `MemoryStore` and the fake Payrail. It builds six months of history from a fixed seed on the first visit and keeps the world in `localStorage`. The Pages workflow publishes this build; `BASE_PATH` sets the path it is served from.
