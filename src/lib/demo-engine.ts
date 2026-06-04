import type {
  MinuteBar,
  PaperFill,
  Position,
  ReplayMode,
  ReplaySignal,
  SessionStatus,
  SignalAction,
  ContractSpec,
} from "@/lib/domain";

export const DEMO_FDAX: ContractSpec = {
  symbol: "FDAX",
  label: "FDAX thesis/demo fixture configuration",
  pointValueEur: 25,
  minimumPriceIncrement: 0.5,
  tickValueEur: 12.5,
  currency: "EUR",
  source: "demo_fixture",
};

export const CURRENT_CONTRACTS: Record<"FDAX" | "FDXM" | "FDXS", ContractSpec> = {
  FDAX: {
    symbol: "FDAX",
    label: "DAX Futures",
    pointValueEur: 25,
    minimumPriceIncrement: 1,
    tickValueEur: 25,
    currency: "EUR",
    source: "official_reference",
    verifiedAt: "2026-05-26",
  },
  FDXM: {
    symbol: "FDXM",
    label: "Mini-DAX Futures",
    pointValueEur: 5,
    minimumPriceIncrement: 1,
    tickValueEur: 5,
    currency: "EUR",
    source: "official_reference",
    verifiedAt: "2026-05-26",
  },
  FDXS: {
    symbol: "FDXS",
    label: "Micro-DAX Futures",
    pointValueEur: 1,
    minimumPriceIncrement: 1,
    tickValueEur: 1,
    currency: "EUR",
    source: "official_reference",
    verifiedAt: "2026-05-26",
  },
};

export const STRATEGY = {
  orderflowThreshold: 24,
  volumeThreshold: 242,
  dailyLossLimitEur: 250,
} as const;

export const fixtureBars: MinuteBar[] = [
  {
    id: "09:00",
    localTime: "09:00",
    close: 18000,
    bid: 17999.5,
    ask: 18000,
    orderflow: 243,
    volume: 243,
    buyVolume: 243,
    sellVolume: 0,
    unclassifiedVolume: 0,
    nextAsk: 18000.5,
  },
  {
    id: "09:01",
    localTime: "09:01",
    close: 18001,
    bid: 18000.5,
    ask: 18001,
    orderflow: 40,
    volume: 40,
    buyVolume: 40,
    sellVolume: 0,
    unclassifiedVolume: 0,
  },
  {
    id: "09:02",
    localTime: "09:02",
    close: 18001,
    bid: 18001,
    ask: 18001.5,
    orderflow: -4,
    volume: 20,
    buyVolume: 8,
    sellVolume: 12,
    unclassifiedVolume: 0,
    nextBid: 18001,
  },
  {
    id: "09:03",
    localTime: "09:03",
    close: 18001,
    bid: 18001,
    ask: 18001.5,
    orderflow: -10,
    volume: 10,
    buyVolume: 0,
    sellVolume: 10,
    unclassifiedVolume: 0,
  },
  {
    id: "09:04",
    localTime: "09:04",
    close: 18001.5,
    bid: 18001,
    ask: 18001.5,
    orderflow: 260,
    volume: 260,
    buyVolume: 260,
    sellVolume: 0,
    unclassifiedVolume: 0,
    nextAsk: 18002,
  },
  {
    id: "09:05",
    localTime: "09:05",
    close: 18001.5,
    bid: 18001.5,
    ask: 18002,
    orderflow: -18,
    volume: 42,
    buyVolume: 12,
    sellVolume: 30,
    unclassifiedVolume: 0,
    nextBid: 18001,
  },
  {
    id: "09:06",
    localTime: "09:06",
    close: 18001,
    bid: 18001,
    ask: 18001.5,
    orderflow: -10,
    volume: 10,
    buyVolume: 0,
    sellVolume: 10,
    unclassifiedVolume: 0,
  },
  {
    id: "09:07",
    localTime: "09:07",
    close: 18000,
    bid: 17999.5,
    ask: 18000,
    orderflow: 255,
    volume: 255,
    buyVolume: 255,
    sellVolume: 0,
    unclassifiedVolume: 0,
    nextAsk: 18000.5,
  },
  {
    id: "09:08",
    localTime: "09:08",
    close: 18001,
    bid: 18000.5,
    ask: 18001,
    orderflow: 40,
    volume: 40,
    buyVolume: 40,
    sellVolume: 0,
    unclassifiedVolume: 0,
  },
  {
    id: "09:09",
    localTime: "09:09",
    close: 18001,
    bid: 18001,
    ask: 18001.5,
    orderflow: -6,
    volume: 26,
    buyVolume: 10,
    sellVolume: 16,
    unclassifiedVolume: 0,
    nextBid: 18002,
  },
  {
    id: "09:10",
    localTime: "09:10",
    close: 18002,
    bid: 18002,
    ask: 18002.5,
    orderflow: -10,
    volume: 10,
    buyVolume: 0,
    sellVolume: 10,
    unclassifiedVolume: 0,
  },
];

export interface PendingDecision {
  signal: ReplaySignal;
  fill: PaperFill;
}

export interface DemoReplayState {
  mode: ReplayMode;
  status: SessionStatus;
  index: number;
  signals: ReplaySignal[];
  fills: PaperFill[];
  position: Position | null;
  pending: PendingDecision | null;
  activity: string[];
}

export function createDemoState(mode: ReplayMode): DemoReplayState {
  return {
    mode,
    status: "running",
    index: -1,
    signals: [],
    fills: [],
    position: null,
    pending: null,
    activity: ["Bundled TAQ fixture ready. No market-data license required."],
  };
}

function signal(
  bar: MinuteBar,
  action: SignalAction,
  reason: string,
): ReplaySignal {
  return {
    id: `${bar.id}-${action}`,
    time: `${bar.localTime}:59`,
    action,
    reason,
    orderflow: bar.orderflow,
    volume: bar.volume,
    status: "generated",
  };
}

function withStatus(item: ReplaySignal, status: ReplaySignal["status"]) {
  return { ...item, status };
}

function nextMinute(localTime: string) {
  const [hour, minute] = localTime.split(":").map(Number);
  const total = hour * 60 + minute + 1;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
}

export function executeDecision(
  state: DemoReplayState,
  accepted: boolean,
): DemoReplayState {
  if (!state.pending) return state;
  const { signal: pendingSignal, fill } = state.pending;
  const resolved = withStatus(pendingSignal, accepted ? "executed" : "skipped");
  if (!accepted) {
    return {
      ...state,
      status: "running",
      pending: null,
      signals: [...state.signals, resolved],
      activity: [`Skipped ${pendingSignal.action.toUpperCase()} recommendation.`, ...state.activity],
    };
  }
  const position =
    pendingSignal.action === "buy"
      ? { entryPrice: fill.price, entryTime: fill.time, quantity: 1 as const }
      : null;
  return {
    ...state,
    status: "running",
    pending: null,
    position,
    fills: [...state.fills, fill],
    signals: [...state.signals, resolved],
    activity: [
      `${pendingSignal.action.toUpperCase()} paper fill at ${fill.price.toFixed(1)}.`,
      ...state.activity,
    ],
  };
}

export function advanceReplay(
  state: DemoReplayState,
  dailyLossLimitEur: number = STRATEGY.dailyLossLimitEur,
): DemoReplayState {
  if (state.pending || state.status === "completed") return state;
  const index = state.index + 1;
  const bar = fixtureBars[index];
  if (!bar) {
    return { ...state, status: "completed", activity: ["Replay complete.", ...state.activity] };
  }
  let next: DemoReplayState = { ...state, index, status: "running" };

  if (state.position && unrealizedPnl(next) <= -dailyLossLimitEur) {
    const halt = signal(bar, "risk_halt", `Daily paper-loss cutoff reached at - EUR ${dailyLossLimitEur.toFixed(2)}.`);
    const fill: PaperFill = {
      id: `${bar.id}-risk-fill`,
      time: `${bar.localTime}:59`,
      side: "sell",
      price: bar.nextBid ?? bar.bid,
      reason: "Forced flatten at executable bid.",
    };
    return executeDecision({ ...next, pending: { signal: halt, fill } }, true);
  } else if (!state.position && bar.orderflow > STRATEGY.orderflowThreshold && bar.volume > STRATEGY.volumeThreshold) {
    const buy = signal(
      bar,
      "buy",
      `OF ${bar.orderflow} > ${STRATEGY.orderflowThreshold} and volume ${bar.volume} > ${STRATEGY.volumeThreshold}.`,
    );
    const fill: PaperFill = {
      id: `${bar.id}-buy-fill`,
      time: nextMinute(bar.localTime),
      side: "buy",
      price: bar.nextAsk ?? bar.ask,
      reason: "First executable ask in next interval.",
    };
    next = { ...next, pending: { signal: buy, fill } };
  } else if (state.position && bar.orderflow <= 0) {
    const sell = signal(bar, "sell", "One-minute orderflow is no longer positive.");
    const fill: PaperFill = {
      id: `${bar.id}-sell-fill`,
      time: nextMinute(bar.localTime),
      side: "sell",
      price: bar.nextBid ?? bar.bid,
      reason: "First executable bid after exit signal.",
    };
    next = { ...next, pending: { signal: sell, fill } };
  } else if (state.position && bar.orderflow > 0) {
    const hold = withStatus(signal(bar, "hold", "Positive buying momentum remains active."), "executed");
    next = {
      ...next,
      signals: [...next.signals, hold],
      activity: [`HOLD at ${bar.localTime}; orderflow remains positive.`, ...next.activity],
    };
  }

  if (next.pending) {
    if (state.mode === "automatic") {
      return executeDecision(next, true);
    }
    return {
      ...next,
      status: "paused_for_action",
      activity: [`Recommendation awaiting approval: ${next.pending.signal.action.toUpperCase()}.`, ...next.activity],
    };
  }
  return next;
}

export function realizedPnl(fills: PaperFill[], commissionPerSideEur = 0): number {
  let result = 0;
  for (let index = 0; index + 1 < fills.length; index += 2) {
    const entry = fills[index];
    const exit = fills[index + 1];
    result += ((exit.price - entry.price) / DEMO_FDAX.minimumPriceIncrement) * DEMO_FDAX.tickValueEur - commissionPerSideEur * 2;
  }
  return result;
}

export function unrealizedPnl(state: DemoReplayState): number {
  const bar = fixtureBars[Math.max(0, state.index)];
  if (!state.position || !bar) return 0;
  return ((bar.bid - state.position.entryPrice) / DEMO_FDAX.minimumPriceIncrement) * DEMO_FDAX.tickValueEur;
}

export const benchmark = {
  basic: { netPnl: -25, tradeCount: 3, label: "One-minute exit" },
  momentum: { netPnl: 25, tradeCount: 3, label: "Orderflow hold exit" },
};
