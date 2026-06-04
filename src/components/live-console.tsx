"use client";

import { useMemo } from "react";
import { Activity, Bell, RotateCcw, SkipForward, Wifi, WifiOff } from "lucide-react";

import { EquityCurve } from "@/components/equity-curve";
import { OrderflowChart } from "@/components/orderflow-chart";
import { TradeLog } from "@/components/trade-log";
import { LIVE_INSTRUMENTS, type ConnectionStatus } from "@/lib/domain";
import { CALIBRATION_MIN_BARS } from "@/lib/live-engine";
import { useLiveSession } from "@/lib/use-live-session";

function usdt(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  fallback: "Live (fallback)",
  unreachable: "Feed unreachable",
};

export function LiveConsole() {
  const session = useLiveSession("BTCUSDT", "automatic");
  const { snapshot, connection, exchange, instrumentSymbol, decisionMode } = session;
  const instrument = LIVE_INSTRUMENTS[instrumentSymbol] ?? LIVE_INSTRUMENTS.BTCUSDT;
  const tickValue = instrument.tickSize * instrument.positionSize;

  const bars = snapshot.bars;
  const lastBar = bars.at(-1) ?? null;
  const thresholds = snapshot.thresholds;
  const calibrating = !thresholds.calibrated;
  const totalPnl = snapshot.realizedPnl + snapshot.openPnl;
  const connected = connection === "live" || connection === "fallback";

  const ofPercent = lastBar && thresholds.orderflow
    ? Math.min((Math.abs(lastBar.orderflow) / (thresholds.orderflow * 1.5)) * 100, 100)
    : 0;
  const volPercent = lastBar && thresholds.volume
    ? Math.min((lastBar.volume / (thresholds.volume * 1.5)) * 100, 100)
    : 0;

  const closedTrades = Math.floor(snapshot.fills.length / 2);
  const priceDecimals = instrument.tickSize >= 1 ? 0 : instrument.tickSize >= 0.1 ? 1 : 2;

  const pending = snapshot.pending;

  const calibrationNote = useMemo(() => {
    if (thresholds.calibrated) {
      return `Thresholds auto-calibrated to the live 85th percentile — orderflow > ${thresholds.orderflow}, volume > ${thresholds.volume}.`;
    }
    return `Calibrating thresholds from the live distribution… ${thresholds.sample}/${CALIBRATION_MIN_BARS} minute bars collected.`;
  }, [thresholds]);

  return (
    <>
      <section className="hero-panel panel">
        <div>
          <p className="eyebrow">Live Futures Orderflow / Paper Only</p>
          <h1>Live Orderflow Paper Trading</h1>
          <p className="intro">
            The Pecchiari orderflow strategy running on a real, free public futures tick feed. FDAX
            itself needs paid data (see Advanced); the live feed uses crypto futures with the identical
            trade-and-quote method.
          </p>
        </div>
        <div className={`conn-badge ${connection}`}>
          {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
          <span>
            {CONNECTION_LABEL[connection]}
            {connected ? ` · ${exchange === "binance" ? "Binance" : "Bybit"} ${instrument.label}` : ""}
          </span>
        </div>
      </section>

      <section className="control-strip panel" aria-label="Live session controls">
        <label className="select-field">
          Instrument
          <select value={instrumentSymbol} onChange={(event) => session.setInstrument(event.target.value)}>
            {Object.values(LIVE_INSTRUMENTS).map((item) => (
              <option key={item.symbol} value={item.symbol}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="mode-toggle" aria-label="Decision mode">
          <button className={decisionMode === "automatic" ? "active" : ""} onClick={() => session.setDecisionMode("automatic")}>
            Automatic
          </button>
          <button className={decisionMode === "recommendation" ? "active" : ""} onClick={() => session.setDecisionMode("recommendation")}>
            Manual
          </button>
        </div>
        <div className="buttons session-actions">
          <button className="ghost" onClick={session.reset}>
            <RotateCcw size={16} /> Reset
          </button>
        </div>
        <span className={`status ${connected ? "running" : "paused_for_action"}`}>
          {calibrating ? "calibrating" : "armed"}
        </span>
      </section>

      {pending && (
        <section className="decision panel" aria-live="assertive">
          <div>
            <p className="eyebrow">Manual Paper Decision Required</p>
            <h2>{pending.signal.action.toUpperCase()} 1 paper position</h2>
            <p>
              {pending.signal.reason} Projected {pending.fill.side} fill: {pending.fill.price.toFixed(priceDecimals)}.
            </p>
          </div>
          <div className="buttons">
            <button className="primary" onClick={session.approve}>
              Execute paper trade
            </button>
            <button className="ghost" onClick={session.skip}>
              <SkipForward size={16} /> Skip
            </button>
          </div>
        </section>
      )}

      <section className="metric-grid">
        <article className="panel quote">
          <p className="eyebrow">Live Price</p>
          <strong>{snapshot.lastPrice ? snapshot.lastPrice.toFixed(priceDecimals) : "--"}</strong>
          <div className="bid-ask">
            <span>Bid {snapshot.lastBid ? snapshot.lastBid.toFixed(priceDecimals) : "--"}</span>
            <span>Ask {snapshot.lastAsk ? snapshot.lastAsk.toFixed(priceDecimals) : "--"}</span>
          </div>
          <small>{connected ? `${instrument.label} · real public feed` : "Connecting to live feed…"}</small>
        </article>
        <article className="panel metric">
          <p className="eyebrow">Orderflow / Trigger</p>
          <strong className={lastBar && lastBar.orderflow > 0 ? "positive" : "negative"}>
            {lastBar ? `${lastBar.orderflow > 0 ? "+" : ""}${lastBar.orderflow}` : "--"}
          </strong>
          <div className="meter">
            <i style={{ width: `${ofPercent}%` }} />
          </div>
          <small>{calibrating ? "Calibrating threshold…" : `Entry > ${thresholds.orderflow}`}</small>
        </article>
        <article className="panel metric">
          <p className="eyebrow">Volume / Trigger</p>
          <strong>{lastBar ? lastBar.volume : "--"}</strong>
          <div className="meter volume">
            <i style={{ width: `${volPercent}%` }} />
          </div>
          <small>{calibrating ? "Calibrating threshold…" : `Entry > ${thresholds.volume}`}</small>
        </article>
        <article className="panel pnl">
          <p className="eyebrow">Paper Account P&amp;L</p>
          <strong className={totalPnl >= 0 ? "positive" : "negative"}>{usdt(totalPnl)}</strong>
          <dl>
            <div>
              <dt>Realized</dt>
              <dd>{usdt(snapshot.realizedPnl)}</dd>
            </div>
            <div>
              <dt>Open</dt>
              <dd>{usdt(snapshot.openPnl)}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="capability panel" role="status">
        <Activity size={20} />
        <div>
          <p className="eyebrow">Live Calibration</p>
          <h2>{thresholds.calibrated ? "Strategy armed" : "Learning the live distribution"}</h2>
          <p>{calibrationNote}</p>
        </div>
      </section>

      <section className="workspace">
        <article className="panel chart-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Minute Bars</p>
              <h2>Orderflow momentum</h2>
            </div>
            <span className={`badge ${thresholds.calibrated ? "safe" : "warn"}`}>
              {thresholds.calibrated ? `OF > ${thresholds.orderflow} / VOL > ${thresholds.volume}` : "Calibrating"}
            </span>
          </div>
          <div className="of-chart-wrap">
            <OrderflowChart
              bars={bars}
              signals={snapshot.signals}
              threshold={thresholds.calibrated ? thresholds.orderflow : 0}
              activeIndex={bars.length - 1}
            />
          </div>
        </article>
        <article className="panel chart-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Realized P&amp;L</p>
              <h2>Equity curve</h2>
            </div>
            <span className="badge">{closedTrades} closed</span>
          </div>
          <div className="equity-wrap">
            <EquityCurve fills={snapshot.fills} tickValueEur={tickValue} tickSize={instrument.tickSize} currency="USDT" />
          </div>
        </article>
      </section>

      <section className="panel audit-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Paper Activity</p>
            <h2>{closedTrades} closed trades</h2>
          </div>
          <button className="ghost small" disabled>
            <Bell size={14} /> Live
          </button>
        </div>
        <TradeLog
          fills={snapshot.fills}
          tickSize={instrument.tickSize}
          tickValue={tickValue}
          currency="USDT"
          priceDecimals={priceDecimals}
        />
      </section>
    </>
  );
}
