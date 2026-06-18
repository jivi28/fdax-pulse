import type { ClosedTrade } from "@/lib/domain";

/**
 * Archive of past live-crypto sessions, one entry per (day, instrument).
 * Populated by live-session-store.ts when it discards a stale (previous-day)
 * session — this is the "how much would I have made in the past" record.
 */

const HISTORY_KEY = "live-session-history";
const HISTORY_VERSION = 1;
const MAX_DAYS = 90;

export interface ArchivedDay {
  dateKey: string;
  symbol: string;
  realizedPnl: number;
  trades: ClosedTrade[];
  archivedAt: number;
}

interface HistoryFile {
  version: number;
  days: ArchivedDay[];
}

function readHistory(): ArchivedDay[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryFile;
    if (parsed.version !== HISTORY_VERSION || !Array.isArray(parsed.days)) return [];
    return parsed.days;
  } catch {
    return [];
  }
}

function writeHistory(days: ArchivedDay[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = days.slice(-MAX_DAYS);
    const payload: HistoryFile = { version: HISTORY_VERSION, days: trimmed };
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(payload));
  } catch {
    /* storage disabled or quota exceeded — drop the write silently */
  }
}

/** Upserts by (dateKey, symbol). Skips days with no trades and no P&L. */
export function archiveDay(entry: Omit<ArchivedDay, "archivedAt">): void {
  if (entry.trades.length === 0 && entry.realizedPnl === 0) return;
  const days = readHistory().filter((d) => !(d.dateKey === entry.dateKey && d.symbol === entry.symbol));
  days.push({ ...entry, archivedAt: Date.now() });
  days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  writeHistory(days);
}

/** Newest first. */
export function loadHistory(): ArchivedDay[] {
  return [...readHistory()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

export interface HistorySummary {
  daysTracked: number;
  cumulativePnl: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  bestDay: ArchivedDay | null;
  worstDay: ArchivedDay | null;
}

export function summarizeHistory(days: ArchivedDay[]): HistorySummary {
  const allTrades = days.flatMap((d) => d.trades);
  const wins = allTrades.filter((t) => t.pnl > 0);
  const losses = allTrades.filter((t) => t.pnl < 0);
  const bestDay = days.reduce<ArchivedDay | null>(
    (best, d) => (!best || d.realizedPnl > best.realizedPnl ? d : best),
    null,
  );
  const worstDay = days.reduce<ArchivedDay | null>(
    (worst, d) => (!worst || d.realizedPnl < worst.realizedPnl ? d : worst),
    null,
  );
  return {
    daysTracked: days.length,
    cumulativePnl: days.reduce((sum, d) => sum + d.realizedPnl, 0),
    winRate: allTrades.length > 0 ? wins.length / allTrades.length : null,
    avgWin: wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : null,
    avgLoss: losses.length > 0 ? losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length : null,
    bestDay,
    worstDay,
  };
}
