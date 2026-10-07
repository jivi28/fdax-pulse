"""Command-line runner for local FDAX paper sessions and source qualification."""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from .adapters import CsvReplaySource, DelayedDeutscheBoerseSource, FixtureSource
from .engine import (
    DEMO_FDAX_SPEC,
    FDAX_SPEC,
    FDXM_SPEC,
    FDXS_SPEC,
    Signal,
    StrategyConfig,
    simulate_replay,
)
from .local_api import run_local_api
from .storage import DEFAULT_DATABASE, LocalSessionStore
from .sync import SupabaseSync


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "fdax_strategy_fixture.csv"


class RemoteStop(Exception):
    """End a dashboard-controlled replay without executing another action."""


def _approve_interactively(signal: Signal) -> bool:
    label = signal.action.upper()
    print(f"\n{label}: {signal.reason}")
    response = input("Execute this paper action? [y/N] ").strip().lower()
    return response in {"y", "yes"}

def _wait_for_command(sync: SupabaseSync, session_id: str, accepted: set[str], poll_seconds: float) -> str:
    while True:
        sync.heartbeat(session_id, "waiting_for_command")
        for command in sync.pending_commands(session_id):
            if not sync.claim_command(command["id"]):
                continue
            kind = command["kind"]
            if kind in accepted:
                sync.complete_command(command["id"])
                return kind
            sync.complete_command(command["id"], error=f"Command {kind} is not valid at this replay point.")
        time.sleep(poll_seconds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run local FDAX delayed/replay paper-trading sessions.")
    parser.add_argument("--csv", type=Path, help="Local TAQ CSV path. Raw ticks remain on this machine.")
    parser.add_argument("--fixture", action="store_true", help="Run the bundled deterministic demonstration fixture.")
    parser.add_argument(
        "--delayed-probe",
        action="store_true",
        help="Qualify or report official delayed Deutsche Boerse/Eurex data.",
    )
    parser.add_argument("--delayed-pretrade", type=Path, help="Official DEUR-pretradeOthers .json.gz sample.")
    parser.add_argument("--delayed-posttrade", type=Path, help="Official DEUR-posttrade .json.gz sample.")
    parser.add_argument("--maturity", help="Explicit FDAX contract maturity, for example 2026-06-19.")
    parser.add_argument(
        "--acknowledge-delayed-terms",
        action="store_true",
        help="Record that you personally accepted the official Deutsche Boerse delayed-data terms.",
    )
    parser.add_argument("--mode", choices=("automatic", "recommendation"), default="automatic")
    parser.add_argument("--exit-policy", choices=("momentum", "basic"), default="momentum")
    parser.add_argument("--contract", choices=("FDAX", "FDXM", "FDXS"), default="FDAX")
    parser.add_argument("--fill-model", choices=("demo_reference", "realistic_paper"))
    parser.add_argument("--loss-limit", type=Decimal, default=Decimal("250.00"))
    parser.add_argument("--commission-per-side", type=Decimal, default=Decimal("0.00"))
    parser.add_argument("--slippage-ticks", type=int, default=0)
    parser.add_argument("--max-quote-delay-seconds", type=int, default=60)
    parser.add_argument("--output", type=Path, help="Write compact JSON replay outcome to this local path.")
    parser.add_argument(
        "--local-store",
        nargs="?",
        const=str(DEFAULT_DATABASE),
        metavar="SQLITE_PATH",
        help="Persist compact session output in a local SQLite database.",
    )
    parser.add_argument(
        "--serve-local-api",
        action="store_true",
        help="Serve the local session/status API on 127.0.0.1 without starting a session.",
    )
    parser.add_argument("--local-api-port", type=int, default=8787)
    parser.add_argument("--sync", action="store_true", help="Upload compact results to configured Supabase project.")
    parser.add_argument(
        "--remote",
        action="store_true",
        help="Wait for authenticated dashboard start/approval commands through Supabase.",
    )
    parser.add_argument("--poll-seconds", type=float, default=1.0, help="Remote command poll interval.")
    args = parser.parse_args(argv)

    local_store = LocalSessionStore(args.local_store or DEFAULT_DATABASE) if args.local_store else None
    if args.serve_local_api:
        run_local_api(args.local_store or DEFAULT_DATABASE, args.local_api_port)
        return 0
    if args.acknowledge_delayed_terms:
        if local_store is None:
            parser.error("--acknowledge-delayed-terms requires --local-store.")
        local_store.accept_delayed_terms()
    if args.delayed_probe:
        consent = args.acknowledge_delayed_terms or bool(local_store and local_store.delayed_terms_accepted())
        source = DelayedDeutscheBoerseSource(
            maturity_date=args.maturity,
            consent_accepted=consent,
            pretrade_payload=args.delayed_pretrade,
            posttrade_payload=args.delayed_posttrade,
        )
        if args.maturity and consent:
            if bool(args.delayed_pretrade) != bool(args.delayed_posttrade):
                parser.error("Provide both --delayed-pretrade and --delayed-posttrade, or neither.")
            try:
                report = source.load(
                    StrategyConfig(
                        instrument=FDAX_SPEC,
                        fill_model="realistic_paper",
                        max_quote_delay_seconds=args.max_quote_delay_seconds,
                    )
                )
                health = source.probe()
                if local_store:
                    local_store.save_source_health(health)
                print(json.dumps({"health": health.to_dict(), "accepted_rows": report.accepted_rows}, indent=2))
                return 0
            except (OSError, RuntimeError, ValueError) as error:
                print(f"Delayed qualification failed: {error}", file=sys.stderr)
                return 2
        print(json.dumps(source.probe().to_dict(), indent=2))
        return 0

    path = FIXTURE if args.fixture else args.csv
    if path is None:
        parser.error("Choose --fixture, provide --csv PATH, or use --delayed-probe.")
    if args.remote and not args.sync:
        parser.error("--remote requires --sync.")
    if args.slippage_ticks < 0:
        parser.error("--slippage-ticks must not be negative.")
    instruments = {"FDAX": FDAX_SPEC, "FDXM": FDXM_SPEC, "FDXS": FDXS_SPEC}
    instrument = DEMO_FDAX_SPEC if args.fixture else instruments[args.contract]
    fill_model = args.fill_model or ("demo_reference" if args.fixture else "realistic_paper")
    config = StrategyConfig(
        daily_loss_limit_eur=args.loss_limit,
        commission_per_side_eur=args.commission_per_side,
        slippage_ticks=args.slippage_ticks,
        max_quote_delay_seconds=args.max_quote_delay_seconds,
        fill_model=fill_model,
        instrument=instrument,
    )
    try:
        source_adapter = FixtureSource(path) if args.fixture else CsvReplaySource(path)
        report = source_adapter.load(config)
        source = "fixture" if args.fixture else report.adapter
        sync = SupabaseSync() if args.sync else None
        session_id: str | None = None
        callback = _approve_interactively if args.mode == "recommendation" else None
        if args.remote:
            assert sync is not None
            session_id = str(uuid.uuid4())
            sync.create_session(
                session_id,
                args.mode,
                source,
                source_mode=report.source_mode,
                source_name=source_adapter.source_name,
                delay_minutes=source_adapter.delay_minutes,
                data_sufficiency=source_adapter.probe().sufficiency,
            )
            print(f"Remote replay ready: {session_id}", file=sys.stderr)
            command = _wait_for_command(sync, session_id, {"start", "stop"}, args.poll_seconds)
            if command == "stop":
                sync.update_session(session_id, status="stopped")
                return 0
            sync.update_session(session_id, status="running", started_at=datetime.now(timezone.utc).isoformat())
            recommendation_count = 0

            def remote_approval(signal: Signal) -> bool:
                nonlocal recommendation_count
                assert sync is not None and session_id is not None
                recommendation_count += 1
                sync.publish_recommendation(session_id, signal, recommendation_count)
                accepted = {"skip_signal", "stop"}
                accepted.add("approve_entry" if signal.action == "buy" else "approve_exit")
                action = _wait_for_command(sync, session_id, accepted, args.poll_seconds)
                if action == "stop":
                    sync.update_session(session_id, status="stopped")
                    raise RemoteStop
                sync.update_session(session_id, status="running")
                return action in {"approve_entry", "approve_exit"}

            callback = remote_approval if args.mode == "recommendation" else None
        try:
            result = simulate_replay(
                report,
                mode=args.mode,
                exit_policy=args.exit_policy,
                config=config,
                approve=callback,
                source=source,
                session_id=session_id,
            )
        except RemoteStop:
            print("Remote replay stopped by dashboard command.", file=sys.stderr)
            return 0
        output = result.to_json()
        if args.output:
            args.output.write_text(output + "\n", encoding="utf-8")
        print(output)
        if args.local_store:
            LocalSessionStore(args.local_store).save_result(result)
            print("Compact paper-session result persisted locally.", file=sys.stderr)
        if sync:
            try:
                sync.push_result(result, args.mode)
                print("Compact paper-session results synchronized to Supabase.", file=sys.stderr)
            except Exception as error:
                if args.remote:
                    raise
                print(f"Optional Supabase sync failed; local result is retained: {error}", file=sys.stderr)
    except (OSError, ValueError) as error:
        print(f"Replay failed: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
