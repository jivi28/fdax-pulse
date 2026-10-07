from datetime import datetime
from decimal import Decimal
import gzip
import json
import os
from pathlib import Path

import pytest

from worker.fdax_pulse.engine import (
    BERLIN,
    DEMO_FDAX_SPEC,
    FDAX_SPEC,
    ImportReport,
    StrategyConfig,
    TAQEvent,
    aggregate_minute_bars,
    import_taq_csv,
    simulate_replay,
)
from worker.fdax_pulse.adapters import (
    CsvReplaySource,
    DelayedDeutscheBoerseSource,
    DisabledDatabentoLiveSource,
    FixtureSource,
)


FIXTURE = Path(__file__).parent / "fixtures" / "fdax_strategy_fixture.csv"

# Official Deutsche Boerse delayed-data files are not redistributed. To run the
# sample qualification test, point FDAX_SAMPLE_DIR at a folder holding them.
SAMPLE_DIR = Path(os.environ.get("FDAX_SAMPLE_DIR", "samples"))
POSTTRADE_SAMPLE = SAMPLE_DIR / "DEUR-posttrade-2026-05-26T09_34.json.gz"
PRETRADE_SAMPLE = SAMPLE_DIR / "DEUR-pretradeOthers-2026-05-26T09_34.json.gz"


def event(timestamp, price, size, bid, ask, row=1):
    return TAQEvent(
        timestamp=datetime.fromisoformat(timestamp).astimezone(),
        trade_price=Decimal(price),
        trade_size=size,
        bid=Decimal(bid),
        ask=Decimal(ask),
        contract="FDAX",
        source_row=row,
    )


def test_fixture_runs_multiple_entries_and_momentum_exits_using_bid_ask_fills():
    config = StrategyConfig(instrument=DEMO_FDAX_SPEC, fill_model="demo_reference")
    report = FixtureSource(FIXTURE).load(config)
    result = simulate_replay(report, config=config)

    assert result.bars[0].orderflow == 243
    assert result.bars[0].volume == 243
    assert [fill.side for fill in result.fills] == [
        "buy",
        "sell",
        "buy",
        "sell",
        "buy",
        "sell",
    ]
    assert result.fills[0].price == Decimal("18000.5")
    assert result.fills[1].price == Decimal("18001.0")
    assert [trade.net_pnl_eur for trade in result.trades] == [
        Decimal("12.50"),
        Decimal("-25.00"),
        Decimal("37.50"),
    ]
    assert result.realized_pnl_eur == Decimal("25.00")
    assert result.gross_pnl_eur == Decimal("25.00")
    assert result.source_mode == "fixture_demo"
    assert result.instrument.source == "demo_fixture"
    assert [signal.action for signal in result.signals] == [
        "buy",
        "hold",
        "sell",
        "buy",
        "sell",
        "buy",
        "hold",
        "sell",
    ]


@pytest.mark.parametrize(("orderflow_size", "volume_size"), [(24, 300), (25, 242)])
def test_thresholds_are_strict(tmp_path, orderflow_size, volume_size):
    path = tmp_path / "strict.csv"
    negative = volume_size - orderflow_size
    buy_size = (volume_size + orderflow_size) // 2
    sell_size = volume_size - buy_size
    path.write_text(
        "timestamp,trade_price,trade_size,bid,ask,contract\n"
        f"2026-05-22T09:00:05+02:00,101,{buy_size},100,101,FDAX\n"
        f"2026-05-22T09:00:35+02:00,100,{sell_size},100,101,FDAX\n"
        "2026-05-22T09:01:00+02:00,101,1,100,101,FDAX\n",
        encoding="utf-8",
    )
    result = simulate_replay(import_taq_csv(path))

    assert result.fills == []


def test_midpoint_uses_tick_fallback_and_initial_tie_is_unclassified(tmp_path):
    path = tmp_path / "midpoint.csv"
    path.write_text(
        "timestamp,trade_price,trade_size,bid,ask,contract\n"
        "2026-05-22T09:00:01+02:00,100.5,3,100,101,FDAX\n"
        "2026-05-22T09:00:02+02:00,101,4,100,101,FDAX\n"
        "2026-05-22T09:00:03+02:00,100.5,5,100,101,FDAX\n",
        encoding="utf-8",
    )

    issues = []
    bar = aggregate_minute_bars(import_taq_csv(path).events, quality_issues=issues)[0]

    assert bar.unclassified_volume == 3
    assert bar.orderflow == -1
    assert bar.classified_volume == 9
    assert bar.buy_volume == 4
    assert bar.sell_volume == 5
    assert issues[0].code == "unclassified_midpoint_tie"


def test_invalid_and_out_of_session_rows_are_quarantined(tmp_path):
    path = tmp_path / "quality.csv"
    path.write_text(
        "timestamp,trade_price,trade_size,bid,ask,contract\n"
        "2026-05-22T08:59:59+02:00,100,1,99.5,100,FDAX\n"
        "2026-05-22T09:00:00+02:00,100,-1,99.5,100,FDAX\n"
        "2026-05-22T09:00:01+02:00,100,1,101,100,FDAX\n"
        "2026-05-22T09:00:02+02:00,100,1,99.5,100,FDAX\n",
        encoding="utf-8",
    )

    report = import_taq_csv(path)

    assert report.accepted_rows == 1
    assert report.out_of_session_rows == 1
    assert report.rejected_rows == 2


def test_recommendation_mode_can_skip_entry():
    report = import_taq_csv(FIXTURE)
    result = simulate_replay(report, mode="recommendation", approve=lambda _signal: False)

    assert result.fills == []
    assert result.signals[0].action == "buy"
    assert result.signals[0].status == "skipped"


def test_recommendation_mode_without_decision_pauses_without_paper_fill():
    result = simulate_replay(import_taq_csv(FIXTURE), mode="recommendation")

    assert result.status == "paused_for_action"
    assert result.fills == []
    assert result.signals[0].action == "buy"
    assert result.signals[0].status == "generated"


def test_forced_replay_end_flatten_cannot_be_skipped_in_recommendation_mode():
    result = simulate_replay(
        import_taq_csv(FIXTURE),
        mode="recommendation",
        approve=lambda signal: signal.action == "buy",
    )

    assert [fill.side for fill in result.fills] == ["buy", "sell"]
    assert result.signals[-1].reason == "Forced flatten at replay/session end."
    assert result.signals[-1].status == "executed"


def test_basic_exit_closes_after_first_holding_minute():
    result = simulate_replay(import_taq_csv(FIXTURE), exit_policy="basic")

    assert [signal.action for signal in result.signals] == [
        "buy",
        "sell",
        "buy",
        "sell",
        "buy",
        "sell",
    ]
    assert len(result.trades) == 3
    assert result.fills[1].timestamp.isoformat().startswith("2026-05-22T07:02:00")
    assert result.realized_pnl_eur == Decimal("-25.00")
    assert result.gross_pnl_eur == Decimal("0.00")
    assert result.risk_reward.quantize(Decimal("0.01")) == Decimal("0.67")


def test_daily_loss_limit_halts_position(tmp_path):
    path = tmp_path / "risk.csv"
    path.write_text(
        "timestamp,trade_price,trade_size,bid,ask,contract\n"
        "2026-05-22T09:00:01+02:00,100,243,99.5,100,FDAX\n"
        "2026-05-22T09:01:00+02:00,100,10,99.5,100,FDAX\n"
        "2026-05-22T09:01:30+02:00,88,10,88,88.5,FDAX\n"
        "2026-05-22T09:02:00+02:00,88,1,88,88.5,FDAX\n",
        encoding="utf-8",
    )
    config = StrategyConfig(daily_loss_limit_eur=Decimal("250"))

    result = simulate_replay(import_taq_csv(path), config=config)

    assert any(item.action == "risk_halt" for item in result.signals)
    assert result.realized_pnl_eur <= Decimal("-250")


def test_live_databento_boundary_is_disabled_in_zero_cost_release():
    with pytest.raises(RuntimeError, match="disabled"):
        DisabledDatabentoLiveSource().load(StrategyConfig())


def _official_sample_payloads():
    pre = [
        {
            "instrumentIdentificationCode": "DE0008469594",
            "contractDate": "2026-06-19",
            "contractType": "S",
            "mdupdateDateAndTime": "2026-05-26T09:34:00.000000Z",
            "mdBidMktDepthGroup1": [{"price": 25271.0, "quantity": 1.0}],
            "mdAskMktDepthGroup1": [{"price": 25273.0, "quantity": 2.0}],
        },
        {
            "instrumentIdentificationCode": "DE0008469594",
            "contractDate": "2026-09-18",
            "contractType": "S",
            "bestBid": 25426.0,
            "bestAsk": 25428.0,
            "updateDateAndTime": "2026-05-26T09:34:00.050000Z",
        },
        {
            "instrumentIdentificationCode": "DE0008469594",
            "contractDate": "2026-06-19",
            "contractType": "S",
            "bestBid": 25272.0,
            "bestAsk": 25274.0,
            "updateDateAndTime": "2026-05-26T09:34:05.000000Z",
        },
    ]
    post = [
        {
            "instrumentIdentificationCode": "DE0008469594",
            "contractDate": "2026-06-19",
            "contractType": "S",
            "price": 25273.0,
            "quantity": 2.0,
            "tradingDateAndTime": "2026-05-26T09:34:00.243889Z",
        },
        {
            "instrumentIdentificationCode": "DE0008469594",
            "contractDate": "2026-06-19",
            "contractType": "S",
            "price": 25274.0,
            "quantity": 1.0,
            "tradingDateAndTime": "2026-05-26T09:34:06.000000Z",
        },
    ]
    return (
        gzip.compress("\n".join(json.dumps(row) for row in pre).encode()),
        gzip.compress("\n".join(json.dumps(row) for row in post).encode()),
    )


def test_delayed_source_requires_personal_terms_acknowledgement():
    source = DelayedDeutscheBoerseSource(maturity_date="2026-06-19")

    assert source.probe().sufficiency == "terms_required"
    assert source.probe().delay_minutes == 15
    with pytest.raises(RuntimeError, match="terms acknowledgement"):
        source.load(StrategyConfig(instrument=FDAX_SPEC))


def test_delayed_official_ndjson_pairs_bbo_by_product_and_maturity():
    pre, post = _official_sample_payloads()
    source = DelayedDeutscheBoerseSource(
        maturity_date="2026-06-19",
        consent_accepted=True,
        pretrade_payload=pre,
        posttrade_payload=post,
    )

    report = source.load(StrategyConfig(instrument=FDAX_SPEC))
    bar = aggregate_minute_bars(report.events)[0]

    assert report.accepted_rows == 2
    assert report.events[0].ask == Decimal("25273.0")
    assert report.events[1].bid == Decimal("25272.0")
    assert all(event.ask < Decimal("25400") for event in report.events)
    assert bar.volume == 3
    assert source.probe().sufficiency == "verified_taq"
    assert source.probe().selected_contract.maturity_date == "2026-06-19"


def test_delayed_source_carries_selected_contract_bbo_across_minute_files():
    source = DelayedDeutscheBoerseSource(
        maturity_date="2026-06-19",
        consent_accepted=True,
        allow_empty_minutes=True,
        pretrade_payload=gzip.compress(
            (
                json.dumps(
                    {
                        "instrumentIdentificationCode": "DE0008469594",
                        "contractDate": "2026-06-19",
                        "contractType": "S",
                        "bestBid": 25271.0,
                        "bestAsk": 25273.0,
                        "updateDateAndTime": "2026-05-26T09:34:59.500000Z",
                    }
                )
                + "\n"
            ).encode()
        ),
        posttrade_payload=gzip.compress(b""),
    )
    config = StrategyConfig(instrument=FDAX_SPEC, max_quote_delay_seconds=60)
    assert source.load(config).accepted_rows == 0
    source.pretrade_payload = gzip.compress(b"")
    source.posttrade_payload = gzip.compress(
        (
            json.dumps(
                {
                    "instrumentIdentificationCode": "DE0008469594",
                    "contractDate": "2026-06-19",
                    "contractType": "S",
                    "price": 25273.0,
                    "quantity": 1.0,
                    "tradingDateAndTime": "2026-05-26T09:35:00.100000Z",
                }
            )
            + "\n"
        ).encode()
    )

    report = source.load(config)

    assert report.accepted_rows == 1
    assert report.events[0].bid == Decimal("25271.0")
    assert report.events[0].ask == Decimal("25273.0")


@pytest.mark.skipif(
    not (POSTTRADE_SAMPLE.exists() and PRETRADE_SAMPLE.exists()),
    reason="Official delayed-data sample not available (set FDAX_SAMPLE_DIR).",
)
def test_supplied_official_fdax_sample_qualifies_all_observed_trades():
    source = DelayedDeutscheBoerseSource(
        maturity_date="2026-06-19",
        consent_accepted=True,
        pretrade_payload=PRETRADE_SAMPLE,
        posttrade_payload=POSTTRADE_SAMPLE,
    )

    report = source.load(StrategyConfig(instrument=FDAX_SPEC))
    bar = aggregate_minute_bars(report.events)[0]

    assert report.accepted_rows == 15
    assert report.rejected_rows == 0
    assert bar.volume == 28
    assert bar.orderflow == -2


def test_csv_source_requires_contract_identity(tmp_path):
    path = tmp_path / "missing-contract.csv"
    path.write_text(
        "timestamp,trade_price,trade_size,bid,ask\n"
        "2026-05-22T09:00:05+02:00,18000,1,17999,18000\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="contract/symbol"):
        CsvReplaySource(path).load(StrategyConfig(instrument=FDAX_SPEC))


def test_realistic_paper_slippage_uses_selected_contract_spec():
    config = StrategyConfig(
        instrument=FDAX_SPEC,
        fill_model="realistic_paper",
        slippage_ticks=1,
    )

    result = simulate_replay(import_taq_csv(FIXTURE), config=config)

    assert result.fills[0].price == Decimal("18001.5")
    assert result.fills[1].price == Decimal("18000.0")
    assert result.instrument.tick_value_eur == Decimal("25.00")
    assert result.slippage_ticks == 1


def test_entry_is_blocked_without_a_timely_executable_quote(tmp_path):
    path = tmp_path / "stale-quote.csv"
    path.write_text(
        "timestamp,trade_price,trade_size,bid,ask,contract\n"
        "2026-05-22T09:00:01+02:00,101,243,100,101,FDAX\n"
        "2026-05-22T09:02:01+02:00,101,1,100,101,FDAX\n",
        encoding="utf-8",
    )

    result = simulate_replay(import_taq_csv(path), config=StrategyConfig(max_quote_delay_seconds=60))

    assert result.fills == []
    assert result.signals[0].status == "blocked"
    assert "no timely executable ask" in result.signals[0].reason
