"""Loopback-only API and delayed-paper runner for the local dashboard."""

from __future__ import annotations

import tempfile
import threading
import uuid
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from flask import Flask, jsonify, request

from .adapters import (
    DelayedDeutscheBoerseSource,
    FixtureSource,
    SourceHealth,
)
from .engine import DEMO_FDAX_SPEC, FDAX_SPEC, ImportReport, StrategyConfig, import_taq_csv, simulate_replay
from .storage import DEFAULT_DATABASE, LocalSessionStore
from .sync import SupabaseSync


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "fdax_strategy_fixture.csv"


ALLOWED_COMMANDS = {
    "start",
    "pause",
    "resume",
    "set_speed",
    "approve_entry",
    "approve_exit",
    "skip_signal",
    "stop",
}


def _config(payload: dict, *, fixture: bool = False) -> StrategyConfig:
    return StrategyConfig(
        instrument=DEMO_FDAX_SPEC if fixture else FDAX_SPEC,
        fill_model="demo_reference" if fixture else "realistic_paper",
        commission_per_side_eur=Decimal(str(payload.get("commissionPerSideEur", 0))),
        slippage_ticks=int(payload.get("slippageTicks", 0)),
        daily_loss_limit_eur=Decimal(str(payload.get("dailyLossLimitEur", 250))),
    )


def _sync_snapshot(result, health: SourceHealth | None = None) -> None:
    try:
        sync = SupabaseSync()
        sync.push_snapshot(result, result.mode)
        if health:
            sync.update_session(
                result.session_id,
                data_sufficiency=health.sufficiency,
                delay_minutes=health.delay_minutes,
                latest_exchange_timestamp=health.latest_exchange_timestamp,
                latest_received_timestamp=health.latest_received_timestamp,
                source_health=health.to_dict(),
            )
    except (OSError, RuntimeError, ValueError):
        # Optional remote viewing can never interrupt the local paper engine.
        return


class RecommendationReplayRuntime:
    """Recompute a finite imported replay as manual paper decisions resolve."""

    def __init__(self, database: str | Path, report: ImportReport, config: StrategyConfig, source: str):
        self.database = database
        self.report = report
        self.config = config
        self.source_name = source
        self.session_id = str(uuid.uuid4())
        self._decisions: dict[tuple[str, str], bool] = {}

    def _approval(self, signal) -> bool | None:
        return self._decisions.get((signal.timestamp.isoformat(), signal.action))

    def _snapshot(self, status: str = "completed") -> dict:
        result = simulate_replay(
            self.report,
            mode="recommendation",
            config=self.config,
            approve=self._approval,
            source=self.source_name,
            session_id=self.session_id,
            result_status=status,  # type: ignore[arg-type]
        )
        LocalSessionStore(self.database).save_result(result)
        _sync_snapshot(result)
        return result.to_dict()

    def start(self) -> dict:
        return self._snapshot()

    def resolve_pending(self, kind: str) -> dict | None:
        latest = LocalSessionStore(self.database).get_result(self.session_id)
        if not latest or latest.get("status") != "paused_for_action" or not latest.get("signals"):
            return latest
        pending = latest["signals"][-1]
        accepted = kind in {"approve_entry", "approve_exit"}
        expected = "approve_entry" if pending["action"] == "buy" else "approve_exit"
        if accepted and kind != expected:
            raise ValueError(f"Pending {pending['action']} recommendation requires {expected}.")
        self._decisions[(pending["timestamp"], pending["action"])] = accepted
        return self._snapshot()

    def stop(self) -> dict | None:
        latest = LocalSessionStore(self.database).get_result(self.session_id)
        if not latest:
            return None
        if latest.get("status") == "paused_for_action" and latest.get("signals"):
            pending = latest["signals"][-1]
            self._decisions[(pending["timestamp"], pending["action"])] = pending["action"] != "buy"
        return self._snapshot(status="stopped")


class DelayedPaperRuntime:
    """Poll completed official delayed minutes and publish compact local snapshots."""

    def __init__(
        self,
        database: str | Path,
        maturity_date: str,
        config: StrategyConfig,
        mode: str,
        poll_seconds: float = 10.0,
    ):
        self.database = database
        self.session_id = str(uuid.uuid4())
        self.config = config
        self.mode = mode
        self.poll_seconds = poll_seconds
        self.source = DelayedDeutscheBoerseSource(
            maturity_date=maturity_date,
            consent_accepted=True,
            allow_empty_minutes=True,
        )
        self.report = ImportReport(adapter="delayed_deutsche_boerse", source_mode="delayed_paper")
        self._seen: set[tuple] = set()
        self._last_file_minute = None
        self._decisions: dict[tuple[str, str], bool] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @staticmethod
    def _signal_key(signal) -> tuple[str, str]:
        return signal.timestamp.isoformat(), signal.action

    def _approval(self, signal) -> bool | None:
        return self._decisions.get(self._signal_key(signal))

    def _snapshot(self, *, force_flatten: bool = False, status: str = "running") -> dict:
        result = simulate_replay(
            self.report,
            mode=self.mode,  # type: ignore[arg-type]
            config=self.config,
            approve=self._approval if self.mode == "recommendation" else None,
            source="delayed_deutsche_boerse",
            session_id=self.session_id,
            force_flatten_at_end=force_flatten,
            result_status=status,  # type: ignore[arg-type]
        )
        LocalSessionStore(self.database).save_result(result)
        _sync_snapshot(result, self.source.probe())
        return result.to_dict()

    def _append_new_minute(self) -> bool:
        store = LocalSessionStore(self.database)
        fetched = self.source.load(self.config)
        health = self.source.probe()
        file_minute = self.source.latest_file_minute
        if (
            file_minute is not None
            and self._last_file_minute is not None
            and file_minute > self._last_file_minute + timedelta(minutes=1)
        ):
            paused = replace(
                health,
                sufficiency="paused_quality_error",
                message="Accurate session paused: one or more official delayed minute files were missed.",
            )
            store.save_source_health(paused)
            self._stop.set()
            return False
        if file_minute is not None and (
            self._last_file_minute is None or file_minute > self._last_file_minute
        ):
            self._last_file_minute = file_minute
        store.save_source_health(health)
        if health.sufficiency != "verified_taq":
            return False
        added = False
        for event in fetched.events:
            key = (event.timestamp, event.trade_price, event.trade_size, event.bid, event.ask)
            if key not in self._seen:
                self._seen.add(key)
                self.report.events.append(event)
                added = True
        if added:
            self.report.events.sort(key=lambda item: (item.timestamp, item.source_row))
            self.report.input_rows += fetched.input_rows
            self.report.rejected_rows += fetched.rejected_rows
            self.report.out_of_session_rows += fetched.out_of_session_rows
            self.report.issues.extend(fetched.issues)
            self._snapshot()
        return added

    def start(self) -> dict | None:
        self._append_new_minute()
        store = LocalSessionStore(self.database)
        payload = store.get_result(self.session_id)
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return payload

    def _run(self) -> None:
        while not self._stop.wait(self.poll_seconds):
            try:
                self._append_new_minute()
            except Exception as error:
                LocalSessionStore(self.database).save_source_health(
                    SourceHealth(
                        self.source.source_name,
                        self.source.source_mode,
                        self.source.delay_minutes,
                        "fetch_error",
                        f"Official delayed fetch failed: {error}",
                        self.source.contract,
                    )
                )

    def stop(self) -> dict | None:
        self._stop.set()
        if not self.report.events:
            return None
        latest = LocalSessionStore(self.database).get_result(self.session_id) or {}
        signals = latest.get("signals", [])
        if latest.get("status") == "paused_for_action" and signals:
            pending = signals[-1]
            key = (pending["timestamp"], pending["action"])
            self._decisions[key] = pending["action"] != "buy"
        return self._snapshot(force_flatten=True, status="stopped")

    def resolve_pending(self, kind: str) -> dict | None:
        latest = LocalSessionStore(self.database).get_result(self.session_id)
        if not latest or latest.get("status") != "paused_for_action" or not latest.get("signals"):
            return latest
        pending = latest["signals"][-1]
        accepted = kind in {"approve_entry", "approve_exit"}
        expected = "approve_entry" if pending["action"] == "buy" else "approve_exit"
        if accepted and kind != expected:
            raise ValueError(f"Pending {pending['action']} recommendation requires {expected}.")
        self._decisions[(pending["timestamp"], pending["action"])] = accepted
        return self._snapshot()


def create_app(database: str | Path = DEFAULT_DATABASE) -> Flask:
    app = Flask(__name__)
    store = LocalSessionStore(database)
    active_runtimes: dict[str, DelayedPaperRuntime | RecommendationReplayRuntime] = {}

    @app.after_request
    def local_dashboard_cors(response):
        origin = request.headers.get("Origin")
        if origin in {"http://localhost:3000", "http://127.0.0.1:3000"}:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        return response

    @app.route("/api/<path:_path>", methods=["OPTIONS"])
    def preflight(_path: str):
        return "", 204

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "scope": "local_only"})

    @app.get("/api/sources")
    def sources():
        delayed = store.source_health("delayed_paper")
        if delayed is None:
            delayed = DelayedDeutscheBoerseSource(
                consent_accepted=store.delayed_terms_accepted()
            ).probe().to_dict()
        return jsonify(
            {
                "delayed_paper": delayed,
                "fixture_demo": FixtureSource(FIXTURE).probe().to_dict(),
                "terms_acknowledged": store.delayed_terms_accepted(),
            }
        )

    @app.post("/api/sources/deutsche-boerse/consent")
    def consent():
        payload = request.get_json(silent=True) or {}
        if payload.get("accepted") is not True:
            return jsonify({"error": "terms_acknowledgement_required"}), 400
        return jsonify(store.accept_delayed_terms())

    @app.post("/api/sources/deutsche-boerse/qualify")
    def qualify():
        if not store.delayed_terms_accepted():
            return jsonify({"error": "terms_acknowledgement_required"}), 403
        maturity = request.form.get("maturityDate") or (request.get_json(silent=True) or {}).get("maturityDate")
        if not maturity:
            return jsonify({"error": "maturity_date_required"}), 400
        pre_file = request.files.get("pretradeFile")
        post_file = request.files.get("posttradeFile")
        source = DelayedDeutscheBoerseSource(
            maturity_date=maturity,
            consent_accepted=True,
            pretrade_payload=pre_file.read() if pre_file else None,
            posttrade_payload=post_file.read() if post_file else None,
        )
        try:
            report = source.load(_config({}))
            health = source.probe()
            store.save_source_health(health)
            preview = simulate_replay(
                report,
                config=_config({}),
                source="delayed_deutsche_boerse_qualification_preview",
            ).to_dict()
            return jsonify({"health": health.to_dict(), "preview": preview})
        except (OSError, RuntimeError, ValueError) as error:
            health = source.probe()
            store.save_source_health(
                health if health.sufficiency != "checking" else replace(health, sufficiency="insufficient_taq", message=str(error))
            )
            return jsonify({"error": str(error), "health": store.source_health("delayed_paper")}), 422

    @app.post("/api/imports/csv")
    def csv_import():
        file = request.files.get("csvFile")
        if file is None:
            return jsonify({"error": "csv_file_required"}), 400
        payload = dict(request.form)
        config = _config(payload)
        mode = payload.get("decisionMode", "automatic")
        try:
            with tempfile.NamedTemporaryFile(suffix=".csv") as handle:
                handle.write(file.read())
                handle.flush()
                report = import_taq_csv(
                    handle.name,
                    config=config,
                    expected_contract=FDAX_SPEC.symbol,
                    require_contract=True,
                    source_mode="csv_replay",
                )
            if mode == "recommendation":
                runtime = RecommendationReplayRuntime(database, report, config, "csv_replay")
                active_runtimes[runtime.session_id] = runtime
                return jsonify(runtime.start()), 201
            result = simulate_replay(report, mode=mode, config=config, source="csv_replay")
            store.save_result(result)
            _sync_snapshot(result)
            return jsonify(result.to_dict()), 201
        except (OSError, ValueError) as error:
            return jsonify({"error": str(error)}), 422

    @app.post("/api/sessions")
    def create_session():
        payload = request.get_json(silent=True) or {}
        source_mode = payload.get("sourceMode")
        if source_mode == "fixture_demo":
            config = _config(payload, fixture=True)
            result = simulate_replay(
                FixtureSource(FIXTURE).load(config),
                mode=payload.get("decisionMode", "automatic"),
                config=config,
                source="fixture",
            )
            store.save_result(result)
            _sync_snapshot(result)
            return jsonify(result.to_dict()), 201
        if source_mode != "delayed_paper":
            return jsonify({"error": "use_csv_import_endpoint"}), 400
        if not store.delayed_terms_accepted():
            return jsonify({"error": "terms_acknowledgement_required"}), 403
        maturity = payload.get("maturityDate")
        if not maturity:
            return jsonify({"error": "maturity_date_required"}), 400
        health = store.source_health("delayed_paper")
        selected = (health or {}).get("selected_contract") or {}
        if not health or health.get("sufficiency") != "verified_taq" or selected.get("maturity_date") != maturity:
            return jsonify({"error": "qualify_selected_maturity_first"}), 409
        runtime = DelayedPaperRuntime(
            database,
            maturity,
            _config(payload),
            payload.get("decisionMode", "automatic"),
        )
        try:
            snapshot = runtime.start()
        except (OSError, RuntimeError, ValueError) as error:
            return jsonify({"error": str(error)}), 422
        active_runtimes[runtime.session_id] = runtime
        return jsonify(
            snapshot
            or {
                "session_id": runtime.session_id,
                "status": "running",
                "source_mode": "delayed_paper",
                "source": "delayed_deutsche_boerse",
                "bars": [],
                "signals": [],
                "fills": [],
                "realized_pnl_eur": "0.00",
                "gross_pnl_eur": "0.00",
                "issues": [],
            }
        ), 201

    @app.get("/api/sessions/latest")
    def latest():
        payload = store.latest_result()
        return jsonify(payload or {"status": "waiting", "message": "No local session yet."})

    @app.get("/api/sessions/<session_id>")
    def session(session_id: str):
        payload = store.get_result(session_id)
        if payload is None:
            return jsonify({"error": "session_not_found"}), 404
        return jsonify(payload)

    @app.post("/api/sessions/<session_id>/commands")
    @app.post("/api/commands")
    def command(session_id: str | None = None):
        payload = request.get_json(silent=True) or {}
        kind = str(payload.get("kind", ""))
        session_id = session_id or payload.get("session_id")
        if kind not in ALLOWED_COMMANDS:
            return jsonify({"error": "unsupported_command"}), 400
        command_id = store.enqueue_command(kind, session_id, payload.get("idempotencyKey"))
        if kind == "stop" and session_id in active_runtimes:
            snapshot = active_runtimes.pop(session_id).stop()
            return jsonify({"id": command_id, "status": "completed", "session": snapshot}), 200
        if kind in {"approve_entry", "approve_exit", "skip_signal"} and session_id in active_runtimes:
            try:
                snapshot = active_runtimes[session_id].resolve_pending(kind)
            except ValueError as error:
                return jsonify({"error": str(error)}), 409
            return jsonify({"id": command_id, "status": "completed", "session": snapshot}), 200
        return jsonify({"id": command_id, "status": "pending"}), 202

    return app


def run_local_api(database: str | Path = DEFAULT_DATABASE, port: int = 8787) -> None:
    create_app(database).run(host="127.0.0.1", port=port, debug=False, use_reloader=False)
