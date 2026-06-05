"use client";

import type { PaperFill } from "@/lib/domain";

interface Props {
  fills: PaperFill[];
  tickValueEur: number;
  tickSize: number;
  /** Quote-currency label (EUR for FDAX, USDT for live crypto). */
  currency?: string;
}

/**
 * "The Orderflow Ledger" equity curve: cumulative realized P&L stepped over the
 * session, deep-green when up / oxblood when down, with a faint area fill and a
 * mono caption of the running figure. Pure SVG.
 */
export function EquityCurve({ fills, tickValueEur, tickSize, currency = "EUR" }: Props) {
  // Cumulative realized P&L from [buy, sell] fill pairs.
  const pts: number[] = [0];
  for (let i = 0; i + 1 < fills.length; i += 2) {
    const entry = fills[i];
    const exit = fills[i + 1];
    const pnl = ((exit.price - entry.price) / tickSize) * tickValueEur;
    pts.push((pts.at(-1) ?? 0) + pnl);
  }

  function money(value: number) {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)} ${currency}`;
  }

  if (pts.length < 2) {
    return <div className="empty">The equity curve traces the first closed round-trip.</div>;
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

  // stepped path
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
        <span>realized cumulative</span>
        <span style={{ color: stroke, fontFamily: "var(--font-mono)" }}>{money(last)}</span>
      </div>
    </div>
  );
}
