"""Optional Supabase REST synchronization for compact replay outputs.

Raw tick data never passes through this module. The worker only uploads bars,
signals, fills, session metrics, heartbeat records, and command responses.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import requests

from .engine import ReplayResult, Signal


class SupabaseSync:
    def __init__(self, url: str | None = None, secret_key: str | None = None, owner_id: str | None = None):
        self.url = (url or os.environ.get("SUPABASE_URL", "")).rstrip("/")
        self.secret_key = secret_key or os.environ.get("SUPABASE_SECRET_KEY", "")
        self.owner_id = owner_id or os.environ.get("FDAX_OWNER_ID", "")
        if not (self.url and self.secret_key and self.owner_id):
            raise ValueError("SUPABASE_URL, SUPABASE_SECRET_KEY, and FDAX_OWNER_ID are required for sync.")

    @property
    def headers(self) -> dict[str, str]:
        return {
            "apikey": self.secret_key,
            "Authorization": f"Bearer {self.secret_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

    def _post(
        self,
        table: str,
        payload: list[dict[str, Any]] | dict[str, Any],
        *,
        conflict: str | None = None,
    ) -> None:
        headers = self.headers.copy()
        params: dict[str, str] = {}
        if conflict:
            headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
            params["on_conflict"] = conflict
        response = requests.post(
            f"{self.url}/rest/v1/{table}",
            headers=headers,
            params=params,
            json=payload,
            timeout=20,
        )
        response.raise_for_status()

    def _patch(self, table: str, filters: dict[str, str], payload: dict[str, Any], *, returning: bool = False) -> list:
        headers = self.headers.copy()
        if returning:
            headers["Prefer"] = "return=representation"
        response = requests.patch(
            f"{self.url}/rest/v1/{table}",
            headers=headers,
            params=filters,
            json=payload,
            timeout=20,
        )
        response.raise_for_status()
        return response.json() if returning else []

    def _delete(self, table: str, filters: dict[str, str]) -> None:
        response = requests.delete(
            f"{self.url}/rest/v1/{table}",
            headers=self.headers,
            params=filters,
            timeout=20,
        )
        response.raise_for_status()

    def create_session(
        self,
        session_id: str,
        mode: str,
        source: str,
        *,
        source_mode: str = "csv_replay",
        source_name: str | None = None,
        delay_minutes: int | None = None,
        data_sufficiency: str = "not_evaluated",
    ) -> None:
        self._post(
            "replay_sessions",
            {
                "id": session_id,
                "user_id": self.owner_id,
                "mode": mode,
                "data_source": source,
                "session_source_mode": source_mode,
                "source_name": source_name or source,
                "delay_minutes": delay_minutes,
                "data_sufficiency": data_sufficiency,
                "status": "created",
                "worker_id": "local-python-worker",
            },
            conflict="id",
        )
        self.heartbeat(session_id, "waiting_for_start")

    def update_session(self, session_id: str, **values: Any) -> None:
        self._patch("replay_sessions", {"id": f"eq.{session_id}"}, values)

    def publish_recommendation(self, session_id: str, signal: Signal, sequence: int) -> None:
        self._post(
            "signals",
            {
                "id": signal.id,
                "user_id": self.owner_id,
                "session_id": session_id,
                "sequence": 1000000 + sequence,
                "timestamp": signal.timestamp.isoformat(),
                "action": signal.action,
                "reason": signal.reason,
                "orderflow": signal.orderflow,
                "volume": signal.volume,
                "status": "generated",
            },
            conflict="id",
        )
        self.update_session(session_id, status="paused_for_action")

    def push_result(self, result: ReplayResult, mode: str) -> None:
        payload = result.to_dict()
        common = {"user_id": self.owner_id, "session_id": result.session_id}
        issue_counts: dict[str, int] = {}
        for issue in payload["issues"]:
            code = issue["code"]
            issue_counts[code] = issue_counts.get(code, 0) + 1
        session_values = {
            "id": result.session_id,
            "user_id": self.owner_id,
            "mode": mode,
            "data_source": result.source,
            "session_source_mode": result.source_mode,
            "source_name": result.source,
            "fill_model": result.fill_model,
            "contract_snapshot": payload["instrument"],
            "commission_per_side_eur": payload["commission_per_side_eur"],
            "slippage_ticks": result.slippage_ticks,
            "orderflow_threshold": result.orderflow_threshold,
            "volume_threshold": result.volume_threshold,
            "quality_summary": {
                "quarantined_count": len(payload["issues"]),
                "reasons": issue_counts,
            },
            "status": result.status,
            "realized_pnl_eur": payload["realized_pnl_eur"],
            "gross_pnl_eur": payload["gross_pnl_eur"],
            "win_ratio": payload["win_ratio"],
            "risk_reward": payload["risk_reward"],
            "quality_issues": payload["issues"],
        }
        if result.status in {"completed", "stopped", "failed"}:
            session_values["ended_at"] = datetime.now(timezone.utc).isoformat()
        self._post("replay_sessions", session_values, conflict="id")
        for table in (
            "minute_bars",
            "signals",
            "paper_orders",
            "paper_fills",
            "positions",
            "equity_snapshots",
            "audit_events",
        ):
            self._delete(table, {"session_id": f"eq.{result.session_id}"})
        if payload["bars"]:
            actions_by_time = {item["timestamp"]: item["action"] for item in payload["signals"]}
            self._post(
                "minute_bars",
                [
                    {
                        **common,
                        **bar,
                        "sequence": index + 1,
                        "orderflow_threshold_pass": bar["orderflow"] > result.orderflow_threshold,
                        "volume_threshold_pass": bar["volume"] > result.volume_threshold,
                        "evaluation_action": actions_by_time.get(bar["ends_at"], "no_action"),
                    }
                    for index, bar in enumerate(payload["bars"])
                ],
            )
        if payload["signals"]:
            self._post("signals", [{**common, **item, "sequence": index + 1} for index, item in enumerate(payload["signals"])])
        actionable = [item for item in payload["signals"] if item["action"] in {"buy", "sell", "risk_halt"}]
        if actionable:
            self._post(
                "paper_orders",
                [
                    {
                        **common,
                        "signal_id": item["id"],
                        "side": "buy" if item["action"] == "buy" else "sell",
                        "status": "filled" if item["status"] == "executed" else item["status"],
                        "reason": item["reason"],
                    }
                    for item in actionable
                ],
            )
        if payload["fills"]:
            self._post("paper_fills", [{**common, **item, "sequence": index + 1} for index, item in enumerate(payload["fills"])])
        if payload["trades"]:
            self._post(
                "positions",
                [
                    {
                        **common,
                        "side": "long",
                        "quantity": 1,
                        "status": "closed",
                        "entry_price": trade["entry"]["price"],
                        "exit_price": trade["exit"]["price"],
                        "realized_pnl_eur": trade["net_pnl_eur"],
                        "opened_at": trade["entry"]["timestamp"],
                        "closed_at": trade["exit"]["timestamp"],
                    }
                    for trade in payload["trades"]
                ],
            )
        running_equity = Decimal("0.00")
        snapshots: list[dict[str, Any]] = []
        for index, trade in enumerate(payload["trades"]):
            running_equity += Decimal(trade["net_pnl_eur"])
            snapshots.append(
                {
                    **common,
                    "sequence": index + 1,
                    "timestamp": trade["exit"]["timestamp"],
                    "realized_pnl_eur": str(running_equity),
                    "unrealized_pnl_eur": "0.00",
                    "equity_pnl_eur": str(running_equity),
                }
            )
        if snapshots:
            self._post("equity_snapshots", snapshots)
        if payload["signals"]:
            self._post(
                "audit_events",
                [
                    {
                        **common,
                        "sequence": index + 1,
                        "event_type": f"signal_{item['action']}_{item['status']}",
                        "payload": item,
                        "occurred_at": item["timestamp"],
                    }
                    for index, item in enumerate(payload["signals"])
                ],
            )
        self.heartbeat(result.session_id, result.status)

    def push_snapshot(self, result: ReplayResult, mode: str) -> None:
        """Publish a compact worker snapshot; raw TAQ events are never transmitted."""
        self.push_result(result, mode)

    def heartbeat(self, session_id: str | None, status: str) -> None:
        self._post(
            "worker_heartbeats",
            {
                "user_id": self.owner_id,
                "session_id": session_id,
                "worker_id": "local-python-worker",
                "status": status,
                "last_seen_at": datetime.now(timezone.utc).isoformat(),
            },
            conflict="session_id,worker_id",
        )

    def pending_commands(self, session_id: str) -> list[dict[str, Any]]:
        response = requests.get(
            f"{self.url}/rest/v1/worker_commands",
            headers=self.headers,
            params={
                "session_id": f"eq.{session_id}",
                "status": "eq.pending",
                "order": "created_at.asc",
            },
            timeout=20,
        )
        response.raise_for_status()
        return response.json()

    def claim_command(self, command_id: str) -> bool:
        claimed = self._patch(
            "worker_commands",
            {"id": f"eq.{command_id}", "status": "eq.pending"},
            {"status": "claimed", "claimed_at": datetime.now(timezone.utc).isoformat()},
            returning=True,
        )
        return bool(claimed)

    def complete_command(self, command_id: str, *, error: str | None = None) -> None:
        values: dict[str, Any] = {
            "status": "failed" if error else "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        if error:
            values["error"] = error
        self._patch("worker_commands", {"id": f"eq.{command_id}"}, values)
