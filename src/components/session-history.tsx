"use client";

import { useEffect, useState } from "react";

import { TradeLog } from "@/components/trade-log";
import type { PaperFill } from "@/lib/domain";
import { loadHistory, summarizeHistory, type ArchivedDay, type HistorySummary } from "@/lib/live-session-history";

function usdt(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}

function pct(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

/** Cumulative P&L across archived days — one point per day, oldest to newest. */
function DailyEquityCurve({ days }: { days: ArchivedDay[] }) {
  const ordered = [...days].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const pts: number[] = [0];
  for (const day of ordered) pts.push((pts.at(-1) ?? 0) + day.realizedPnl);

  if (pts.length < 2) {
    return <div className="empty">The equity curve traces your first archived day.</div>;
  }

  const W = 480;
  const H = 210;
  const padL = 8;
  const padR = 14;
  const padT = 16;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const minV = Math.min(0, ...pts);
  const maxV = Math.max(0, ...pts, 1);
  const range = maxV - minV || 1;
  const x = (i: number) => padL + (i / (pts.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - ((v - minV) / range) * innerH;
  const zeroY = y(0);
  const last = pts.at(-1) ?? 0;
  const up = last >= 0;
  const stroke = up ? "var(--up)" : "var(--down)";

  let d = `M ${x(0)} ${y(pts[0])}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${x(i)} ${y(pts[i - 1])} L ${x(i)} ${y(pts[i])}`;
  }
  const area = `${d} L ${x(pts.length - 1)} ${zeroY} L ${x(0)} ${zeroY} Z`;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} preserveAspectRatio="none">
        <line className="grid-line" x1={padL} x2={W - padR} y1={padT} y2={padT} />
        <path d={area} fill={stroke} opacity={0.1} />
        <line className="zero-line" x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} opacity={0.5} />
        <path d={d} fill="none" stroke={stroke} strokeWidth={1.8} />
        {pts.map((v, i) => i > 0 && <circle key={i} cx={x(i)} cy={y(v)} r={2.4} fill={stroke} />)}
        <circle cx={x(pts.length - 1)} cy={y(last)} r={3.6} fill="var(--paper)" stroke={stroke} strokeWidth={2} />
      </svg>
      <div className="chart-cap">
        <span>cumulative across {ordered.length} days</span>
        <span style={{ color: stroke, fontFamily: "var(--font-mono)" }}>{usdt(last)}</span>
      </div>
    </div>
  );
}

type RangeOption = "today" | "all" | "7d" | "30d";

const RANGE_LABELS: Record<RangeOption, string> = {
  today: "Today",
  all: "All time",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

function cutoffDateKey(range: RangeOption): string | null {
  if (range === "all" || range === "today") return null;
  const days = range === "7d" ? 7 : 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff.toLocaleDateString("en-CA");
}

export function SessionHistory({
  todayFills,
  todaySymbol,
  tickSize,
  tickValue,
  priceDecimals,
}: {
  todayFills: PaperFill[];
  todaySymbol: string;
  tickSize: number;
  tickValue: number;
  priceDecimals: number;
}) {
  const [allDays, setAllDays] = useState<ArchivedDay[] | null>(null);
  const [range, setRange] = useState<RangeOption>("today");

  useEffect(() => {
    void Promise.resolve().then(() => setAllDays(loadHistory()));
  }, []);

  const rangeSelect = (
    <div className="field">
      <label>Range</label>
      <select value={range} onChange={(e) => setRange(e.target.value as RangeOption)}>
        {(Object.keys(RANGE_LABELS) as RangeOption[]).map((key) => (
          <option key={key} value={key}>
            {RANGE_LABELS[key]}
          </option>
        ))}
      </select>
    </div>
  );

  if (range === "today") {
    const closed = todayFills.filter((f) => f.side === "sell").length;
    return (
      <section className="panel" style={{ padding: "var(--pad)" }}>
        <div className="section-rule">
          <h2>Blotter</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="meta">
              {todayFills.length} fills · {closed} round-trips · {todaySymbol}
            </span>
            {rangeSelect}
          </div>
        </div>
        <TradeLog fills={todayFills} tickSize={tickSize} tickValue={tickValue} currency="USDT" priceDecimals={priceDecimals} />
      </section>
    );
  }

  if (allDays === null) return null;

  const since = cutoffDateKey(range);
  const days = since ? allDays.filter((d) => d.dateKey >= since) : allDays;

  if (allDays.length === 0) {
    return (
      <section className="panel" style={{ padding: "var(--pad)" }}>
        <div className="section-rule">
          <h2>Blotter</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="meta">Live Crypto · 0 days</span>
            {rangeSelect}
          </div>
        </div>
        <div className="empty">Past sessions will appear here once a day&apos;s live session ends.</div>
      </section>
    );
  }

  if (days.length === 0) {
    return (
      <section className="panel" style={{ padding: "var(--pad)" }}>
        <div className="section-rule">
          <h2>Blotter</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="meta">Live Crypto · 0 days</span>
            {rangeSelect}
          </div>
        </div>
        <div className="empty">No archived sessions in this range — try a wider window.</div>
      </section>
    );
  }

  const summary: HistorySummary = summarizeHistory(days);
  const rows: Array<{ k: string; v: string; cls?: string }> = [
    { k: "Days tracked", v: String(summary.daysTracked) },
    {
      k: "Cumulative P&L",
      v: usdt(summary.cumulativePnl),
      cls: summary.cumulativePnl >= 0 ? "up" : "dn",
    },
    { k: "Win rate", v: summary.winRate !== null ? pct(summary.winRate) : "—" },
    { k: "Avg win", v: summary.avgWin !== null ? usdt(summary.avgWin) : "—", cls: "up" },
    { k: "Avg loss", v: summary.avgLoss !== null ? usdt(summary.avgLoss) : "—", cls: "dn" },
    {
      k: "Best day",
      v: summary.bestDay ? `${usdt(summary.bestDay.realizedPnl)} · ${summary.bestDay.dateKey}` : "—",
      cls: "up",
    },
    {
      k: "Worst day",
      v: summary.worstDay ? `${usdt(summary.worstDay.realizedPnl)} · ${summary.worstDay.dateKey}` : "—",
      cls: "dn",
    },
  ];

  return (
    <section className="panel" style={{ padding: "var(--pad)" }}>
      <div className="section-rule">
        <h2>Blotter</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="meta">Live Crypto · {days.length} days</span>
          {rangeSelect}
        </div>
      </div>
      <section className="summary-grid" style={{ marginBottom: "var(--gap)" }}>
        {rows.map((item) => (
          <div key={item.k}>
            <span className="k">{item.k}</span>
            <span className={`v ${item.cls ?? ""}`} style={item.v.length > 14 ? { fontSize: 15 } : undefined}>
              {item.v}
            </span>
          </div>
        ))}
      </section>
      <DailyEquityCurve days={days} />

      <div className="section-rule" style={{ marginTop: "var(--gap)" }}>
        <h2>Daily history</h2>
        <span className="meta">{days.length} entries</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="blotter">
          <thead>
            <tr>
              <th>Date</th>
              <th>Symbol</th>
              <th className="num">Net P&amp;L</th>
              <th className="num">Round-trips</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={`${day.dateKey}-${day.symbol}`}>
                <td className="mono">{day.dateKey}</td>
                <td>{day.symbol}</td>
                <td className="num mono" style={{ color: day.realizedPnl >= 0 ? "var(--up)" : "var(--down)" }}>
                  {usdt(day.realizedPnl)}
                </td>
                <td className="num mono">{day.trades.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
