"""Market-data source adapters for local-first FDAX paper sessions."""

from __future__ import annotations

import gzip
import io
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import BinaryIO, Iterable, Protocol

import requests

from .engine import (
    FDAX_SPEC,
    ImportReport,
    QualityIssue,
    StrategyConfig,
    TAQEvent,
    UTC,
    _in_session,
    _parse_timestamp,
    import_taq_csv,
)


FDAX_PRODUCT_ISIN = "DE0008469594"
OFFICIAL_DELAY_MINUTES = 15
OFFICIAL_FILES_URL = "https://mfs.deutsche-boerse.com"
POSTTRADE_SOURCE = "DEUR-posttrade"
PRETRADE_SOURCE = "DEUR-pretradeOthers"


@dataclass(frozen=True)
class ContractSelection:
    product_isin: str
    maturity_date: str
    symbol: str = "FDAX"
    point_value_eur: str = "25.00"
    minimum_price_increment: str = "1.00"
    tick_value_eur: str = "25.00"


@dataclass(frozen=True)
class SourceHealth:
    source_name: str
    source_mode: str
    delay_minutes: int | None
    sufficiency: str
    message: str
    selected_contract: ContractSelection | None = None
    latest_exchange_timestamp: str | None = None
    latest_received_timestamp: str | None = None
    rows_received: int = 0
    rows_accepted: int = 0
    rows_quarantined: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


class MarketDataSource(Protocol):
    source_name: str
    source_mode: str
    delay_minutes: int | None

    def load(self, config: StrategyConfig) -> ImportReport:
        """Return normalized executable trade-and-quote events."""

    def probe(self) -> SourceHealth:
        """Describe whether this source can accurately calculate orderflow."""


@dataclass(frozen=True)
class FixtureSource:
    path: Path
    source_name: str = "Toy deterministic fixture"
    source_mode: str = "fixture_demo"
    delay_minutes: int | None = None

    def load(self, config: StrategyConfig) -> ImportReport:
        return import_taq_csv(self.path, config=config, source_mode="fixture_demo")

    def probe(self) -> SourceHealth:
        return SourceHealth(
            self.source_name,
            self.source_mode,
            self.delay_minutes,
            "verified_taq",
            "Bundled demonstration fixture contains complete synthetic TAQ fields.",
        )


@dataclass(frozen=True)
class CsvReplaySource:
    path: Path
    source_name: str = "Local TAQ CSV"
    source_mode: str = "csv_replay"
    delay_minutes: int | None = None

    def load(self, config: StrategyConfig) -> ImportReport:
        return import_taq_csv(
            self.path,
            config=config,
            expected_contract=config.instrument.symbol,
            require_contract=True,
            source_mode="csv_replay",
        )

    def probe(self) -> SourceHealth:
        return SourceHealth(
            self.source_name,
            self.source_mode,
            self.delay_minutes,
            "checking",
            "Import a CSV to validate required trade, size, bid, ask, timestamp, and symbol fields.",
        )


@dataclass(frozen=True)
class _QuoteUpdate:
    timestamp: datetime
    bid: Decimal | None
    ask: Decimal | None


def _to_decimal(value: object) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def _iter_ndjson_gzip(payload: bytes | Path | BinaryIO) -> Iterable[dict]:
    if isinstance(payload, Path):
        stream: BinaryIO = payload.open("rb")
        close_stream = True
    elif isinstance(payload, bytes):
        stream = io.BytesIO(payload)
        close_stream = True
    else:
        stream = payload
        close_stream = False
    try:
        with gzip.GzipFile(fileobj=stream, mode="rb") as compressed:
            for raw_line in compressed:
                if raw_line.strip():
                    import json

                    yield json.loads(raw_line)
    finally:
        if close_stream:
            stream.close()


def _matches_contract(row: dict, contract: ContractSelection) -> bool:
    return (
        row.get("instrumentIdentificationCode") == contract.product_isin
        and row.get("contractDate") == contract.maturity_date
        and row.get("contractType", "S") == "S"
    )


def _depth_price(row: dict, side: str) -> Decimal | None:
    group = row.get("mdBidMktDepthGroup1" if side == "bid" else "mdAskMktDepthGroup1")
    if isinstance(group, list) and group:
        return _to_decimal(group[0].get("price"))
    return None


@dataclass
class DelayedDeutscheBoerseSource:
    """Accurate delayed FDAX adapter using official matching pre/post-trade files."""

    maturity_date: str | None = None
    consent_accepted: bool = False
    pretrade_payload: bytes | Path | None = None
    posttrade_payload: bytes | Path | None = None
    product_isin: str = FDAX_PRODUCT_ISIN
    allow_empty_minutes: bool = False
    source_name: str = "Deutsche Boerse / Eurex delayed data"
    source_mode: str = "delayed_paper"
    delay_minutes: int | None = OFFICIAL_DELAY_MINUTES
    latest_health: SourceHealth | None = None
    latest_file_minute: datetime | None = None
    carried_bid: Decimal | None = None
    carried_ask: Decimal | None = None
    carried_quote_timestamp: datetime | None = None

    @property
    def contract(self) -> ContractSelection | None:
        if not self.maturity_date:
            return None
        return ContractSelection(self.product_isin, self.maturity_date)

    def probe(self) -> SourceHealth:
        if self.latest_health:
            return self.latest_health
        if not self.consent_accepted:
            return SourceHealth(
                self.source_name,
                self.source_mode,
                self.delay_minutes,
                "terms_required",
                "Confirm that you personally accepted the official delayed-data terms before automated access.",
                self.contract,
            )
        if not self.maturity_date:
            return SourceHealth(
                self.source_name,
                self.source_mode,
                self.delay_minutes,
                "checking",
                "Choose an explicit FDAX maturity to qualify; maturities must never be mixed.",
            )
        return SourceHealth(
            self.source_name,
            self.source_mode,
            self.delay_minutes,
            "checking",
            "Ready to qualify official delayed trade and prevailing BBO detail for the selected maturity.",
            self.contract,
        )

    def _latest_filename_pair(self) -> tuple[str, str, datetime]:
        post = requests.get(f"{OFFICIAL_FILES_URL}/api/{POSTTRADE_SOURCE}", timeout=20)
        pre = requests.get(f"{OFFICIAL_FILES_URL}/api/{PRETRADE_SOURCE}", timeout=20)
        post.raise_for_status()
        pre.raise_for_status()
        post_names = post.json().get("CurrentFiles", [])
        pre_by_suffix = {
            name.removeprefix(f"{PRETRADE_SOURCE}-"): name for name in pre.json().get("CurrentFiles", [])
        }
        for post_name in post_names:
            suffix = post_name.removeprefix(f"{POSTTRADE_SOURCE}-")
            if suffix in pre_by_suffix:
                minute = datetime.fromisoformat(
                    suffix.removesuffix(".json.gz").replace("_", ":") + ":00+00:00"
                ).astimezone(UTC)
                return post_name, pre_by_suffix[suffix], minute
        raise RuntimeError("No matching official pre-trade and post-trade delayed minute files are available.")

    def _fetch_pair(self) -> tuple[bytes, bytes]:
        post_name, pre_name, minute = self._latest_filename_pair()
        post = requests.get(f"{OFFICIAL_FILES_URL}/api/download/{post_name}", timeout=30)
        pre = requests.get(f"{OFFICIAL_FILES_URL}/api/download/{pre_name}", timeout=30)
        post.raise_for_status()
        pre.raise_for_status()
        self.latest_file_minute = minute
        return pre.content, post.content

    def _read_pair(self) -> tuple[bytes | Path, bytes | Path]:
        if self.pretrade_payload is not None and self.posttrade_payload is not None:
            return self.pretrade_payload, self.posttrade_payload
        return self._fetch_pair()

    def load(self, config: StrategyConfig) -> ImportReport:
        if not self.consent_accepted:
            raise RuntimeError("Official delayed-data terms acknowledgement is required before source access.")
        if not self.contract:
            raise RuntimeError("Select an explicit FDAX maturity before qualifying delayed data.")
        pretrade, posttrade = self._read_pair()
        report = ImportReport(adapter="delayed_deutsche_boerse", source_mode="delayed_paper")
        updates: list[_QuoteUpdate] = []
        for row in _iter_ndjson_gzip(pretrade):
            if not _matches_contract(row, self.contract):
                continue
            raw_timestamp = row.get("updateDateAndTime") or row.get("mdupdateDateAndTime")
            if not raw_timestamp:
                continue
            bid = _to_decimal(row.get("bestBid")) or _depth_price(row, "bid")
            ask = _to_decimal(row.get("bestAsk")) or _depth_price(row, "ask")
            if bid is not None or ask is not None:
                updates.append(_QuoteUpdate(_parse_timestamp(str(raw_timestamp)), bid, ask))
        updates.sort(key=lambda item: item.timestamp)

        trades: list[tuple[datetime, Decimal, int, int]] = []
        for source_row, row in enumerate(_iter_ndjson_gzip(posttrade), start=1):
            if not _matches_contract(row, self.contract):
                continue
            report.input_rows += 1
            try:
                timestamp = _parse_timestamp(str(row["tradingDateAndTime"]))
                price = _to_decimal(row.get("price"))
                raw_size = _to_decimal(row.get("quantity"))
                if price is None or price <= 0:
                    raise ValueError("trade price must be positive")
                if raw_size is None or raw_size <= 0 or raw_size != raw_size.to_integral_value():
                    raise ValueError("trade size must be a positive whole number")
                if not _in_session(timestamp, config):
                    report.out_of_session_rows += 1
                    report.issues.append(
                        QualityIssue(source_row, "outside_session", "Trade excluded outside 09:00-17:00 Europe/Berlin.")
                    )
                    continue
                trades.append((timestamp, price, int(raw_size), source_row))
            except (KeyError, ValueError) as error:
                report.rejected_rows += 1
                report.issues.append(QualityIssue(source_row, "invalid_delayed_trade", str(error)))
        trades.sort(key=lambda item: (item[0], item[3]))

        bid: Decimal | None = self.carried_bid
        ask: Decimal | None = self.carried_ask
        quote_timestamp: datetime | None = self.carried_quote_timestamp
        quote_index = 0
        for timestamp, price, size, source_row in trades:
            while quote_index < len(updates) and updates[quote_index].timestamp <= timestamp:
                update = updates[quote_index]
                if update.bid is not None:
                    bid = update.bid
                if update.ask is not None:
                    ask = update.ask
                quote_timestamp = update.timestamp
                quote_index += 1
            if bid is None or ask is None:
                report.rejected_rows += 1
                report.issues.append(
                    QualityIssue(source_row, "missing_prevailing_bbo", "No preceding two-sided BBO for delayed trade.")
                )
                continue
            if bid > ask:
                report.rejected_rows += 1
                report.issues.append(QualityIssue(source_row, "crossed_quote", "Prevailing bid is above ask."))
                continue
            if quote_timestamp and timestamp - quote_timestamp > timedelta(seconds=config.max_quote_delay_seconds):
                report.rejected_rows += 1
                report.issues.append(
                    QualityIssue(source_row, "stale_quote", "Prevailing BBO is too stale for accurate classification.")
                )
                continue
            report.events.append(
                TAQEvent(
                    timestamp=timestamp,
                    trade_price=price,
                    trade_size=size,
                    bid=bid,
                    ask=ask,
                    contract=f"{self.contract.symbol}:{self.contract.maturity_date}",
                    source_row=source_row,
                )
            )
        while quote_index < len(updates):
            update = updates[quote_index]
            if update.bid is not None:
                bid = update.bid
            if update.ask is not None:
                ask = update.ask
            quote_timestamp = update.timestamp
            quote_index += 1
        self.carried_bid = bid
        self.carried_ask = ask
        self.carried_quote_timestamp = quote_timestamp
        if not report.events and self.allow_empty_minutes and report.input_rows == 0:
            self.latest_health = SourceHealth(
                self.source_name,
                self.source_mode,
                self.delay_minutes,
                "verified_taq",
                f"No {self.contract.symbol} {self.contract.maturity_date} trades in the latest delayed minute; waiting.",
                self.contract,
                rows_received=0,
                rows_accepted=0,
                rows_quarantined=0,
            )
            return report
        if not report.events:
            message = "Delayed source does not provide enough TAQ detail to compute Pecchiari orderflow."
            self.latest_health = SourceHealth(
                self.source_name,
                self.source_mode,
                self.delay_minutes,
                "insufficient_taq",
                message,
                self.contract,
                rows_received=report.input_rows,
                rows_quarantined=report.rejected_rows + report.out_of_session_rows,
            )
            raise ValueError(message)
        latest = report.events[-1].timestamp.isoformat()
        quarantined = report.rejected_rows + report.out_of_session_rows
        sufficiency = "verified_taq" if not report.rejected_rows else "paused_quality_error"
        message = (
            f"Official delayed TAQ qualified for {self.contract.symbol} {self.contract.maturity_date}: "
            f"{report.accepted_rows} trades paired to prevailing BBO."
            if sufficiency == "verified_taq"
            else "Accurate session paused because one or more delayed trades could not be paired to valid BBO."
        )
        self.latest_health = SourceHealth(
            self.source_name,
            self.source_mode,
            self.delay_minutes,
            sufficiency,
            message,
            self.contract,
            latest_exchange_timestamp=latest,
            latest_received_timestamp=datetime.now(UTC).isoformat(),
            rows_received=report.input_rows,
            rows_accepted=report.accepted_rows,
            rows_quarantined=quarantined,
        )
        return report


@dataclass(frozen=True)
class DisabledDatabentoLiveSource:
    source_name: str = "Databento XEUR.EOBI"
    source_mode: str = "live_databento_disabled"
    delay_minutes: int | None = 0

    def probe(self) -> SourceHealth:
        return SourceHealth(
            self.source_name,
            self.source_mode,
            self.delay_minutes,
            "unavailable",
            "Real-time market data remains locked without paid market-data entitlement.",
        )

    def load(self, config: StrategyConfig) -> ImportReport:
        del config
        raise RuntimeError(
            "Live Databento XEUR.EOBI is disabled in the zero-cost release. "
            "A licensed market-data entitlement and supported continuous runtime are required."
        )
