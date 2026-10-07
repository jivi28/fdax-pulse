from pathlib import Path

from worker.fdax_pulse.engine import StrategyConfig, import_taq_csv, simulate_replay
from worker.fdax_pulse.sync import SupabaseSync


FIXTURE = Path(__file__).parent / "fixtures" / "fdax_strategy_fixture.csv"


class Response:
    def __init__(self, payload=None):
        self.payload = payload if payload is not None else []

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


def test_compact_sync_never_posts_raw_ticks_and_populates_journal(monkeypatch):
    calls = []

    def post(url, **kwargs):
        calls.append(("post", url.rsplit("/", 1)[-1], kwargs["json"]))
        return Response()

    def delete(url, **kwargs):
        calls.append(("delete", url.rsplit("/", 1)[-1], kwargs["params"]))
        return Response()

    monkeypatch.setattr("worker.fdax_pulse.sync.requests.post", post)
    monkeypatch.setattr("worker.fdax_pulse.sync.requests.delete", delete)
    result = simulate_replay(
        import_taq_csv(FIXTURE),
        config=StrategyConfig(orderflow_threshold=20, volume_threshold=200),
    )

    SupabaseSync("https://example.supabase.co", "secret", "owner").push_result(result, "automatic")

    posted_tables = {table for method, table, _payload in calls if method == "post"}
    assert {"replay_sessions", "minute_bars", "signals", "paper_orders", "paper_fills", "positions", "equity_snapshots", "audit_events"} <= posted_tables
    assert "taq_events" not in posted_tables
    sessions_payload = next(payload for method, table, payload in calls if method == "post" and table == "replay_sessions")
    bars_payload = next(payload for method, table, payload in calls if method == "post" and table == "minute_bars")
    assert sessions_payload["fill_model"] == "realistic_paper"
    assert sessions_payload["orderflow_threshold"] == 20
    assert sessions_payload["volume_threshold"] == 200
    assert "contract_snapshot" in sessions_payload
    assert bars_payload[0]["orderflow_threshold_pass"] is True
    assert bars_payload[0]["volume_threshold_pass"] is True


def test_command_claim_is_idempotent(monkeypatch):
    returned = [[{"id": "first"}], []]

    def patch(_url, **_kwargs):
        return Response(returned.pop(0))

    monkeypatch.setattr("worker.fdax_pulse.sync.requests.patch", patch)
    sync = SupabaseSync("https://example.supabase.co", "secret", "owner")

    assert sync.claim_command("command-id") is True
    assert sync.claim_command("command-id") is False
