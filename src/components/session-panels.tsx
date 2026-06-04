import type {
  ContractSpec,
  DataSufficiency,
  FillModel,
  MinuteBar,
  SessionSourceMode,
  SessionStatus,
  SourceHealth,
} from "@/lib/domain";
import { STRATEGY } from "@/lib/demo-engine";

const SOURCE_LABELS: Record<SessionSourceMode, string> = {
  delayed_paper: "Delayed Paper",
  csv_replay: "CSV Replay",
  fixture_demo: "Fixture Demo",
  // live_crypto has its own dedicated home console; hidden from the advanced selector.
  live_crypto: "Live",
};

// Modes shown in the advanced worker console (live_crypto is excluded).
const ADVANCED_MODES: SessionSourceMode[] = ["delayed_paper", "csv_replay", "fixture_demo"];

export function SourceModeSelector({
  selected,
  disabled,
  onSelect,
}: {
  selected: SessionSourceMode;
  disabled: boolean;
  onSelect: (mode: SessionSourceMode) => void;
}) {
  return (
    <div className="source-toggle" aria-label="Session data source">
      {ADVANCED_MODES.map((mode) => (
        <button
          className={selected === mode ? "active" : ""}
          disabled={disabled}
          key={mode}
          onClick={() => onSelect(mode)}
        >
          {SOURCE_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}

export function MarketClockCard({
  sourceMode,
  status,
  health,
  currentBar,
  realTime,
}: {
  sourceMode: SessionSourceMode;
  status: SessionStatus;
  health: SourceHealth;
  currentBar: MinuteBar | null;
  realTime: string;
}) {
  const paperClock =
    currentBar ? `${currentBar.localTime}:59 CET/CEST` : health.latestExchangeTimestamp
      ? new Date(health.latestExchangeTimestamp).toLocaleTimeString("en-GB", { timeZone: "Europe/Berlin" })
      : "--";
  const stateLabel =
    sourceMode === "delayed_paper" && health.sufficiency !== "verified_taq"
      ? "Waiting for qualification"
      : status.replaceAll("_", " ");
  return (
    <article className="panel clock-card">
      <div className="section-heading">
        <div><p className="eyebrow">Market Clock</p><h2>{stateLabel}</h2></div>
        <SufficiencyBadge sufficiency={health.sufficiency} />
      </div>
      <dl className="clock-grid">
        <div><dt>Real time</dt><dd>{realTime}</dd></div>
        <div><dt>Paper clock</dt><dd>{paperClock}</dd></div>
        <div><dt>Delay</dt><dd>{health.delayMinutes === null ? "N/A" : `${health.delayMinutes} min`}</dd></div>
        <div><dt>Source</dt><dd>{health.sourceName}</dd></div>
      </dl>
      <p className="muted compact">{health.message}</p>
    </article>
  );
}

function SufficiencyBadge({ sufficiency }: { sufficiency: DataSufficiency }) {
  const label = {
    terms_required: "Terms required",
    checking: "Qualification pending",
    verified_taq: "TAQ sufficient",
    insufficient_taq: "TAQ insufficient",
    fetch_error: "Fetch error",
    paused_quality_error: "Quality paused",
    unavailable: "Unavailable",
  }[sufficiency];
  return <span className={`badge ${sufficiency === "verified_taq" ? "safe" : "warn"}`}>{label}</span>;
}

export function DataQualityCard({
  sourceMode,
  currentBar,
  health,
  issueCount = 0,
}: {
  sourceMode: SessionSourceMode;
  currentBar: MinuteBar | null;
  health?: SourceHealth;
  issueCount?: number;
}) {
  const isFixture = sourceMode === "fixture_demo";
  const qualified = health?.sufficiency === "verified_taq";
  const rowsReceived = isFixture ? 19 : health?.rowsReceived;
  const rowsAccepted = isFixture ? 19 : health?.rowsAccepted;
  const quarantined = isFixture ? 0 : health?.rowsQuarantined ?? issueCount;
  return (
    <article className="panel quality-card">
      <div className="section-heading">
        <div><p className="eyebrow">Data Quality</p><h2>{isFixture ? "Fixture complete" : qualified ? "Official TAQ qualified" : "Awaiting worker data"}</h2></div>
        <span className={`badge ${isFixture || qualified ? "safe" : "warn"}`}>{isFixture ? "Toy data" : qualified ? "Validated" : "Pending"}</span>
      </div>
      <div className="quality-metrics">
        <div><span>Rows received</span><strong>{rowsReceived ?? "--"}</strong></div>
        <div><span>Accepted</span><strong>{rowsAccepted ?? "--"}</strong></div>
        <div><span>Quarantined</span><strong>{quarantined ?? "--"}</strong></div>
        <div><span>Latest bid / ask</span><strong>{currentBar ? `${currentBar.bid.toFixed(1)} / ${currentBar.ask.toFixed(1)}` : "--"}</strong></div>
      </div>
      <p className="muted compact">
        {isFixture
          ? "No exclusions in the deterministic fixture."
          : health?.message ?? "The worker reports missing quotes, crossed markets, symbol mismatches, stale fills, and unresolved midpoint ties."}
      </p>
    </article>
  );
}

export function SignalAuditTable({
  sourceMode,
  bars,
}: {
  sourceMode: SessionSourceMode;
  bars: MinuteBar[];
}) {
  return (
    <article className="panel audit-table-card">
      <div className="section-heading">
        <div><p className="eyebrow">Signal Audit</p><h2>Completed minute decisions</h2></div>
        <span className="badge">OF &gt; {STRATEGY.orderflowThreshold} / VOL &gt; {STRATEGY.volumeThreshold}</span>
      </div>
      {bars.length === 0 ? (
        <p className="muted empty-panel">
          {sourceMode === "delayed_paper"
            ? "No delayed bars can be calculated until an official source passes TAQ qualification."
            : "Import validated TAQ rows from the local worker to populate minute decisions."}
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Minute</th><th>Buy</th><th>Sell</th><th>Unclassified</th><th>Net OF</th><th>Volume</th><th>Thresholds</th><th>Action</th></tr>
            </thead>
            <tbody>
              {bars.map((bar) => {
                const qualifies = bar.orderflow > STRATEGY.orderflowThreshold && bar.volume > STRATEGY.volumeThreshold;
                const action = qualifies ? "ENTER LONG" : bar.orderflow > 0 ? "HOLD / WATCH" : "EXIT / FLAT";
                return (
                  <tr key={bar.id}>
                    <td className="mono">{bar.localTime}</td>
                    <td>{bar.buyVolume}</td>
                    <td>{bar.sellVolume}</td>
                    <td>{bar.unclassifiedVolume}</td>
                    <td className={bar.orderflow > 0 ? "positive" : "negative"}>{bar.orderflow > 0 ? "+" : ""}{bar.orderflow}</td>
                    <td>{bar.volume}</td>
                    <td>{qualifies ? "PASS" : "NO ENTRY"}</td>
                    <td><span className={`action ${qualifies ? "buy" : bar.orderflow <= 0 ? "sell" : "hold"}`}>{action}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

export function ExecutionConfigPanel({
  sourceMode,
  contract,
  fillModel,
  commission,
  slippage,
}: {
  sourceMode: SessionSourceMode;
  contract: ContractSpec;
  fillModel: FillModel;
  commission: number;
  slippage: number;
}) {
  return (
    <article className="panel execution-card">
      <div className="section-heading">
        <div><p className="eyebrow">Paper Execution</p><h2>{contract.label}</h2></div>
        <span className={`badge ${sourceMode === "fixture_demo" ? "warn" : "safe"}`}>
          {sourceMode === "fixture_demo" ? "Demo configuration" : "Official reference"}
        </span>
      </div>
      <dl className="execution-grid">
        <div><dt>Contract</dt><dd>{contract.symbol}</dd></div>
        <div><dt>Min increment</dt><dd>{contract.minimumPriceIncrement.toFixed(1)}</dd></div>
        <div><dt>Tick value</dt><dd>EUR {contract.tickValueEur.toFixed(2)}</dd></div>
        <div><dt>Fill model</dt><dd>{fillModel === "demo_reference" ? "Demo / reference" : "Bid / ask realistic"}</dd></div>
        <div><dt>Commission</dt><dd>EUR {commission.toFixed(2)} / side</dd></div>
        <div><dt>Slippage</dt><dd>{slippage} ticks</dd></div>
      </dl>
      {sourceMode === "fixture_demo" && (
        <p className="notice compact">Fixture tick math is preserved for demonstration only and is not a current FDAX contract specification.</p>
      )}
    </article>
  );
}
