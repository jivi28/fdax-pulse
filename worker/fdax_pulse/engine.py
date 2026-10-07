"""FDAX orderflow classification, bar aggregation, and paper-trade replay.

The executable strategy follows pages 40-41 and 63-65 of Matteo Pecchiari's
thesis: classify tick-level trade volume against midpoint quotes, enter one
long FDAX contract after a high-orderflow/high-volume minute, and remain long
while completed one-minute orderflow stays positive.
"""

from __future__ import annotations

import csv
import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Callable, Iterable, Literal
from zoneinfo import ZoneInfo


BERLIN = ZoneInfo("Europe/Berlin")
UTC = timezone.utc
ReplayMode = Literal["automatic", "recommendation"]
ExitPolicy = Literal["momentum", "basic"]
FillModel = Literal["demo_reference", "realistic_paper"]
SessionSourceMode = Literal["delayed_paper", "csv_replay", "fixture_demo"]


@dataclass(frozen=True)
class InstrumentSpec:
    symbol: str
    label: str
    exchange: str = "EUREX"
    point_value_eur: Decimal = Decimal("0.00")
    tick_size: Decimal = Decimal("1")
    tick_value_eur: Decimal = Decimal("0.00")
    contracts: int = 1
    currency: str = "EUR"
    source: str = "official_reference"
    timezone: str = "Europe/Berlin"


# Current Eurex contract specifications. The deterministic fixture intentionally
# retains its thesis/demo economics separately for reproducible demonstrations.
FDAX_SPEC = InstrumentSpec(
    symbol="FDAX",
    label="DAX Futures",
    point_value_eur=Decimal("25.00"),
    tick_value_eur=Decimal("25.00"),
)
FDXM_SPEC = InstrumentSpec(
    symbol="FDXM",
    label="Mini-DAX Futures",
    point_value_eur=Decimal("5.00"),
    tick_value_eur=Decimal("5.00"),
)
FDXS_SPEC = InstrumentSpec(
    symbol="FDXS",
    label="Micro-DAX Futures",
    point_value_eur=Decimal("1.00"),
    tick_value_eur=Decimal("1.00"),
)
DEMO_FDAX_SPEC = InstrumentSpec(
    symbol="FDAX",
    label="FDAX thesis/demo fixture configuration",
    point_value_eur=Decimal("25.00"),
    tick_size=Decimal("0.5"),
    tick_value_eur=Decimal("12.50"),
    source="demo_fixture",
)


@dataclass(frozen=True)
class StrategyConfig:
    orderflow_threshold: int = 24
    volume_threshold: int = 242
    daily_loss_limit_eur: Decimal = Decimal("250.00")
    commission_per_side_eur: Decimal = Decimal("0.00")
    slippage_ticks: int = 0
    fill_model: FillModel = "realistic_paper"
    instrument: InstrumentSpec = DEMO_FDAX_SPEC
    max_quote_delay_seconds: int = 60
    session_start: time = time(9, 0)
    session_end: time = time(17, 0)


@dataclass(frozen=True)
class TAQEvent:
    timestamp: datetime
    trade_price: Decimal
    trade_size: int
    bid: Decimal
    ask: Decimal
    contract: str
    source_row: int


@dataclass(frozen=True)
class QualityIssue:
    row_number: int
    code: str
    message: str


@dataclass
class ImportReport:
    events: list[TAQEvent] = field(default_factory=list)
    issues: list[QualityIssue] = field(default_factory=list)
    input_rows: int = 0
    rejected_rows: int = 0
    out_of_session_rows: int = 0
    adapter: str = "csv_iqfeed"
    source_mode: SessionSourceMode = "csv_replay"

    @property
    def accepted_rows(self) -> int:
        return len(self.events)


@dataclass(frozen=True)
class MinuteBar:
    starts_at: datetime
    ends_at: datetime
    orderflow: int
    volume: int
    close_price: Decimal
    last_bid: Decimal
    last_ask: Decimal
    classified_volume: int
    unclassified_volume: int
    buy_volume: int
    sell_volume: int
    trade_count: int


@dataclass(frozen=True)
class Signal:
    id: str
    timestamp: datetime
    action: Literal["buy", "hold", "sell", "no_action", "risk_halt"]
    reason: str
    orderflow: int
    volume: int
    status: Literal["generated", "executed", "skipped", "blocked"]


@dataclass(frozen=True)
class PaperFill:
    timestamp: datetime
    side: Literal["buy", "sell"]
    price: Decimal
    gross_reference_price: Decimal
    reason: str


@dataclass(frozen=True)
class ClosedTrade:
    entry: PaperFill
    exit: PaperFill
    net_pnl_eur: Decimal
    gross_pnl_eur: Decimal
    ticks: Decimal


@dataclass
class ReplayResult:
    session_id: str
    mode: ReplayMode
    exit_policy: ExitPolicy
    source: str
    source_mode: SessionSourceMode
    fill_model: FillModel
    instrument: InstrumentSpec
    commission_per_side_eur: Decimal
    slippage_ticks: int
    orderflow_threshold: int
    volume_threshold: int
    bars: list[MinuteBar]
    signals: list[Signal]
    fills: list[PaperFill]
    trades: list[ClosedTrade]
    realized_pnl_eur: Decimal
    gross_pnl_eur: Decimal
    win_ratio: Decimal
    risk_reward: Decimal | None
    status: Literal["created", "running", "paused_for_action", "stopped", "completed", "failed"]
    issues: list[QualityIssue] = field(default_factory=list)

    def to_dict(self) -> dict:
        def convert(value):
            if isinstance(value, Decimal):
                return str(value.quantize(Decimal("0.01")))
            if isinstance(value, datetime):
                return value.isoformat()
            if isinstance(value, list):
                return [convert(item) for item in value]
            if hasattr(value, "__dataclass_fields__"):
                return {key: convert(val) for key, val in asdict(value).items()}
            if isinstance(value, dict):
                return {key: convert(val) for key, val in value.items()}
            return value

        return convert(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)


ALIASES = {
    "timestamp": ("timestamp", "time", "datetime", "ts_event", "trade_time"),
    "trade_price": ("trade_price", "price", "last", "last_price"),
    "trade_size": ("trade_size", "size", "volume", "last_size"),
    "bid": ("bid", "bid_price", "bid_px_00", "current_bid_price"),
    "ask": ("ask", "ask_price", "ask_px_00", "current_ask_price"),
    "contract": ("contract", "symbol", "instrument", "raw_symbol"),
}


def _canonical_header(value: str) -> str:
    return value.strip().lower().replace(" ", "_").replace("-", "_")


def _resolve_headers(fieldnames: Iterable[str]) -> dict[str, str | None]:
    headers = {_canonical_header(name): name for name in fieldnames}
    mapping: dict[str, str | None] = {}
    for target, aliases in ALIASES.items():
        mapping[target] = next((headers[name] for name in aliases if name in headers), None)
    return mapping


def _parse_timestamp(raw: str) -> datetime:
    cleaned = raw.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(cleaned)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=BERLIN)
    return parsed.astimezone(UTC)


def _decimal(raw: str) -> Decimal:
    return Decimal(raw.strip())


def _in_session(timestamp: datetime, config: StrategyConfig) -> bool:
    local_time = timestamp.astimezone(BERLIN).time().replace(tzinfo=None)
    return config.session_start <= local_time < config.session_end


def import_taq_csv(
    path: str | Path,
    *,
    config: StrategyConfig | None = None,
    expected_contract: str = FDAX_SPEC.symbol,
    require_contract: bool = False,
    source_mode: SessionSourceMode = "csv_replay",
) -> ImportReport:
    """Read normalized, IQFeed-like, or Databento-like trade-and-quote CSV."""

    config = config or StrategyConfig()
    report = ImportReport(source_mode=source_mode)
    with Path(path).open(newline="", encoding="utf-8-sig") as input_file:
        reader = csv.DictReader(input_file)
        if not reader.fieldnames:
            raise ValueError("The CSV has no header row.")
        mapping = _resolve_headers(reader.fieldnames)
        required = ("timestamp", "trade_price", "trade_size", "bid", "ask")
        missing = [name for name in required if not mapping[name]]
        if missing:
            raise ValueError(f"The CSV is missing required columns: {', '.join(missing)}.")
        if require_contract and not mapping["contract"]:
            raise ValueError("The CSV is missing required contract/symbol identity.")
        canonical_headers = {_canonical_header(field) for field in reader.fieldnames}
        if "ts_event" in canonical_headers:
            report.adapter = "csv_databento"
        elif "last" in canonical_headers or "last_size" in canonical_headers:
            report.adapter = "csv_iqfeed"

        for row_number, row in enumerate(reader, start=2):
            report.input_rows += 1
            try:
                timestamp = _parse_timestamp(row[mapping["timestamp"]])  # type: ignore[index]
                trade_price = _decimal(row[mapping["trade_price"]])  # type: ignore[index]
                size_raw = _decimal(row[mapping["trade_size"]])  # type: ignore[index]
                bid = _decimal(row[mapping["bid"]])  # type: ignore[index]
                ask = _decimal(row[mapping["ask"]])  # type: ignore[index]
                if size_raw != size_raw.to_integral_value() or size_raw <= 0:
                    raise ValueError("trade size must be a positive whole number")
                if trade_price <= 0 or bid <= 0 or ask <= 0:
                    raise ValueError("prices must be positive")
                if bid > ask:
                    raise ValueError("bid is higher than ask")
                contract_value = (
                    row[mapping["contract"]].strip()  # type: ignore[index]
                    if mapping["contract"] and row.get(mapping["contract"])
                    else expected_contract
                )
                if expected_contract.upper() not in contract_value.upper():
                    raise ValueError(f"contract '{contract_value}' is not {expected_contract}")
                if not _in_session(timestamp, config):
                    report.out_of_session_rows += 1
                    report.issues.append(
                        QualityIssue(row_number, "outside_session", "Trade excluded outside 09:00-17:00 Europe/Berlin.")
                    )
                    continue
                report.events.append(
                    TAQEvent(
                        timestamp=timestamp,
                        trade_price=trade_price,
                        trade_size=int(size_raw),
                        bid=bid,
                        ask=ask,
                        contract=contract_value,
                        source_row=row_number,
                    )
                )
            except (KeyError, ValueError, InvalidOperation) as error:
                report.rejected_rows += 1
                report.issues.append(QualityIssue(row_number, "invalid_row", str(error)))

    report.events.sort(key=lambda item: (item.timestamp, item.source_row))
    if not report.events:
        raise ValueError("No valid in-session FDAX trade-and-quote events were found.")
    return report


def aggregate_minute_bars(
    events: Iterable[TAQEvent],
    *,
    quality_issues: list[QualityIssue] | None = None,
) -> list[MinuteBar]:
    """Aggregate ticks into Berlin-session bars with Lee-Ready orderflow."""

    grouped: dict[datetime, list[TAQEvent]] = {}
    for event in sorted(events, key=lambda item: (item.timestamp, item.source_row)):
        local = event.timestamp.astimezone(BERLIN)
        minute_local = local.replace(second=0, microsecond=0)
        minute_utc = minute_local.astimezone(UTC)
        grouped.setdefault(minute_utc, []).append(event)

    previous_trade: Decimal | None = None
    last_tick_direction: int | None = None
    bars: list[MinuteBar] = []
    for start, minute_events in sorted(grouped.items()):
        orderflow = 0
        volume = 0
        classified_volume = 0
        unclassified_volume = 0
        buy_volume = 0
        sell_volume = 0
        for event in minute_events:
            midpoint = (event.bid + event.ask) / Decimal("2")
            sign: int | None
            if event.trade_price > midpoint:
                sign = 1
            elif event.trade_price < midpoint:
                sign = -1
            else:
                if previous_trade is not None and event.trade_price > previous_trade:
                    sign = 1
                elif previous_trade is not None and event.trade_price < previous_trade:
                    sign = -1
                else:
                    sign = last_tick_direction
            volume += event.trade_size
            if sign is None:
                unclassified_volume += event.trade_size
                if quality_issues is not None:
                    quality_issues.append(
                        QualityIssue(
                            event.source_row,
                            "unclassified_midpoint_tie",
                            "Midpoint trade excluded from orderflow because tick direction is unresolved.",
                        )
                    )
            else:
                orderflow += sign * event.trade_size
                classified_volume += event.trade_size
                if sign > 0:
                    buy_volume += event.trade_size
                else:
                    sell_volume += event.trade_size
            if previous_trade is not None:
                if event.trade_price > previous_trade:
                    last_tick_direction = 1
                elif event.trade_price < previous_trade:
                    last_tick_direction = -1
            previous_trade = event.trade_price
        last = minute_events[-1]
        bars.append(
            MinuteBar(
                starts_at=start,
                ends_at=start + timedelta(minutes=1),
                orderflow=orderflow,
                volume=volume,
                close_price=last.trade_price,
                last_bid=last.bid,
                last_ask=last.ask,
                classified_volume=classified_volume,
                unclassified_volume=unclassified_volume,
                buy_volume=buy_volume,
                sell_volume=sell_volume,
                trade_count=len(minute_events),
            )
        )
    return bars


def _first_event_at_or_after(
    events: list[TAQEvent],
    timestamp: datetime,
    max_delay_seconds: int | None = None,
) -> TAQEvent | None:
    event = next((item for item in events if item.timestamp >= timestamp), None)
    if event and max_delay_seconds is not None:
        if event.timestamp - timestamp > timedelta(seconds=max_delay_seconds):
            return None
    return event


def _pnl(exit_price: Decimal, entry_price: Decimal, instrument: InstrumentSpec) -> Decimal:
    ticks = (exit_price - entry_price) / instrument.tick_size
    return ticks * instrument.tick_value_eur


def _fill_price(side: Literal["buy", "sell"], event: TAQEvent, config: StrategyConfig) -> Decimal:
    base = event.ask if side == "buy" else event.bid
    if config.fill_model == "demo_reference":
        return base
    slip = config.instrument.tick_size * Decimal(config.slippage_ticks)
    return base + slip if side == "buy" else base - slip


def _final_metrics(trades: list[ClosedTrade]) -> tuple[Decimal, Decimal | None]:
    if not trades:
        return Decimal("0.00"), None
    wins = [trade.net_pnl_eur for trade in trades if trade.net_pnl_eur > 0]
    losses = [abs(trade.net_pnl_eur) for trade in trades if trade.net_pnl_eur < 0]
    ratio = Decimal(len(wins)) / Decimal(len(trades)) * Decimal("100")
    risk_reward = (
        (sum(wins) / Decimal(len(wins))) / (sum(losses) / Decimal(len(losses)))
        if losses and wins
        else None
    )
    return ratio, risk_reward


def simulate_replay(
    report: ImportReport,
    *,
    mode: ReplayMode = "automatic",
    exit_policy: ExitPolicy = "momentum",
    config: StrategyConfig | None = None,
    approve: Callable[[Signal], bool | None] | None = None,
    source: str | None = None,
    session_id: str | None = None,
    force_flatten_at_end: bool = True,
    result_status: Literal["running", "stopped", "completed", "failed"] = "completed",
) -> ReplayResult:
    """Paper trade completed bars, optionally requesting recommendations approval."""

    config = config or StrategyConfig()
    events = report.events
    quality_issues = list(report.issues)
    bars = aggregate_minute_bars(events, quality_issues=quality_issues)
    signals: list[Signal] = []
    fills: list[PaperFill] = []
    trades: list[ClosedTrade] = []
    position: PaperFill | None = None
    halted_dates: set[str] = set()
    realized_by_date: dict[str, Decimal] = {}
    paused_for_action = False

    def decision(signal: Signal) -> bool | None:
        if mode == "automatic":
            return True
        return approve(signal) if approve is not None else None

    def signal(action, bar, reason, status="generated") -> Signal:
        created = Signal(
            id=str(uuid.uuid4()),
            timestamp=bar.ends_at,
            action=action,
            reason=reason,
            orderflow=bar.orderflow,
            volume=bar.volume,
            status=status,
        )
        signals.append(created)
        return created

    def close_position(
        exit_event: TAQEvent,
        bar: MinuteBar,
        reason: str,
        action: str = "sell",
        *,
        require_approval: bool = True,
    ) -> None:
        nonlocal position, paused_for_action
        assert position is not None
        candidate = Signal(
            id=str(uuid.uuid4()),
            timestamp=bar.ends_at,
            action=action,  # type: ignore[arg-type]
            reason=reason,
            orderflow=bar.orderflow,
            volume=bar.volume,
            status="generated",
        )
        if require_approval:
            approval = decision(candidate)
            if approval is None:
                signals.append(candidate)
                paused_for_action = True
                return
            if not approval:
                signals.append(Signal(**{**asdict(candidate), "status": "skipped"}))
                return
        signals.append(Signal(**{**asdict(candidate), "status": "executed"}))
        exit_fill = PaperFill(
            timestamp=exit_event.timestamp,
            side="sell",
            price=_fill_price("sell", exit_event, config),
            gross_reference_price=exit_event.trade_price,
            reason=reason,
        )
        fills.append(exit_fill)
        fees = config.commission_per_side_eur * Decimal("2")
        trade = ClosedTrade(
            entry=position,
            exit=exit_fill,
            net_pnl_eur=_pnl(exit_fill.price, position.price, config.instrument) - fees,
            gross_pnl_eur=_pnl(
                exit_fill.gross_reference_price,
                position.gross_reference_price,
                config.instrument,
            ),
            ticks=(exit_fill.price - position.price) / config.instrument.tick_size,
        )
        trades.append(trade)
        date_key = bar.starts_at.astimezone(BERLIN).date().isoformat()
        realized_by_date[date_key] = realized_by_date.get(date_key, Decimal("0")) + trade.net_pnl_eur
        position = None

    for index, bar in enumerate(bars):
        if paused_for_action:
            break
        date_key = bar.starts_at.astimezone(BERLIN).date().isoformat()
        if position is not None:
            marked_pnl = _pnl(bar.last_bid, position.price, config.instrument)
            if realized_by_date.get(date_key, Decimal("0")) + marked_pnl <= -config.daily_loss_limit_eur:
                exit_event = _first_event_at_or_after(
                    events, bar.ends_at, config.max_quote_delay_seconds
                ) or events[-1]
                close_position(
                    exit_event,
                    bar,
                    "Daily paper-loss cutoff reached.",
                    "risk_halt",
                    require_approval=False,
                )
                halted_dates.add(date_key)
                continue
            should_exit = exit_policy == "basic" or bar.orderflow <= 0
            if should_exit:
                exit_event = _first_event_at_or_after(
                    events, bar.ends_at, config.max_quote_delay_seconds
                )
                reason = "One-minute holding window completed." if exit_policy == "basic" else "Orderflow is no longer positive."
                if exit_event is None:
                    signal("sell", bar, "Exit blocked: no timely executable bid quote.", "blocked")
                else:
                    close_position(exit_event, bar, reason)
            else:
                signal("hold", bar, "Positive orderflow momentum remains active.", "executed")
            continue

        if date_key in halted_dates:
            continue
        if bar.orderflow > config.orderflow_threshold and bar.volume > config.volume_threshold:
            candidate = Signal(
                id=str(uuid.uuid4()),
                timestamp=bar.ends_at,
                action="buy",
                reason=f"Orderflow {bar.orderflow} > {config.orderflow_threshold} and volume {bar.volume} > {config.volume_threshold}.",
                orderflow=bar.orderflow,
                volume=bar.volume,
                status="generated",
            )
            entry_event = _first_event_at_or_after(
                events, bar.ends_at, config.max_quote_delay_seconds
            )
            if entry_event is None:
                signals.append(
                    Signal(
                        **{
                            **asdict(candidate),
                            "reason": "Entry blocked: no timely executable ask quote.",
                            "status": "blocked",
                        }
                    )
                )
                continue
            approval = decision(candidate)
            if approval is None:
                signals.append(candidate)
                paused_for_action = True
                continue
            if not approval:
                signals.append(Signal(**{**asdict(candidate), "status": "skipped"}))
                continue
            signals.append(Signal(**{**asdict(candidate), "status": "executed"}))
            position = PaperFill(
                timestamp=entry_event.timestamp,
                side="buy",
                price=_fill_price("buy", entry_event, config),
                gross_reference_price=entry_event.trade_price,
                reason="Strategy entry at next interval ask.",
            )
            fills.append(position)

    if position is not None and force_flatten_at_end and not paused_for_action:
        final_event = events[-1]
        final_bar = bars[-1]
        close_position(final_event, final_bar, "Forced flatten at replay/session end.", require_approval=False)

    realized = sum((trade.net_pnl_eur for trade in trades), Decimal("0.00"))
    gross = sum((trade.gross_pnl_eur for trade in trades), Decimal("0.00"))
    win_ratio, risk_reward = _final_metrics(trades)
    return ReplayResult(
        session_id=session_id or str(uuid.uuid4()),
        mode=mode,
        exit_policy=exit_policy,
        source=source or report.adapter,
        source_mode=report.source_mode,
        fill_model=config.fill_model,
        instrument=config.instrument,
        commission_per_side_eur=config.commission_per_side_eur,
        slippage_ticks=config.slippage_ticks,
        orderflow_threshold=config.orderflow_threshold,
        volume_threshold=config.volume_threshold,
        bars=bars,
        signals=signals,
        fills=fills,
        trades=trades,
        realized_pnl_eur=realized,
        gross_pnl_eur=gross,
        win_ratio=win_ratio,
        risk_reward=risk_reward,
        status="paused_for_action" if paused_for_action else result_status,
        issues=quality_issues,
    )
