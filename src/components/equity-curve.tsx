"use client";

import type { PaperFill } from "@/lib/domain";

interface Props {
  fills: PaperFill[];
  tickValueEur: number;
  tickSize: number;
  /** Quote-currency label for P&L (EUR for FDAX, USDT for live crypto). */
  currency?: string;
}

const SVG_H = 120;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 20;

function eur(v: number) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

export function EquityCurve({ fills, tickValueEur, tickSize, currency = "EUR" }: Props) {
  // Build cumulative PnL from fill pairs [buy, sell, buy, sell, ...]
  const points: number[] = [0];
  for (let i = 0; i + 1 < fills.length; i += 2) {
    const entry = fills[i];
    const exit = fills[i + 1];
    const ticks = (exit.price - entry.price) / tickSize;
    const pnl = ticks * tickValueEur;
    points.push((points.at(-1) ?? 0) + pnl);
  }

  if (points.length < 2) {
    return (
      <div className="equity-empty">
        <p className="muted">Equity curve appears after the first closed trade.</p>
      </div>
    );
  }

  const W = 300; // internal SVG units
  const chartW = W - PAD_L - PAD_R;
  const chartH = SVG_H - PAD_T - PAD_B;

  const minPnl = Math.min(0, ...points);
  const maxPnl = Math.max(0, ...points);
  const range = maxPnl - minPnl || 50;

  function toSvg(index: number, value: number) {
    const x = PAD_L + (index / (points.length - 1)) * chartW;
    const y = PAD_T + ((maxPnl - value) / range) * chartH;
    return { x, y };
  }

  const zeroY = PAD_T + (maxPnl / range) * chartH;
  const finalPnl = points.at(-1) ?? 0;
  const lineColor = finalPnl >= 0 ? "var(--accent)" : "var(--danger)";

  const polyPoints = points.map((v, i) => {
    const { x, y } = toSvg(i, v);
    return `${x},${y}`;
  }).join(" ");

  // Fill area under/over zero
  const { x: x0 } = toSvg(0, points[0]!);
  const { x: xLast } = toSvg(points.length - 1, finalPnl);
  const areaPoints = `${x0},${zeroY} ${polyPoints} ${xLast},${zeroY}`;

  // Y-axis labels
  const yLabels = [maxPnl, (maxPnl + minPnl) / 2, minPnl].map((v, i) => ({
    label: eur(v),
    y: PAD_T + (i / 2) * chartH,
  }));

  return (
    <svg
      viewBox={`0 0 ${W} ${SVG_H}`}
      aria-label="Equity curve"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      {/* Zero baseline */}
      <line
        x1={PAD_L} y1={zeroY} x2={W - PAD_R} y2={zeroY}
        stroke="var(--border-bright)" strokeWidth={1} strokeDasharray="4 3"
      />

      {/* Y-axis labels */}
      {yLabels.map(({ label, y }) => (
        <text key={label} x={PAD_L - 4} y={y + 4} fontSize={8} fill="var(--muted)" textAnchor="end">
          {label}
        </text>
      ))}

      {/* Area fill */}
      <polygon points={areaPoints} fill={lineColor} opacity={0.08} />

      {/* Line */}
      <polyline
        points={polyPoints}
        fill="none"
        stroke={lineColor}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Dots for each trade */}
      {points.map((v, i) => {
        const { x, y } = toSvg(i, v);
        return (
          <circle
            key={i}
            cx={x} cy={y} r={2.5}
            fill={v >= 0 ? "var(--accent)" : "var(--danger)"}
            stroke="var(--panel)" strokeWidth={1}
          />
        );
      })}

      {/* Final PnL label */}
      {(() => {
        const { x, y } = toSvg(points.length - 1, finalPnl);
        return (
          <text
            x={x + 4} y={y + 4}
            fontSize={9} fontWeight={600}
            fill={lineColor}
            textAnchor="start"
          >
            {eur(finalPnl)} {currency}
          </text>
        );
      })()}

      {/* X-axis labels */}
      {points.map((_, i) => {
        if (i === 0) return null;
        const { x } = toSvg(i, 0);
        return (
          <text key={i} x={x} y={SVG_H - 4} fontSize={8} fill="var(--muted)" textAnchor="middle">
            T{i}
          </text>
        );
      })}
    </svg>
  );
}
