"""SQLite persistence for compact local FDAX Pulse session output."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .adapters import SourceHealth
from .engine import ReplayResult


DEFAULT_DATABASE = Path.home() / "Library" / "Application Support" / "FDAX Pulse" / "fdax_pulse.sqlite3"


class LocalSessionStore:
    def __init__(self, path: str | Path = DEFAULT_DATABASE):
        self.path = Path(path).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute(
            """
            create table if not exists sessions (
              id text primary key,
              source_mode text not null,
              source_name text not null,
              status text not null,
              ended_at text,
              realized_pnl_eur text not null,
              result_json text not null,
              updated_at text not null default current_timestamp
            )
            """
        )
        self.connection.execute(
            """
            create table if not exists local_commands (
              id integer primary key autoincrement,
              session_id text,
              kind text not null,
              idempotency_key text,
              status text not null default 'pending',
              created_at text not null default current_timestamp,
              unique (idempotency_key)
            )
            """
        )
        self.connection.execute(
            """
            create table if not exists source_health (
              source_mode text primary key,
              health_json text not null,
              updated_at text not null default current_timestamp
            )
            """
        )
        self.connection.execute(
            """
            create table if not exists local_settings (
              key text primary key,
              value_json text not null,
              updated_at text not null default current_timestamp
            )
            """
        )
        command_columns = {
            row["name"] for row in self.connection.execute("pragma table_info(local_commands)").fetchall()
        }
        if "idempotency_key" not in command_columns:
            self.connection.execute("alter table local_commands add column idempotency_key text")
            self.connection.execute(
                "create unique index if not exists local_commands_idempotency_key_idx "
                "on local_commands (idempotency_key) where idempotency_key is not null"
            )
        self.connection.commit()

    def save_result(self, result: ReplayResult) -> None:
        payload = result.to_dict()
        self.connection.execute(
            """
            insert into sessions (
              id, source_mode, source_name, status, ended_at, realized_pnl_eur, result_json, updated_at
            ) values (?, ?, ?, ?, datetime('now'), ?, ?, datetime('now'))
            on conflict(id) do update set
              source_mode=excluded.source_mode,
              source_name=excluded.source_name,
              status=excluded.status,
              ended_at=excluded.ended_at,
              realized_pnl_eur=excluded.realized_pnl_eur,
              result_json=excluded.result_json,
              updated_at=excluded.updated_at
            """,
            (
                result.session_id,
                result.source_mode,
                result.source,
                result.status,
                payload["realized_pnl_eur"],
                json.dumps(payload),
            ),
        )
        self.connection.commit()

    def latest_result(self) -> dict | None:
        row = self.connection.execute(
            "select result_json from sessions order by updated_at desc, rowid desc limit 1"
        ).fetchone()
        return json.loads(row["result_json"]) if row else None

    def get_result(self, session_id: str) -> dict | None:
        row = self.connection.execute(
            "select result_json from sessions where id = ?", (session_id,)
        ).fetchone()
        return json.loads(row["result_json"]) if row else None

    def save_source_health(self, health: SourceHealth) -> None:
        self.connection.execute(
            """
            insert into source_health (source_mode, health_json, updated_at)
            values (?, ?, datetime('now'))
            on conflict(source_mode) do update set
              health_json=excluded.health_json, updated_at=excluded.updated_at
            """,
            (health.source_mode, json.dumps(health.to_dict())),
        )
        self.connection.commit()

    def source_health(self, source_mode: str) -> dict | None:
        row = self.connection.execute(
            "select health_json from source_health where source_mode = ?", (source_mode,)
        ).fetchone()
        return json.loads(row["health_json"]) if row else None

    def set_setting(self, key: str, value: object) -> None:
        self.connection.execute(
            """
            insert into local_settings (key, value_json, updated_at) values (?, ?, datetime('now'))
            on conflict(key) do update set value_json=excluded.value_json, updated_at=excluded.updated_at
            """,
            (key, json.dumps(value)),
        )
        self.connection.commit()

    def get_setting(self, key: str) -> object | None:
        row = self.connection.execute(
            "select value_json from local_settings where key = ?", (key,)
        ).fetchone()
        return json.loads(row["value_json"]) if row else None

    def accept_delayed_terms(self) -> dict:
        record = {
            "accepted": True,
            "acknowledged_at": datetime.now(timezone.utc).isoformat(),
            "statement": "User confirmed they personally accepted official delayed-data terms.",
        }
        self.set_setting("deutsche_boerse_terms_acknowledgement", record)
        return record

    def delayed_terms_accepted(self) -> bool:
        value = self.get_setting("deutsche_boerse_terms_acknowledgement")
        return isinstance(value, dict) and value.get("accepted") is True

    def enqueue_command(
        self, kind: str, session_id: str | None = None, idempotency_key: str | None = None
    ) -> int:
        if idempotency_key:
            row = self.connection.execute(
                "select id from local_commands where idempotency_key = ?", (idempotency_key,)
            ).fetchone()
            if row:
                return int(row["id"])
        cursor = self.connection.execute(
            "insert into local_commands (session_id, kind, idempotency_key) values (?, ?, ?)",
            (session_id, kind, idempotency_key),
        )
        self.connection.commit()
        return int(cursor.lastrowid)
