from worker.fdax_pulse.engine import import_taq_csv, simulate_replay
from worker.fdax_pulse.local_api import create_app
from worker.fdax_pulse.storage import LocalSessionStore

from pathlib import Path
import gzip
import io
import json


FIXTURE = Path(__file__).parent / "fixtures" / "fdax_strategy_fixture.csv"


def test_local_store_and_loopback_api_return_compact_session(tmp_path):
    database = tmp_path / "sessions.sqlite3"
    result = simulate_replay(import_taq_csv(FIXTURE))
    LocalSessionStore(database).save_result(result)
    client = create_app(database).test_client()

    health = client.get("/api/health").get_json()
    latest = client.get("/api/sessions/latest").get_json()

    assert health == {"scope": "local_only", "status": "ok"}
    assert latest["realized_pnl_eur"] == "25.00"
    assert "events" not in latest


def test_local_api_only_accepts_paper_session_commands(tmp_path):
    client = create_app(tmp_path / "commands.sqlite3").test_client()

    assert client.post("/api/commands", json={"kind": "approve_entry"}).status_code == 202
    assert client.post("/api/commands", json={"kind": "place_real_order"}).status_code == 400


def test_local_api_records_consent_and_qualifies_official_delayed_pair(tmp_path):
    database = tmp_path / "delayed.sqlite3"
    client = create_app(database).test_client()
    pre = gzip.compress(
        (
            json.dumps(
                {
                    "instrumentIdentificationCode": "DE0008469594",
                    "contractDate": "2026-06-19",
                    "contractType": "S",
                    "mdupdateDateAndTime": "2026-05-26T09:34:00.000000Z",
                    "mdBidMktDepthGroup1": [{"price": 25271.0}],
                    "mdAskMktDepthGroup1": [{"price": 25273.0}],
                }
            )
            + "\n"
        ).encode()
    )
    post = gzip.compress(
        (
            json.dumps(
                {
                    "instrumentIdentificationCode": "DE0008469594",
                    "contractDate": "2026-06-19",
                    "contractType": "S",
                    "price": 25273.0,
                    "quantity": 2.0,
                    "tradingDateAndTime": "2026-05-26T09:34:00.243889Z",
                }
            )
            + "\n"
        ).encode()
    )

    assert client.get("/api/sources").get_json()["delayed_paper"]["sufficiency"] == "terms_required"
    assert client.post("/api/sources/deutsche-boerse/consent", json={"accepted": True}).status_code == 200
    response = client.post(
        "/api/sources/deutsche-boerse/qualify",
        data={
            "maturityDate": "2026-06-19",
            "pretradeFile": (io.BytesIO(pre), "DEUR-pretradeOthers.json.gz"),
            "posttradeFile": (io.BytesIO(post), "DEUR-posttrade.json.gz"),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    assert response.get_json()["health"]["sufficiency"] == "verified_taq"
    assert response.get_json()["preview"]["bars"][0]["volume"] == 2


def test_local_commands_are_idempotent(tmp_path):
    client = create_app(tmp_path / "commands.sqlite3").test_client()

    first = client.post(
        "/api/commands", json={"kind": "pause", "idempotencyKey": "same-command"}
    ).get_json()
    second = client.post(
        "/api/commands", json={"kind": "pause", "idempotencyKey": "same-command"}
    ).get_json()

    assert first["id"] == second["id"]


def test_csv_recommendation_session_pauses_and_accepts_manual_paper_entry(tmp_path):
    client = create_app(tmp_path / "csv-recommendation.sqlite3").test_client()
    with FIXTURE.open("rb") as fixture:
        started = client.post(
            "/api/imports/csv",
            data={"decisionMode": "recommendation", "csvFile": (fixture, "fixture.csv")},
            content_type="multipart/form-data",
        ).get_json()

    assert started["status"] == "paused_for_action"
    assert started["fills"] == []
    advanced = client.post(
        f"/api/sessions/{started['session_id']}/commands",
        json={"kind": "approve_entry", "idempotencyKey": "approve-csv-entry"},
    ).get_json()["session"]

    assert advanced["fills"][0]["side"] == "buy"
    assert advanced["status"] == "paused_for_action"
    assert advanced["signals"][-1]["action"] == "sell"
