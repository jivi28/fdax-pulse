export type DecisionMode = "automatic" | "recommendation";
export type ReplayMode = DecisionMode;
export type SessionSourceMode = "delayed_paper" | "csv_replay" | "fixture_demo" | "live_crypto";
export type FillModel = "demo_reference" | "realistic_paper";
export type DataSufficiency =
  | "terms_required"
  | "checking"
  | "verified_taq"
  | "insufficient_taq"
  | "fetch_error"
  | "paused_quality_error"
  | "unavailable";
export type SessionStatus =
  | "created"
  | "running"
  | "paused_for_action"
  | "stopped"
  | "completed"
  | "failed";
export type SignalAction = "buy" | "hold" | "sell" | "no_action" | "risk_halt";
export type DataSource =
  | "csv_iqfeed"
  | "csv_databento"
  | "fixture"
  | "delayed_deutsche_boerse_unverified"
  | "delayed_deutsche_boerse"
  | "live_databento_disabled";

export interface ContractSpec {
  symbol: "FDAX" | "FDXM" | "FDXS" | "CUSTOM";
  label: string;
  pointValueEur: number;
  minimumPriceIncrement: number;
  tickValueEur: number;
  currency: "EUR";
  source: "official_reference" | "demo_fixture" | "custom";
  verifiedAt?: string;
}

export interface PaperExecutionConfig {
  fillModel: FillModel;
  contract: ContractSpec;
  commissionPerSideEur: number;
  slippageTicks: number;
  dailyLossLimitEur: number;
}

export interface SourceHealth {
  sourceName: string;
  sourceMode?: SessionSourceMode;
  delayMinutes: number | null;
  sufficiency: DataSufficiency;
  latestExchangeTimestamp?: string;
  latestReceivedTimestamp?: string;
  selectedContract?: ContractSelection;
  rowsReceived?: number;
  rowsAccepted?: number;
  rowsQuarantined?: number;
  message: string;
}

export interface ContractSelection {
  productIsin: string;
  maturityDate: string;
  symbol: "FDAX" | "FDXM" | "FDXS" | "CUSTOM";
  pointValueEur: number;
  minimumPriceIncrement: number;
  tickValueEur: number;
}

export interface MinuteBar {
  id: string;
  localTime: string;
  close: number;
  bid: number;
  ask: number;
  orderflow: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  unclassifiedVolume: number;
  nextBid?: number;
  nextAsk?: number;
}

export interface ReplaySignal {
  id: string;
  time: string;
  action: SignalAction;
  reason: string;
  orderflow: number;
  volume: number;
  status: "generated" | "executed" | "skipped" | "blocked";
}

export interface PaperFill {
  id: string;
  time: string;
  side: "buy" | "sell";
  price: number;
  reason: string;
}

export interface Position {
  entryPrice: number;
  entryTime: string;
  quantity: 1;
}

export interface WorkerSession {
  sessionId: string;
  status: SessionStatus;
  sourceMode: SessionSourceMode;
  source: string;
  bars: MinuteBar[];
  signals: ReplaySignal[];
  fills: PaperFill[];
  realizedPnlEur: number;
  grossPnlEur: number;
  issues: Array<{ code: string; message: string }>;
}

// ---- Live crypto-futures paper trading ----
// Real, free, browser-reachable futures TAQ feed. The Pecchiari method is
// asset-agnostic, so the same Lee-Ready + 85th-percentile pipeline applies.

export type ExchangeId = "binance" | "bybit";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "fallback"
  | "unreachable";

export interface LiveInstrument {
  /** Exchange streaming symbol, e.g. "BTCUSDT". */
  symbol: string;
  label: string;
  /** Minimum price increment used for tick math. */
  tickSize: number;
  /** Position size in base units (e.g. 0.01 BTC). */
  positionSize: number;
  quoteCurrency: "USDT";
}

export const LIVE_INSTRUMENTS: Record<string, LiveInstrument> = {
  BTCUSDT: { symbol: "BTCUSDT", label: "BTC Perpetual", tickSize: 0.1, positionSize: 0.01, quoteCurrency: "USDT" },
  ETHUSDT: { symbol: "ETHUSDT", label: "ETH Perpetual", tickSize: 0.01, positionSize: 0.1, quoteCurrency: "USDT" },
  SOLUSDT: { symbol: "SOLUSDT", label: "SOL Perpetual", tickSize: 0.01, positionSize: 1, quoteCurrency: "USDT" },
};

/** A normalized trade-and-quote tick produced by any exchange adapter. */
export interface LiveTick {
  /** Epoch milliseconds of the trade. */
  time: number;
  price: number;
  size: number;
  bid: number;
  ask: number;
  /** Aggressor side reported by the venue, used only as a Lee-Ready tie-break. */
  aggressor: "buy" | "sell" | null;
}

export interface LiveThresholds {
  orderflow: number;
  volume: number;
  /** Bars observed so far; calibration needs a minimum sample. */
  sample: number;
  calibrated: boolean;
}

export interface ClosedTrade {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  ticks: number;
  pnl: number;
  reason: string;
}
