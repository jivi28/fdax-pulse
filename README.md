# FDAX Pulse

Paper-trading console for an orderflow-imbalance futures strategy, built with
Next.js (App Router). It follows the one-minute orderflow method from Matteo
Pecchiari's *Orderflow Imbalance and High Frequency Trading* — long-only, one
paper contract, fills at the ask and exits at the bid.

**Paper trading only. The app never places broker orders.**

## What's in the app

- **Live console (`/`)** — paper trading on a free public crypto-futures
  WebSocket feed, seeded with recent one-minute history.
- **FDAX lab (`/advanced`)** — delayed-paper sessions, TAQ CSV replay and an
  explicitly toy fixture demo. Delayed-paper sessions come from a local Python
  worker (not part of this repository).
- **Methodology (`/methodology`)** and **data-quality errors
  (`/errors/data-quality`)** — the executable rules and how bad data is handled.
- Optional Supabase Realtime viewing of compact worker output.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run build
```

For cloud synchronization, copy the public variable names from `.env.example`
into `.env.local`. Never expose the local worker's Supabase secret key here.

The delayed-paper CTA is enabled by the local worker after the user confirms
official delayed-data terms and qualifies matching `DEUR-posttrade` and
`DEUR-pretradeOthers` `.json.gz` files for an explicit FDAX maturity. The
supplied June 2026 FDAX sample passed this structural TAQ check. The frontend
never performs broker execution or claims live FDAX data.
