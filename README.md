# FDAX Pulse Frontend

Next.js App Router dashboard for local-first FDAX delayed-paper sessions,
secondary TAQ CSV replay, an explicitly toy fixture demo, and optional
Supabase Realtime viewing of compact Mac-worker output.

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
never performs broker execution or claims live data.
