"use client";

import type { MinuteBar, ReplaySignal } from "@/lib/domain";

interface Props {
  bars: MinuteBar[];
  signals: ReplaySignal[];
  threshold: number;
  /** Index of the last "seen" bar (replay). -1 = none. Live passes the last index. */
  activeIndex: number;
  /** When true, bars beyond activeIndex are de-emphasised (replay reveal). */
  maskFuture?: boolean;
  /** Caption timezone suffix, e.g. "CET". */
  tz?: string;
}

/**
 * "The Orderflow Ledger" editorial orderflow chart: signed minute bars around a
 * zero rule, deep-green up / oxblood down, with the live entry threshold marked
 * and ▲ entry / ▼ exit signal pins. Pure SVG, no dependency.
 */
export function OrderflowChart({ bars, signals, threshold, activeIndex, maskFuture = false, tz = "" }: Props) {
  if (!bars.length) {
    return <div className="empty">Completed bars appear here as the live tape closes each minute.</div>;
  }

  const W = 720;
  const H = 210;
  const padL = 4;
  const padR = 4;
  const padT = 16;
  const padB = 22;
  const data = bars.slice(-32);
  const offset = bars.length - data.length;
  const n = data.length || 1;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const zeroY = padT + innerH / 2;
  const bw = innerW / n;
  const maxAbs = Math.max(40, threshold + 8, ...data.map((b) => Math.abs(b.orderflow)));
  const yOf = (v: number) => zeroY - (v / maxAbs) * (innerH / 2);
  const thrY = yOf(threshold);

  const entryTimes = new Set<string>();
  const exitTimes = new Set<string>();
  for (const sig of signals) {
    if (sig.status !== "executed") continue;
    const t = sig.time.slice(0, 5);
    if (sig.action === "buy") entryTimes.add(t);
    else if (sig.action === "sell" || sig.action === "risk_halt") exitTimes.add(t);
  }

  function clock(ts: string) {
    return ts.slice(0, 5);
  }

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} preserveAspectRatio="none">
        {[0.25, 0.75].map((p) => (
          <line key={p} className="grid-line" x1={padL} x2={W - padR} y1={padT + innerH * p} y2={padT + innerH * p} />
        ))}
        {threshold > 0 && (
          <>
            <line className="thr-line" x1={padL} x2={W - padR} y1={thrY} y2={thrY} />
            <text className="axis-label" x={W - padR} y={thrY - 5} textAnchor="end" style={{ fill: "var(--up)" }}>
              ENTRY {threshold}
            </text>
          </>
        )}

        {data.map((b, i) => {
          const globalIndex = offset + i;
          const future = maskFuture && globalIndex > activeIndex;
          const x = padL + bw * i + bw * 0.18;
          const w = bw * 0.64;
          const pos = b.orderflow >= 0;
          const y = pos ? yOf(b.orderflow) : zeroY;
          const h = Math.max(1.5, Math.abs(yOf(b.orderflow) - zeroY));
          const isEntry = entryTimes.has(b.localTime);
          const isExit = exitTimes.has(b.localTime);
          const opacity = future ? 0.18 : isEntry || isExit ? 1 : pos ? 0.82 : 0.5;
          const cx = x + w / 2;
          return (
            <g key={b.id}>
              <rect x={x} y={y} width={w} height={h} fill={pos ? "var(--up)" : "var(--down)"} opacity={opacity} />
              {isEntry && !future && (
                <polygon
                  points={`${cx - 4},${zeroY + innerH / 2 + 4} ${cx + 4},${zeroY + innerH / 2 + 4} ${cx},${zeroY + innerH / 2 - 2}`}
                  fill="var(--up)"
                />
              )}
              {isExit && !future && (
                <polygon points={`${cx - 4},${padT} ${cx + 4},${padT} ${cx},${padT + 6}`} fill="var(--down)" />
              )}
            </g>
          );
        })}

        <line className="zero-line" x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} />
      </svg>
      <div className="chart-cap">
        <span>{clock(data[0]?.localTime ?? "")}{tz ? " " + tz : ""}</span>
        <span>signed orderflow · 1-min bars</span>
        <span>{clock(data[data.length - 1]?.localTime ?? "")}{tz ? " " + tz : ""}</span>
      </div>
    </div>
  );
}
