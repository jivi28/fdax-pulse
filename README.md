# FDAX Pulse

Paper-trading project for an orderflow-imbalance futures strategy: a Python
worker runs the strategy, and a Next.js (App Router) dashboard displays it. It
follows the one-minute orderflow method from Matteo Pecchiari's *Orderflow
Imbalance and High Frequency Trading* — long-only, one paper contract, fills at
the ask and exits at the bid.

**Paper trading only. Nothing here places broker orders.**

## What's in the app

- **Live console (`/`)** — paper trading on a free public crypto-futures
  WebSocket feed, seeded with recent one-minute history.
- **FDAX lab (`/advanced`)** — delayed-paper sessions, TAQ CSV replay and an
  explicitly toy fixture demo. Delayed-paper sessions and replays are computed
  by the Python worker in [`worker/`](./worker).
- **Methodology (`/methodology`)** and **data-quality errors
  (`/errors/data-quality`)** — the executable rules and how bad data is handled.
- Optional Supabase Realtime viewing of compact worker output.

## Python worker (`worker/`)

| Module | Role |
|---|---|
| `engine.py` | TAQ CSV import and validation, signed-orderflow classification, one-minute bars, strategy and paper-fill simulation, P&L and risk limits |
| `adapters.py` | Data sources: CSV replay, bundled fixture, and a source for official 15-minute delayed Deutsche Börse (Eurex) files |
| `storage.py` | Compact local persistence in SQLite |
| `sync.py` | Optional compact sync to Supabase (never raw ticks) |
| `local_api.py` | Loopback-only Flask API the dashboard talks to |
| `cli.py` | Command-line entry point |

**Strategy** (long-only, one paper contract at a time, completed one-minute
bars from 09:00 to 17:00 Europe/Berlin):

- Trade volume is signed against the prevailing bid/ask midpoint; midpoint ties
  use the last unequal price movement.
- Entry: after a bar with orderflow > 24 and volume > 242 (default thresholds),
  buy at the first ask at the next minute boundary.
- Exit: hold while completed-bar orderflow is positive; sell at the first bid
  after the first bar with orderflow ≤ 0.
- Risk: forced flatten at the end of the session or when the daily paper-loss
  limit (default EUR 250) is hit.

Invalid, crossed, mismatched, stale-execution and out-of-session rows are
reported rather than silently used. The bundled fixture is a toy demo (it keeps
a historical `0.5` increment so its known result stays stable); its output is
not a performance claim.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# bundled fixture
python -m worker.fdax_pulse.cli --fixture --mode automatic

# local CSV with columns timestamp,trade_price,trade_size,bid,ask,contract
python -m worker.fdax_pulse.cli --csv path/to/fdax-taq.csv --mode automatic --contract FDAX

# loopback API for the dashboard
python -m worker.fdax_pulse.cli --serve-local-api --local-store

# tests
pytest worker -q
```

Official Deutsche Börse delayed-data files are not included in this repository.
One test qualifies a real sample pair and is skipped unless `FDAX_SAMPLE_DIR`
points at a folder containing it.

## Development (dashboard)

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run build
```

For cloud synchronization, copy the public variable names from `.env.example`
into `.env.local` and apply the SQL in [`supabase/migrations/`](./supabase/migrations)
in order. Worker-only values (see `worker/.env.example`) belong in your local
terminal; never expose the Supabase secret key to the web app.

The delayed-paper CTA is enabled by the local worker after the user confirms
official delayed-data terms and qualifies matching `DEUR-posttrade` and
`DEUR-pretradeOthers` `.json.gz` files for an explicit FDAX maturity. The
supplied June 2026 FDAX sample passed this structural TAQ check. The project
never performs broker execution or claims live FDAX data.
