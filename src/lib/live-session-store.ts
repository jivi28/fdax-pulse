import type {
  ClosedTrade,
  DecisionMode,
  LiveThresholds,
  PaperFill,
} from "@/lib/domain";
import type { OpenPosition } from "@/lib/live-engine";
import { archiveDay } from "@/lib/live-session-history";

/**
 * Browser-only persistence for live crypto paper sessions. Keyed per
 * instrument so switching symbols doesn't clobber another symbol's day.
 * Two tabs on the same instrument share one key (last poll write wins) —
 * acceptable for a single-user local tool, not reconciled across tabs.
 */

const STORE_VERSION = 1;
const KEY_PREFIX = "live-session:";

export interface PersistedLiveSession {
  version: number;
  dateKey: string;
  symbol: string;
  decisionMode: DecisionMode;
  realizedPnl: number;
  fills: PaperFill[];
  trades: ClosedTrade[];
  position: OpenPosition | null;
  thresholds: LiveThresholds;
  updatedAt: number;
}

export function todayKey(): string {
  return new Date().toLocaleDateString("en-CA");
}

function keyFor(symbol: string): string {
  return `${KEY_PREFIX}${symbol}`;
}

function readKey(key: string): PersistedLiveSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedLiveSession;
    if (parsed.version !== STORE_VERSION || parsed.dateKey !== todayKey()) {
      if (parsed.version === STORE_VERSION) {
        archiveDay({
          dateKey: parsed.dateKey,
          symbol: parsed.symbol,
          realizedPnl: parsed.realizedPnl,
          trades: parsed.trades,
        });
      }
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage disabled (private browsing, quota) — degrade to no-op */
    }
    return null;
  }
}

export function loadLiveSession(symbol: string): PersistedLiveSession | null {
  return readKey(keyFor(symbol));
}

export function saveLiveSession(
  symbol: string,
  state: Pick<PersistedLiveSession, "decisionMode" | "realizedPnl" | "fills" | "trades" | "position" | "thresholds">,
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedLiveSession = {
      version: STORE_VERSION,
      dateKey: todayKey(),
      symbol,
      updatedAt: Date.now(),
      ...state,
    };
    window.localStorage.setItem(keyFor(symbol), JSON.stringify(payload));
  } catch {
    /* storage disabled or quota exceeded — drop the write silently */
  }
}

export function clearLiveSession(symbol: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(symbol));
  } catch {
    /* no-op */
  }
}

