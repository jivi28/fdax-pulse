import type {
  ClosedTrade,
  DecisionMode,
  LiveInstrument,
  LiveThresholds,
  LiveTick,
  MinuteBar,
  PaperFill,
  ReplaySignal,
  SessionStatus,
  SignalAction,
} from "@/lib/domain";

/**
 * Streaming orderflow paper-trading engine, mirroring
 * `worker/fdax_pulse/engine.py` for a live tick feed.
 *
 * Per tick: Lee-Ready classification (trade price vs midpoint, aggressor side
 * as tie-break). Per completed minute: aggregate orderflow/volume, recalibrate
 * entry thresholds to the live 85th percentile (faithful to the thesis, p.64),
 * then apply the long-only momentum-hold strategy (enter when orderflow and
 * volume both exceed their thresholds, hold while orderflow stays positive).
 */

export const CALIBRATION_MIN_BARS = 20;
const PERCENTILE = 0.85;

export interface LiveEngineConfig {
  instrument: LiveInstrument;
  decisionMode: DecisionMode;
  dailyLossLimitUsd: number;
}

export interface PendingDecision {
  signal: ReplaySignal;
  fill: PaperFill;
}

interface OpenPosition {
  entryPrice: number;
  entryTime: string;
}

export interface LiveSnapshot {
  status: SessionStatus;
  bars: MinuteBar[];
  signals: ReplaySignal[];
  fills: PaperFill[];
  trades: ClosedTrade[];
  thresholds: LiveThresholds;
  realizedPnl: number;
  openPnl: number;
  position: OpenPosition | null;
  pending: PendingDecision | null;
  lastBid: number | null;
  lastAsk: number | null;
  lastPrice: number | null;
}

/** Linear-interpolation percentile over an unsorted numeric sample. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = p * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function minuteLabel(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

interface MinuteAccumulator {
  startMs: number;
  orderflow: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  unclassifiedVolume: number;
  close: number;
  bid: number;
  ask: number;
}

export class LiveEngine {
  private config: LiveEngineConfig;
  private status: SessionStatus = "running";
  private bars: MinuteBar[] = [];
  private signals: ReplaySignal[] = [];
  private fills: PaperFill[] = [];
  private trades: ClosedTrade[] = [];
  private thresholds: LiveThresholds = { orderflow: 0, volume: 0, sample: 0, calibrated: false };
  private realizedPnl = 0;
  private position: OpenPosition | null = null;
  private pending: PendingDecision | null = null;

  private acc: MinuteAccumulator | null = null;
  private prevTradePrice: number | null = null;
  private lastTickDirection: number | null = null;
  private lastBid: number | null = null;
  private lastAsk: number | null = null;
  private lastPrice: number | null = null;
  private seq = 0;

  constructor(config: LiveEngineConfig) {
    this.config = config;
  }

  setDecisionMode(mode: DecisionMode) {
    this.config = { ...this.config, decisionMode: mode };
  }

  /** Classify a single trade against the current quote (Lee-Ready). */
  private classify(price: number, bid: number, ask: number, aggressor: LiveTick["aggressor"]): number | null {
    const midpoint = (bid + ask) / 2;
    if (price > midpoint) return 1;
    if (price < midpoint) return -1;
    if (this.prevTradePrice !== null && price > this.prevTradePrice) return 1;
    if (this.prevTradePrice !== null && price < this.prevTradePrice) return -1;
    if (this.lastTickDirection !== null) return this.lastTickDirection;
    if (aggressor === "buy") return 1;
    if (aggressor === "sell") return -1;
    return null;
  }

  ingest(tick: LiveTick): void {
    if (this.status !== "running" && this.status !== "paused_for_action") return;
    this.lastBid = tick.bid;
    this.lastAsk = tick.ask;
    this.lastPrice = tick.price;

    const minuteStart = Math.floor(tick.time / 60_000) * 60_000;
    if (this.acc && minuteStart > this.acc.startMs) {
      this.finalizeMinute();
    }
    if (!this.acc) {
      this.acc = {
        startMs: minuteStart,
        orderflow: 0,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        unclassifiedVolume: 0,
        close: tick.price,
        bid: tick.bid,
        ask: tick.ask,
      };
    }

    const sign = this.classify(tick.price, tick.bid, tick.ask, tick.aggressor);
    this.acc.volume += tick.size;
    if (sign === null) {
      this.acc.unclassifiedVolume += tick.size;
    } else {
      this.acc.orderflow += sign * tick.size;
      if (sign > 0) this.acc.buyVolume += tick.size;
      else this.acc.sellVolume += tick.size;
    }
    if (this.prevTradePrice !== null) {
      if (tick.price > this.prevTradePrice) this.lastTickDirection = 1;
      else if (tick.price < this.prevTradePrice) this.lastTickDirection = -1;
    }
    this.prevTradePrice = tick.price;
    this.acc.close = tick.price;
    this.acc.bid = tick.bid;
    this.acc.ask = tick.ask;
  }

  private finalizeMinute(): void {
    if (!this.acc) return;
    const acc = this.acc;
    const bar: MinuteBar = {
      id: `${acc.startMs}`,
      localTime: minuteLabel(acc.startMs),
      close: acc.close,
      bid: acc.bid,
      ask: acc.ask,
      orderflow: Math.round(acc.orderflow * 1_000) / 1_000,
      volume: Math.round(acc.volume * 1_000) / 1_000,
      buyVolume: Math.round(acc.buyVolume * 1_000) / 1_000,
      sellVolume: Math.round(acc.sellVolume * 1_000) / 1_000,
      unclassifiedVolume: Math.round(acc.unclassifiedVolume * 1_000) / 1_000,
    };
    this.bars.push(bar);
    this.acc = null;
    this.recalibrate();
    this.applyStrategy(bar);
  }

  private recalibrate(): void {
    const sample = this.bars.length;
    if (sample < CALIBRATION_MIN_BARS) {
      this.thresholds = { orderflow: 0, volume: 0, sample, calibrated: false };
      return;
    }
    const orderflows = this.bars.map((bar) => bar.orderflow);
    const volumes = this.bars.map((bar) => bar.volume);
    this.thresholds = {
      orderflow: Math.round(percentile(orderflows, PERCENTILE) * 100) / 100,
      volume: Math.round(percentile(volumes, PERCENTILE) * 100) / 100,
      sample,
      calibrated: true,
    };
  }

  private signal(action: SignalAction, bar: MinuteBar, reason: string, status: ReplaySignal["status"]): ReplaySignal {
    return {
      id: `${bar.id}-${action}-${this.seq++}`,
      time: bar.localTime,
      action,
      reason,
      orderflow: bar.orderflow,
      volume: bar.volume,
      status,
    };
  }

  private applyStrategy(bar: MinuteBar): void {
    const { instrument, decisionMode, dailyLossLimitUsd } = this.config;

    if (this.position) {
      const marked = (bar.bid - this.position.entryPrice) * instrument.positionSize;
      if (this.realizedPnl + marked <= -dailyLossLimitUsd) {
        this.executeExit(bar, "Daily paper-loss cutoff reached.", "risk_halt");
        return;
      }
      if (bar.orderflow > 0) {
        this.signals.push(this.signal("hold", bar, "Positive orderflow momentum remains active.", "executed"));
        return;
      }
      // Exit signal: orderflow no longer positive.
      const reason = "Orderflow is no longer positive.";
      if (decisionMode === "recommendation") {
        this.pending = {
          signal: this.signal("sell", bar, reason, "generated"),
          fill: this.makeFill("sell", bar, reason),
        };
        this.status = "paused_for_action";
      } else {
        this.executeExit(bar, reason, "sell");
      }
      return;
    }

    if (!this.thresholds.calibrated) return;
    if (bar.orderflow > this.thresholds.orderflow && bar.volume > this.thresholds.volume) {
      const reason = `Orderflow ${bar.orderflow} > ${this.thresholds.orderflow} and volume ${bar.volume} > ${this.thresholds.volume}.`;
      if (decisionMode === "recommendation") {
        this.pending = {
          signal: this.signal("buy", bar, reason, "generated"),
          fill: this.makeFill("buy", bar, reason),
        };
        this.status = "paused_for_action";
      } else {
        this.executeEntry(bar, reason);
      }
    }
  }

  private makeFill(side: "buy" | "sell", bar: MinuteBar, reason: string): PaperFill {
    return {
      id: `${bar.id}-${side}-fill-${this.seq++}`,
      time: bar.localTime,
      side,
      price: side === "buy" ? (this.lastAsk ?? bar.ask) : (this.lastBid ?? bar.bid),
      reason,
    };
  }

  private executeEntry(bar: MinuteBar, reason: string): void {
    const fill = this.makeFill("buy", bar, reason);
    this.fills.push(fill);
    this.signals.push(this.signal("buy", bar, reason, "executed"));
    this.position = { entryPrice: fill.price, entryTime: fill.time };
  }

  private executeExit(bar: MinuteBar, reason: string, action: SignalAction): void {
    if (!this.position) return;
    const fill = this.makeFill("sell", bar, reason);
    this.fills.push(fill);
    this.signals.push(this.signal(action, bar, reason, "executed"));
    const { instrument } = this.config;
    const ticks = (fill.price - this.position.entryPrice) / instrument.tickSize;
    const pnl = (fill.price - this.position.entryPrice) * instrument.positionSize;
    this.trades.push({
      entryTime: this.position.entryTime,
      exitTime: fill.time,
      entryPrice: this.position.entryPrice,
      exitPrice: fill.price,
      ticks: Math.round(ticks * 100) / 100,
      pnl,
      reason,
    });
    this.realizedPnl += pnl;
    this.position = null;
  }

  /** Resolve a pending manual decision. */
  resolve(accepted: boolean): void {
    if (!this.pending) return;
    const { signal } = this.pending;
    const bar = this.bars[this.bars.length - 1];
    this.pending = null;
    this.status = "running";
    if (!accepted) {
      this.signals.push({ ...signal, status: "skipped" });
      return;
    }
    if (signal.action === "buy") {
      this.executeEntry(bar, signal.reason);
    } else {
      this.executeExit(bar, signal.reason, signal.action);
    }
  }

  snapshot(): LiveSnapshot {
    const openPnl =
      this.position && this.lastBid !== null
        ? (this.lastBid - this.position.entryPrice) * this.config.instrument.positionSize
        : 0;
    return {
      status: this.status,
      bars: this.bars,
      signals: this.signals,
      fills: this.fills,
      trades: this.trades,
      thresholds: this.thresholds,
      realizedPnl: this.realizedPnl,
      openPnl,
      position: this.position,
      pending: this.pending,
      lastBid: this.lastBid,
      lastAsk: this.lastAsk,
      lastPrice: this.lastPrice,
    };
  }
}
