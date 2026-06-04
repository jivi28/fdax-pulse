"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, CirclePlay, LockKeyhole, Pause, RotateCcw, Settings2, SkipForward, Upload } from "lucide-react";

import { CloudStatus } from "@/components/cloud-status";
import { EquityCurve } from "@/components/equity-curve";
import { OrderflowChart } from "@/components/orderflow-chart";
import {
  DataQualityCard,
  ExecutionConfigPanel,
  MarketClockCard,
  SignalAuditTable,
  SourceModeSelector,
} from "@/components/session-panels";
import {
  CURRENT_CONTRACTS,
  DEMO_FDAX,
  STRATEGY,
  advanceReplay,
  benchmark,
  createDemoState,
  fixtureBars,
  realizedPnl,
  unrealizedPnl,
} from "@/lib/demo-engine";
import {
  acknowledgeOfficialTerms,
  commandDelayedSession,
  fetchLatestLocalSession,
  fetchLocalSources,
  importCsvSession,
  qualifyOfficialFiles,
  startDelayedSession,
  stopDelayedSession,
} from "@/lib/local-worker";
import type { DecisionMode, PaperFill, SessionSourceMode, SourceHealth, WorkerSession } from "@/lib/domain";

function eur(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}

const SOURCE_HEALTH: Record<SessionSourceMode, SourceHealth> = {
  delayed_paper: {
    sourceName: "Deutsche Boerse / Eurex delayed service",
    delayMinutes: 15,
    sufficiency: "terms_required",
    message: "Accept the official delayed-data terms personally, then qualify matching pre-trade and post-trade files.",
  },
  csv_replay: {
    sourceName: "Mac-local TAQ CSV import",
    delayMinutes: null,
    sufficiency: "checking",
    message: "Use the local worker to import and validate timestamp, symbol, trade, size, bid, and ask fields.",
  },
  fixture_demo: {
    sourceName: "Toy deterministic fixture",
    delayMinutes: null,
    sufficiency: "verified_taq",
    message: "Toy deterministic fixture — not real FDAX market data.",
  },
  // Inert entry: the live crypto console has its own home page and never uses this map.
  live_crypto: {
    sourceName: "Live public crypto-futures feed",
    delayMinutes: 0,
    sufficiency: "verified_taq",
    message: "Live console runs on the home page.",
  },
};

// ─── Trade log helpers ────────────────────────────────────────────────────────

interface ClosedTrade {
  index: number;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  ticks: number;
  pnlEur: number;
}

function buildTrades(fills: PaperFill[], tickValueEur: number, tickSize: number): ClosedTrade[] {
  const trades: ClosedTrade[] = [];
  for (let i = 0; i + 1 < fills.length; i += 2) {
    const entry = fills[i]!;
    const exit = fills[i + 1]!;
    const ticks = (exit.price - entry.price) / tickSize;
    trades.push({
      index: trades.length + 1,
      entryTime: entry.time,
      exitTime: exit.time,
      entryPrice: entry.price,
      exitPrice: exit.price,
      ticks,
      pnlEur: ticks * tickValueEur,
    });
  }
  return trades;
}

// ─── TradeLog component ───────────────────────────────────────────────────────

function TradeLog({ fills, tickValueEur, tickSize }: { fills: PaperFill[]; tickValueEur: number; tickSize: number }) {
  const trades = buildTrades(fills, tickValueEur, tickSize);
  if (!trades.length) {
    return <p className="muted">No closed trades yet.</p>;
  }
  return (
    <div className="trade-log-wrap">
      <table className="trade-log">
        <thead>
          <tr>
            <th>#</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>Entry px</th>
            <th>Exit px</th>
            <th>Ticks</th>
            <th>P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.index} className={t.pnlEur >= 0 ? "win" : "loss"}>
              <td className="mono">{t.index}</td>
              <td className="mono">{t.entryTime}</td>
              <td className="mono">{t.exitTime}</td>
              <td className="mono">{t.entryPrice.toFixed(1)}</td>
              <td className="mono">{t.exitPrice.toFixed(1)}</td>
              <td className="mono">{t.ticks > 0 ? "+" : ""}{t.ticks.toFixed(0)}</td>
              <td className={`mono ${t.pnlEur >= 0 ? "positive" : "negative"}`}>
                {t.pnlEur >= 0 ? "+" : ""}{t.pnlEur.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main console ─────────────────────────────────────────────────────────────

export function ReplayConsole() {
  const [sourceMode, setSourceMode] = useState<SessionSourceMode>("fixture_demo");
  const [decisionMode, setDecisionMode] = useState<DecisionMode>("automatic");
  const [contractSymbol, setContractSymbol] = useState<"FDAX" | "FDXM" | "FDXS">("FDAX");
  const [speed, setSpeed] = useState(1);
  const [lossLimit, setLossLimit] = useState<number>(STRATEGY.dailyLossLimitEur);
  const [commission, setCommission] = useState(0);
  const [slippage, setSlippage] = useState(0);
  const [state, setState] = useState(() => createDemoState("automatic"));
  const [now, setNow] = useState<Date | null>(null);
  const [notificationState, setNotificationState] = useState<NotificationPermission | "unavailable">("default");
  const [sourceHealth, setSourceHealth] = useState(SOURCE_HEALTH);
  const [termsAcknowledged, setTermsAcknowledged] = useState(false);
  const [maturityDate, setMaturityDate] = useState("2026-06-19");
  const [pretradeFile, setPretradeFile] = useState<File | null>(null);
  const [posttradeFile, setPosttradeFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [workerSession, setWorkerSession] = useState<WorkerSession | null>(null);
  const [workerFeedback, setWorkerFeedback] = useState("");
  const [workerBusy, setWorkerBusy] = useState(false);

  useEffect(() => {
    const firstTick = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => { window.clearTimeout(firstTick); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (sourceMode === "fixture_demo") return;
    let active = true;
    async function refresh() {
      try {
        const sources = await fetchLocalSources();
        const latest = await fetchLatestLocalSession();
        if (!active) return;
        setTermsAcknowledged(sources.termsAcknowledged);
        setSourceHealth((current) => ({ ...current, delayed_paper: sources.health }));
        if (latest && latest.sourceMode === sourceMode) setWorkerSession(latest);
      } catch { /* hosted dashboard cannot reach a private Mac worker without optional sync */ }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [sourceMode]);

  // Fixture demo auto-advance
  useEffect(() => {
    if (sourceMode !== "fixture_demo" || state.status !== "running") return;
    const timer = window.setTimeout(
      () => setState((current) => advanceReplay(current, lossLimit)),
      1300 / speed,
    );
    return () => window.clearTimeout(timer);
  }, [lossLimit, sourceMode, speed, state.status, state.index, state.position, state.pending]);

  // Browser notifications
  useEffect(() => {
    const recent = state.pending?.signal ?? state.signals.at(-1);
    if (sourceMode !== "fixture_demo" || !recent || notificationState !== "granted" || recent.action === "hold") return;
    new Notification(`FDAX Pulse: ${recent.action.toUpperCase()}`, { body: recent.reason });
  }, [notificationState, sourceMode, state.pending, state.signals]);

  // Derived values
  const activeWorkerSession = workerSession?.sourceMode === sourceMode ? workerSession : null;
  const externalBars = activeWorkerSession?.bars ?? [];
  const currentBar = sourceMode === "fixture_demo"
    ? fixtureBars[Math.max(0, state.index)]
    : externalBars.at(-1) ?? null;
  const chartBars = sourceMode === "fixture_demo" ? fixtureBars : externalBars;
  const barsForAudit = sourceMode === "fixture_demo" && state.index >= 0
    ? fixtureBars.slice(0, state.index + 1)
    : externalBars;
  const contract = sourceMode === "fixture_demo" ? DEMO_FDAX : CURRENT_CONTRACTS[contractSymbol];
  const fillModel = sourceMode === "fixture_demo" ? "demo_reference" : "realistic_paper";
  const realized = sourceMode === "fixture_demo"
    ? realizedPnl(state.fills, commission)
    : activeWorkerSession?.realizedPnlEur ?? 0;
  const openPnl = sourceMode === "fixture_demo" ? unrealizedPnl(state) : 0;
  const activeStatus = sourceMode === "fixture_demo"
    ? state.status
    : activeWorkerSession?.status ?? "created";
  const controlsUnlocked = activeStatus !== "running" && activeStatus !== "paused_for_action";
  const activeFills = sourceMode === "fixture_demo"
    ? state.fills
    : activeWorkerSession?.fills ?? [];
  const completedTrades = Math.floor(activeFills.length / 2);
  const latestSignals = useMemo(
    () => [...(sourceMode === "fixture_demo" ? state.signals : activeWorkerSession?.signals ?? [])].reverse().slice(0, 5),
    [sourceMode, state.signals, activeWorkerSession?.signals],
  );
  const orderflowPercent = currentBar ? Math.min(Math.abs(currentBar.orderflow) / 60 * 100, 100) : 0;

  function resetDemo(nextMode = decisionMode) {
    setState(createDemoState(nextMode));
  }

  function updateSource(next: SessionSourceMode) {
    if (!controlsUnlocked) return;
    setSourceMode(next);
    setWorkerFeedback("");
    resetDemo();
  }

  function updateDecision(next: DecisionMode) {
    if (!controlsUnlocked) return;
    setDecisionMode(next);
    resetDemo(next);
  }

  async function enableNotifications() {
    if (!("Notification" in window)) { setNotificationState("unavailable"); return; }
    setNotificationState(await Notification.requestPermission());
  }

  async function recordTerms() {
    setWorkerBusy(true);
    try {
      await acknowledgeOfficialTerms();
      setTermsAcknowledged(true);
      setWorkerFeedback("Official terms acknowledgement recorded locally. Upload a matching file pair to qualify.");
    } catch (error) {
      setWorkerFeedback(error instanceof Error ? error.message : "Unable to reach the local worker.");
    } finally { setWorkerBusy(false); }
  }

  async function qualifyDelayed() {
    if (!pretradeFile || !posttradeFile) {
      setWorkerFeedback("Select matching pre-trade and post-trade .json.gz files first."); return;
    }
    setWorkerBusy(true);
    try {
      const qualified = await qualifyOfficialFiles(pretradeFile, posttradeFile, maturityDate);
      setSourceHealth((current) => ({ ...current, delayed_paper: qualified.health }));
      if (qualified.preview) setWorkerSession(qualified.preview);
      setWorkerFeedback(qualified.health.message);
    } catch (error) {
      setWorkerFeedback(error instanceof Error ? error.message : "Qualification failed.");
    } finally { setWorkerBusy(false); }
  }

  async function startDelayed() {
    setWorkerBusy(true);
    try {
      const session = await startDelayedSession(maturityDate, {
        decisionMode, commissionPerSideEur: commission, slippageTicks: slippage, dailyLossLimitEur: lossLimit,
      });
      if (session) setWorkerSession(session);
      setWorkerFeedback("Delayed paper session running on the Mac worker.");
    } catch (error) {
      setWorkerFeedback(error instanceof Error ? error.message : "Unable to start delayed paper session.");
    } finally { setWorkerBusy(false); }
  }

  async function runCsvImport() {
    if (!csvFile) { setWorkerFeedback("Choose a TAQ CSV file first."); return; }
    setWorkerBusy(true);
    try {
      const session = await importCsvSession(csvFile, {
        decisionMode, commissionPerSideEur: commission, slippageTicks: slippage, dailyLossLimitEur: lossLimit,
      });
      if (session) setWorkerSession(session);
      setWorkerFeedback("Validated CSV paper session completed locally.");
    } catch (error) {
      setWorkerFeedback(error instanceof Error ? error.message : "CSV import failed.");
    } finally { setWorkerBusy(false); }
  }

  async function stopDelayed() {
    if (!workerSession) return;
    const stopped = await stopDelayedSession(workerSession.sessionId);
    if (stopped) setWorkerSession(stopped);
    setWorkerFeedback("Delayed paper session stopped and any open paper position flattened.");
  }

  async function resolveWorkerDecision(accepted: boolean) {
    const pending = activeWorkerSession?.signals.at(-1);
    if (!activeWorkerSession || !pending) return;
    const kind = accepted
      ? pending.action === "buy" ? "approve_entry" : "approve_exit"
      : "skip_signal";
    const session = await commandDelayedSession(activeWorkerSession.sessionId, kind);
    if (session) setWorkerSession(session);
  }

  const realTime = now
    ? now.toLocaleTimeString("en-GB", { timeZone: "Europe/Berlin", hour12: false }) + " CET/CEST"
    : "--";

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="hero-panel panel">
        <div>
          <p className="eyebrow">Eurex DAX Futures Family / Paper Only</p>
          <h1>FDAX Orderflow Paper Trading Console</h1>
          <p className="intro">Pecchiari orderflow strategy — runs immediately in fixture demo mode.</p>
        </div>
        <div className="warning-ribbon">
          <LockKeyhole size={16} />
          No live market data. No broker execution. Paper simulation only.
        </div>
      </section>

      {/* ── Control strip ────────────────────────────────────────────────────── */}
      <section className="control-strip panel" aria-label="Paper session controls">
        {/* Source mode tabs */}
        <SourceModeSelector selected={sourceMode} disabled={!controlsUnlocked} onSelect={updateSource} />

        {/* Decision mode toggle */}
        <div className="mode-toggle" aria-label="Paper decision mode">
          <button className={decisionMode === "automatic" ? "active" : ""} disabled={!controlsUnlocked} onClick={() => updateDecision("automatic")}>
            Automatic
          </button>
          <button className={decisionMode === "recommendation" ? "active" : ""} disabled={!controlsUnlocked} onClick={() => updateDecision("recommendation")}>
            Recommendation
          </button>
        </div>

        {/* Mode-specific primary controls */}
        {sourceMode === "fixture_demo" && (
          <label className="select-field">
            Speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </label>
        )}
        {sourceMode !== "fixture_demo" && (
          <label className="select-field">
            Contract
            <select value={contractSymbol} onChange={(e) => setContractSymbol(e.target.value as "FDAX" | "FDXM" | "FDXS")}>
              <option value="FDAX">FDAX</option>
              <option value="FDXM">Mini-DAX</option>
              <option value="FDXS">Micro-DAX</option>
            </select>
          </label>
        )}

        {/* Advanced settings collapsible */}
        <details className="advanced-settings">
          <summary><Settings2 size={14} /> Advanced</summary>
          <div className="advanced-fields">
            <label className="select-field">
              Commission / side
              <input disabled={!controlsUnlocked} min={0} step={0.25} type="number" value={commission} onChange={(e) => setCommission(Number(e.target.value))} />
            </label>
            <label className="select-field">
              Loss halt EUR
              <input disabled={!controlsUnlocked} min={25} step={25} type="number" value={lossLimit} onChange={(e) => setLossLimit(Number(e.target.value))} />
            </label>
            {sourceMode !== "fixture_demo" && (
              <label className="select-field">
                Slippage ticks
                <input disabled={!controlsUnlocked} min={0} step={1} type="number" value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} />
              </label>
            )}
          </div>
        </details>

        {/* Action buttons */}
        <div className="buttons session-actions">
          {sourceMode === "delayed_paper" && activeStatus !== "running" && (
            <button className="primary" disabled={sourceHealth.delayed_paper.sufficiency !== "verified_taq" || workerBusy} onClick={() => void startDelayed()}>
              <CirclePlay size={16} /> Start session
            </button>
          )}
          {sourceMode === "delayed_paper" && activeStatus === "running" && (
            <button className="ghost" onClick={() => void stopDelayed()}><Pause size={16} /> Stop</button>
          )}
          {sourceMode === "csv_replay" && (
            <button className="primary" disabled={!csvFile || workerBusy} onClick={() => void runCsvImport()}>
              <Upload size={16} /> Import CSV
            </button>
          )}
          {sourceMode === "fixture_demo" && (
            state.status === "completed" ? (
              <button className="ghost" onClick={() => resetDemo()}><RotateCcw size={16} /> Run again</button>
            ) : state.status === "paused_for_action" ? (
              <button className="ghost" disabled><Pause size={16} /> Decision required</button>
            ) : state.status === "running" ? (
              <button className="ghost" onClick={() => setState({ ...state, status: "stopped" })}><Pause size={16} /> Pause</button>
            ) : (
              <button className="primary" onClick={() => setState({ ...state, status: "running" })}><CirclePlay size={16} /> Resume</button>
            )
          )}
          {sourceMode === "fixture_demo" && state.status !== "completed" && (
            <button className="ghost" onClick={() => resetDemo()}><RotateCcw size={16} /> Reset</button>
          )}
          {sourceMode !== "fixture_demo" && (
            <button className="ghost" onClick={() => updateSource("fixture_demo")}>Run demo</button>
          )}
          <button className="ghost" onClick={enableNotifications}><Bell size={16} /> Alerts</button>
        </div>

        <span className={`status ${activeStatus}`}>
          {sourceMode === "delayed_paper" && sourceHealth.delayed_paper.sufficiency !== "verified_taq"
            ? "qualification required"
            : sourceMode === "csv_replay" && !workerSession
            ? "import required"
            : activeStatus.replaceAll("_", " ")}
        </span>
      </section>

      {/* ── CSV file picker ───────────────────────────────────────────────────── */}
      {sourceMode === "csv_replay" && (
        <section className="capability panel">
          <Upload size={20} />
          <div>
            <p className="eyebrow">Validated Local Import</p>
            <h2>Import TAQ CSV</h2>
            <p>Required columns: timestamp, symbol/contract, trade price, trade size, bid, and ask.</p>
            <div className="qualification-form">
              <label className="file-field">
                Local CSV file
                <input type="file" accept=".csv,text/csv" onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            {workerFeedback && <p className="worker-feedback">{workerFeedback}</p>}
          </div>
        </section>
      )}

      {/* ── Delayed paper qualification ───────────────────────────────────────── */}
      {sourceMode === "delayed_paper" && (
        <section className="capability panel" role="status">
          {sourceHealth.delayed_paper.sufficiency === "verified_taq" ? <CirclePlay size={20} /> : <LockKeyhole size={20} />}
          <div>
            <p className="eyebrow">Accurate Strategy Gate</p>
            <h2>
              {sourceHealth.delayed_paper.sufficiency === "verified_taq"
                ? "Official delayed TAQ qualified"
                : "Qualify official delayed data"}
            </h2>
            <p>{sourceHealth.delayed_paper.message}</p>
            <div className="qualification-form">
              <label className="select-field">
                FDAX maturity
                <input value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} disabled={!controlsUnlocked} />
              </label>
              {!termsAcknowledged && (
                <button className="ghost" disabled={workerBusy} onClick={() => void recordTerms()}>
                  I accepted official terms
                </button>
              )}
              <label className="file-field">
                Pre-trade `.json.gz`
                <input type="file" accept=".gz" onChange={(e) => setPretradeFile(e.target.files?.[0] ?? null)} />
              </label>
              <label className="file-field">
                Post-trade `.json.gz`
                <input type="file" accept=".gz" onChange={(e) => setPosttradeFile(e.target.files?.[0] ?? null)} />
              </label>
              <button className="ghost" disabled={!termsAcknowledged || workerBusy} onClick={() => void qualifyDelayed()}>
                Qualify selected files
              </button>
            </div>
            {workerFeedback && <p className="worker-feedback">{workerFeedback}</p>}
          </div>
        </section>
      )}

      {/* ── Manual decision prompt (fixture) ─────────────────────────────────── */}
      {sourceMode === "fixture_demo" && state.pending && (
        <section className="decision panel" aria-live="assertive">
          <div>
            <p className="eyebrow">Manual Paper Decision Required</p>
            <h2>{state.pending.signal.action.toUpperCase()} 1 demo contract</h2>
            <p>{state.pending.signal.reason} Projected {state.pending.fill.side} fill: {state.pending.fill.price.toFixed(1)}.</p>
          </div>
          <div className="buttons">
            <button className="primary" onClick={() => setState((current) => {
              const { signal: pendingSignal, fill } = current.pending!;
              const resolved = { ...pendingSignal, status: "executed" as const };
              const position = pendingSignal.action === "buy"
                ? { entryPrice: fill.price, entryTime: fill.time, quantity: 1 as const }
                : null;
              return {
                ...current,
                status: "running",
                pending: null,
                position,
                fills: [...current.fills, fill],
                signals: [...current.signals, resolved],
                activity: [`${pendingSignal.action.toUpperCase()} paper fill at ${fill.price.toFixed(1)}.`, ...current.activity],
              };
            })}>Execute paper trade</button>
            <button className="ghost" onClick={() => setState((current) => {
              const resolved = { ...current.pending!.signal, status: "skipped" as const };
              return {
                ...current,
                status: "running",
                pending: null,
                signals: [...current.signals, resolved],
                activity: [`Skipped ${current.pending!.signal.action.toUpperCase()} recommendation.`, ...current.activity],
              };
            })}><SkipForward size={16} /> Skip</button>
          </div>
        </section>
      )}

      {/* ── Manual decision prompt (worker) ──────────────────────────────────── */}
      {sourceMode !== "fixture_demo" && activeWorkerSession?.status === "paused_for_action" && activeWorkerSession.signals.at(-1) && (
        <section className="decision panel" aria-live="assertive">
          <div>
            <p className="eyebrow">Manual Paper Decision Required</p>
            <h2>{activeWorkerSession.signals.at(-1)?.action.toUpperCase()} 1 paper contract</h2>
            <p>{activeWorkerSession.signals.at(-1)?.reason}</p>
          </div>
          <div className="buttons">
            <button className="primary" onClick={() => void resolveWorkerDecision(true)}>Execute paper trade</button>
            <button className="ghost" onClick={() => void resolveWorkerDecision(false)}><SkipForward size={16} /> Skip</button>
          </div>
        </section>
      )}

      {/* ── Status grid ──────────────────────────────────────────────────────── */}
      <section className="status-grid">
        <MarketClockCard sourceMode={sourceMode} status={activeStatus} health={sourceHealth[sourceMode]} currentBar={currentBar} realTime={realTime} />
        <DataQualityCard sourceMode={sourceMode} currentBar={currentBar} health={sourceHealth[sourceMode]} issueCount={activeWorkerSession?.issues.length} />
      </section>

      {/* ── Metric tiles ─────────────────────────────────────────────────────── */}
      <section className="metric-grid">
        <article className="panel quote">
          <p className="eyebrow">Current Quote</p>
          <strong>{currentBar ? currentBar.close.toFixed(1) : "--"}</strong>
          <div className="bid-ask">
            <span>Bid {currentBar ? currentBar.bid.toFixed(1) : "--"}</span>
            <span>Ask {currentBar ? currentBar.ask.toFixed(1) : "--"}</span>
          </div>
          <small>{currentBar ? `Paper clock ${currentBar.localTime}:59 CET` : "Waiting for qualified source data"}</small>
        </article>

        <article className="panel metric">
          <p className="eyebrow">Orderflow / Trigger</p>
          <strong className={currentBar && currentBar.orderflow > 0 ? "positive" : "negative"}>
            {currentBar ? `${currentBar.orderflow > 0 ? "+" : ""}${currentBar.orderflow}` : "--"}
          </strong>
          <div className="meter"><i style={{ width: `${orderflowPercent}%` }} /></div>
          <small>Entry threshold &gt; {STRATEGY.orderflowThreshold}</small>
        </article>

        <article className="panel metric">
          <p className="eyebrow">Volume / Trigger</p>
          <strong>{currentBar ? currentBar.volume : "--"}</strong>
          <div className="meter volume">
            <i style={{ width: `${currentBar ? Math.min(currentBar.volume / 300 * 100, 100) : 0}%` }} />
          </div>
          <small>Entry threshold &gt; {STRATEGY.volumeThreshold}</small>
        </article>

        <article className="panel pnl">
          <p className="eyebrow">Paper Account P&amp;L</p>
          <strong className={realized + openPnl >= 0 ? "positive" : "negative"}>
            {currentBar || sourceMode === "fixture_demo" ? eur(realized + openPnl) : "--"}
          </strong>
          <dl>
            <div><dt>Realized</dt><dd>{currentBar || sourceMode === "fixture_demo" ? eur(realized) : "--"}</dd></div>
            <div><dt>Open</dt><dd>{sourceMode === "fixture_demo" ? eur(openPnl) : "Calculated by worker"}</dd></div>
          </dl>
        </article>
      </section>

      {/* ── Workspace: orderflow chart + equity curve ─────────────────────────── */}
      <section className="workspace">
        <article className="panel chart-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Minute Bars</p>
              <h2>Orderflow momentum</h2>
            </div>
            <span className="badge safe">OF &gt; {STRATEGY.orderflowThreshold} / VOL &gt; {STRATEGY.volumeThreshold}</span>
          </div>
          <div className="chart-area">
            <OrderflowChart
              bars={chartBars}
              signals={sourceMode === "fixture_demo" ? state.signals : activeWorkerSession?.signals ?? []}
              threshold={STRATEGY.orderflowThreshold}
              activeIndex={sourceMode === "fixture_demo" ? state.index : chartBars.length - 1}
              maskFuture={sourceMode === "fixture_demo"}
            />
          </div>
          {sourceMode === "fixture_demo" && (
            <div className="benchmarks">
              <div>
                <span>Basic one-minute exit</span>
                <strong>{eur(benchmark.basic.netPnl - commission * 2)}</strong>
              </div>
              <div className="selected">
                <span>Orderflow hold exit</span>
                <strong>{eur(benchmark.momentum.netPnl - commission * 2)}</strong>
              </div>
              <small>Toy fixture comparison only; not a current FDAX contract result or thesis sample.</small>
            </div>
          )}
        </article>

        <article className="panel chart-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Session P&amp;L</p>
              <h2>Equity curve</h2>
            </div>
            <span className="badge">{completedTrades} trade{completedTrades !== 1 ? "s" : ""}</span>
          </div>
          <div className="chart-area">
            <EquityCurve
              fills={activeFills}
              tickValueEur={contract.tickValueEur}
              tickSize={contract.minimumPriceIncrement}
            />
          </div>
        </article>

        <ExecutionConfigPanel sourceMode={sourceMode} contract={contract} fillModel={fillModel} commission={commission} slippage={sourceMode === "fixture_demo" ? 0 : slippage} />
      </section>

      {/* ── Signal audit ─────────────────────────────────────────────────────── */}
      <SignalAuditTable sourceMode={sourceMode} bars={barsForAudit} />

      {/* ── Lower grid: cloud status + trade log ─────────────────────────────── */}
      <section className="lower-grid">
        <CloudStatus />
        <article className="panel audit-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Paper Trade Log</p>
              <h2>{completedTrades} closed trade{completedTrades !== 1 ? "s" : ""}</h2>
            </div>
          </div>
          <TradeLog
            fills={activeFills}
            tickValueEur={contract.tickValueEur}
            tickSize={contract.minimumPriceIncrement}
          />
        </article>
      </section>

      {/* ── Latest signals (compact) ──────────────────────────────────────────── */}
      {latestSignals.length > 0 && (
        <article className="panel compact-signals">
          <p className="eyebrow">Latest Signals</p>
          <ul className="signal-list">
            {latestSignals.map((item) => (
              <li key={item.id}>
                <span className={`action ${item.action}`}>{item.action}</span>
                <span>{item.reason}</span>
                <small>{item.status}</small>
              </li>
            ))}
          </ul>
        </article>
      )}
    </>
  );
}
