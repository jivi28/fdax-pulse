"use client";

import { EquityCurve } from "@/components/equity-curve";
import { OrderflowChart } from "@/components/orderflow-chart";
import { SessionHistory } from "@/components/session-history";
import { LIVE_INSTRUMENTS, type ConnectionStatus } from "@/lib/domain";
import { CALIBRATION_MIN_BARS } from "@/lib/live-engine";
import { useLiveSession } from "@/lib/use-live-session";

const CONN_LABEL: Record<ConnectionStatus, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  fallback: "Live · Fallback",
  unreachable: "Feed unreachable",
};

function usdt(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}
function num(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function LiveConsole() {
  const session = useLiveSession("BTCUSDT", "automatic");
  const { snapshot, connection, exchange, instrumentSymbol, decisionMode } = session;
  const instrument = LIVE_INSTRUMENTS[instrumentSymbol] ?? LIVE_INSTRUMENTS.BTCUSDT;
  const tickValue = instrument.tickSize * instrument.positionSize;
  const d = instrument.tickSize >= 1 ? 0 : instrument.tickSize >= 0.1 ? 1 : 2;
  const base = instrument.symbol.replace("USDT", "");

  const bars = snapshot.bars;
  const lastBar = bars.at(-1) ?? null;
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : null;
  const thr = snapshot.thresholds;
  const calibrated = thr.calibrated;
  const inPos = !!snapshot.position;
  const total = snapshot.realizedPnl + snapshot.openPnl;
  const closed = snapshot.trades.length;
  const connected = connection === "live" || connection === "fallback";
  const venue = exchange === "binance" ? "Binance USD-M" : "Bybit Linear";
  const curOf = lastBar?.orderflow ?? 0;
  const curVol = lastBar?.volume ?? 0;
  const tickDir = lastBar && prevBar ? Math.sign(lastBar.close - prevBar.close) : 0;

  const ofPct = calibrated ? Math.min((Math.abs(curOf) / (thr.orderflow * 1.5)) * 100, 100) : 0;
  const volPct = calibrated ? Math.min((curVol / (thr.volume * 1.5)) * 100, 100) : 0;
  const ofArmed = calibrated && curOf > thr.orderflow;
  const volArmed = calibrated && curVol > thr.volume;

  const pending = snapshot.pending;
  const tickerColor = (dir: number) => (dir > 0 ? "var(--up)" : dir < 0 ? "var(--down)" : "var(--ink)");
  const lastFill = snapshot.fills.at(-1) ?? null;

  return (
    <div className="stack">
      {/* Lead story */}
      <section className="lead">
        <div className="lead-main">
          <p className="eyebrow">
            <span className="dot">●</span> Live Futures Orderflow · Paper Trading Only
          </p>
          <h1 className="lead-headline">
            {!calibrated
              ? "Calibrating — learning the live distribution"
              : inPos
                ? `Holding ${instrument.positionSize} ${base} long`
                : "Armed — waiting for the next entry signal"}
          </h1>
          <p className="lead-dek">
            Runs the Pecchiari orderflow strategy on real {venue} futures data — free, no account needed.
            Entry and exit thresholds recalibrate every minute to the live 85th percentile of orderflow and volume.
          </p>
        </div>
        <div className="lead-aside">
          <p className="eyebrow">Paper Account · Session P&amp;L</p>
          <div className={`bignum ${total >= 0 ? "up" : "dn"}`}>{usdt(total)}</div>
          <div className="bignum-sub">
            <div>
              <span className="k">Realized</span>
              <span className="v" style={{ color: snapshot.realizedPnl >= 0 ? "var(--up)" : "var(--down)" }}>
                {usdt(snapshot.realizedPnl)}
              </span>
            </div>
            <div>
              <span className="k">Open</span>
              <span className="v" style={{ color: snapshot.openPnl >= 0 ? "var(--up)" : "var(--down)" }}>
                {usdt(snapshot.openPnl)}
              </span>
            </div>
            <div>
              <span className="k">Closed</span>
              <span className="v">{closed}</span>
            </div>
            {lastFill && (
              <div>
                <span className="k">Last fill</span>
                <span className="v" style={{ color: lastFill.side === "buy" ? "var(--up)" : "var(--down)" }}>
                  {lastFill.side.toUpperCase()} {lastFill.price.toFixed(d)} · {lastFill.time}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Controls */}
      <section className="panel controls" aria-label="Session controls">
        <div className="field">
          <label>Instrument</label>
          <select value={instrumentSymbol} onChange={(e) => session.setInstrument(e.target.value)}>
            {Object.values(LIVE_INSTRUMENTS).map((it) => (
              <option key={it.symbol} value={it.symbol}>
                {it.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Decision mode</label>
          <div className="segment">
            <button className={decisionMode === "automatic" ? "active" : ""} onClick={() => session.setDecisionMode("automatic")}>
              Automatic
            </button>
            <button className={decisionMode === "recommendation" ? "active" : ""} onClick={() => session.setDecisionMode("recommendation")}>
              Manual
            </button>
          </div>
        </div>
        <div className="spacer" />
        <div className={`conn ${connection}`}>
          <span className="dotled" />
          <span>
            {CONN_LABEL[connection]}
            {connected ? ` · ${exchange === "binance" ? "Binance" : "Bybit"}` : ""}
          </span>
        </div>
        <button className="btn small" onClick={session.reset}>
          Reset
        </button>
      </section>

      {/* Pending manual decision */}
      {pending && (
        <section className="decision" aria-live="assertive">
          <div>
            <p className="eyebrow" style={{ color: "var(--gold)" }}>
              Manual paper decision required
            </p>
            <h2>{pending.signal.action === "buy" ? `Buy ${instrument.positionSize} ${base}` : "Sell the held position"}</h2>
            <p>
              {pending.signal.reason} Projected {pending.fill.side} fill at{" "}
              <b className="mono">{pending.fill.price.toFixed(d)}</b>.
            </p>
          </div>
          <div className="buttons">
            <button className="btn up" onClick={session.approve}>
              Execute paper trade
            </button>
            <button className="btn ghost" onClick={session.skip}>
              Skip
            </button>
          </div>
        </section>
      )}

      {/* Calibration banner */}
      <section className="calib panel">
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>
            Live calibration
          </p>
          <h3 className="serif">{calibrated ? "Strategy armed" : "Learning the live distribution"}</h3>
          <p>
            {calibrated ? (
              <>
                Thresholds auto-calibrated to the live 85th percentile — orderflow <b>&gt; {num(thr.orderflow)}</b>,
                volume <b>&gt; {num(thr.volume)}</b> across <b>{thr.sample}</b> bars. They re-fit every completed minute.
              </>
            ) : (
              <>
                Collected <b>{thr.sample}</b> of {CALIBRATION_MIN_BARS} bars. No trades are taken until the distribution
                is sufficient.
              </>
            )}
          </p>
        </div>
        <span className={`badge ${calibrated ? "live" : "warn"}`} style={{ flex: "none", marginLeft: "auto" }}>
          <span className="led" />
          {calibrated ? "Armed" : "Calibrating"}
        </span>
      </section>

      {/* Charts */}
      <section className="workspace" style={{ alignItems: "start" }}>
        <article className="panel" style={{ padding: "var(--pad)" }}>
          <div className="section-rule">
            <h2>Orderflow momentum</h2>
            <span className="meta">{calibrated ? `OF › ${num(thr.orderflow)} · VOL › ${num(thr.volume)}` : "calibrating"}</span>
          </div>
          <OrderflowChart
            bars={bars}
            signals={snapshot.signals}
            threshold={calibrated ? thr.orderflow : 0}
            volumeThreshold={calibrated ? thr.volume : 0}
            activeIndex={bars.length - 1}
          />

          <div className="stack" style={{ marginTop: "var(--gap)" }}>
            <article className="stat">
              <p className="eyebrow">Live Price · {base}</p>
              <div className="pair">
                <span className="tag">BID {snapshot.lastBid ? snapshot.lastBid.toFixed(d) : "--"}</span>
                <span className="tag">ASK {snapshot.lastAsk ? snapshot.lastAsk.toFixed(d) : "--"}</span>
              </div>
              <div className="figure" style={{ color: tickerColor(tickDir) }}>
                {snapshot.lastPrice ? snapshot.lastPrice.toFixed(d) : "--"}
              </div>
              <span className="sub">{connected ? `${instrument.label} · real public feed` : "connecting to live feed…"}</span>
            </article>

            <article className="stat">
              <p className="eyebrow">Orderflow · Trigger</p>
              <div className={`figure ${curOf >= 0 ? "up" : "dn"}`}>
                {curOf > 0 ? "+" : ""}
                {num(curOf)}
              </div>
              <div className="meter-row">
                <div className={`meter ${ofArmed ? "armed" : ""}`}>
                  <i style={{ width: ofPct + "%" }} />
                </div>
                <span className="thr">{calibrated ? `› ${num(thr.orderflow)}` : "cal…"}</span>
              </div>
              <span className="sub">{!calibrated ? "calibrating threshold" : ofArmed ? "above entry threshold" : "below entry threshold"}</span>
            </article>

            <article className="stat">
              <p className="eyebrow">Volume · Trigger</p>
              <div className="figure">{num(curVol)}</div>
              <div className="meter-row">
                <div className="meter vol">
                  <i style={{ width: volPct + "%" }} />
                </div>
                <span className="thr">{calibrated ? `› ${num(thr.volume)}` : "cal…"}</span>
              </div>
              <span className="sub">
                {!calibrated ? "calibrating threshold" : volArmed ? "above entry threshold" : "below entry threshold"} · base units
              </span>
            </article>

            <article className="stat">
              <p className="eyebrow">Position</p>
              <div className="figure" style={{ fontSize: inPos ? 24 : 30 }}>
                {inPos ? `LONG ${instrument.positionSize}` : "FLAT"}
              </div>
              {inPos && snapshot.position ? (
                <>
                  <div className="meter-row">
                    <span className="thr">
                      entry {snapshot.position.entryPrice.toFixed(d)} · open {usdt(snapshot.openPnl)}
                    </span>
                  </div>
                  <span className="sub">hold while orderflow positive</span>
                </>
              ) : (
                <span className="sub" style={{ marginTop: "auto" }}>
                  {calibrated ? "awaiting next qualified entry" : "strategy not yet armed"}
                </span>
              )}
            </article>
          </div>
        </article>
        <article className="panel" style={{ padding: "var(--pad)" }}>
          <div className="section-rule">
            <h2>Equity curve</h2>
            <span className="meta">{closed} closed</span>
          </div>
          <EquityCurve fills={snapshot.fills} tickValueEur={tickValue} tickSize={instrument.tickSize} currency="USDT" />
        </article>
      </section>

      <SessionHistory
        todayFills={snapshot.fills}
        todaySymbol={instrument.symbol}
        tickSize={instrument.tickSize}
        tickValue={tickValue}
        priceDecimals={d}
      />
    </div>
  );
}
