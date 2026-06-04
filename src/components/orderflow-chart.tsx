"use client";

import type { MinuteBar, ReplaySignal } from "@/lib/domain";

interface Props {
  bars: MinuteBar[];
  signals: ReplaySignal[];
  threshold: number;
  /** Index of the last bar that has been "seen" in fixture mode. -1 = none yet. */
  activeIndex: number;
  /** When false all bars are visible (non-fixture / completed replay). */
  maskFuture?: boolean;
}

const SVG_H = 160;
const BAR_GAP = 3;
const AXIS_H = 20;
const CHART_H = SVG_H - AXIS_H;

export function OrderflowChart({ bars, signals, threshold, activeIndex, maskFuture = false }: Props) {
  if (!bars.length) {
    return <p className="muted empty-panel">Completed bars appear here once a session is running.</p>;
  }

  const maxAbs = Math.max(...bars.map((b) => Math.abs(b.orderflow)), threshold + 10, 10);
  const n = bars.length;

  // We'll use a percentage-based SVG viewBox so it scales with the container.
  // viewBox width = n columns, each 1 unit wide.
  const viewBoxW = n;
  const viewBoxH = SVG_H;

  const barW = 1 - BAR_GAP / 30; // fractional column width

  // Convert orderflow to a y position and height within CHART_H
  function toY(value: number): number {
    // centre line is at CHART_H / 2
    const centre = CHART_H / 2;
    return centre - (value / maxAbs) * (CHART_H / 2 - 4);
  }

  const centreY = CHART_H / 2;

  // threshold line y position (positive side)
  const thresholdY = toY(threshold);

  // Map signal times to bar indexes for marker placement
  const buyIndexes = new Set<number>();
  const sellIndexes = new Set<number>();
  for (const sig of signals) {
    if (sig.status !== "executed") continue;
    const t = sig.time.slice(0, 5); // "09:01"
    const idx = bars.findIndex((b) => b.localTime === t || b.id === t);
    if (idx === -1) continue;
    if (sig.action === "buy") buyIndexes.add(idx);
    else if (sig.action === "sell") sellIndexes.add(idx);
  }

  return (
    <svg
      viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
      preserveAspectRatio="none"
      aria-label="Orderflow bar chart"
      style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
    >
      {/* Zero baseline */}
      <line
        x1={0} y1={centreY} x2={viewBoxW} y2={centreY}
        stroke="var(--border-bright)" strokeWidth={0.04}
      />

      {/* Threshold dashed line (positive side) */}
      <line
        x1={0} y1={thresholdY} x2={viewBoxW} y2={thresholdY}
        stroke="var(--accent)" strokeWidth={0.06} strokeDasharray="0.3 0.2" opacity={0.5}
      />
      {/* Threshold label — only draw if there's room (n > 3) */}
      {n > 3 && (
        <text
          x={viewBoxW - 0.15}
          y={thresholdY - 0.4}
          fontSize={0.7}
          fill="var(--accent)"
          textAnchor="end"
          opacity={0.7}
        >
          {threshold}
        </text>
      )}

      {bars.map((bar, i) => {
        const future = maskFuture && i > activeIndex;
        const active = maskFuture && i === activeIndex;
        const of = bar.orderflow;
        const positive = of >= 0;
        const barHeight = Math.abs((of / maxAbs) * (CHART_H / 2 - 4));
        const barY = positive ? centreY - barHeight : centreY;
        const fill = future
          ? "var(--border)"
          : positive
          ? "var(--accent)"
          : "var(--danger)";
        const opacity = future ? 0.3 : active ? 1 : 0.85;
        const x = i + (1 - barW) / 2;

        const hasBuy = buyIndexes.has(i);
        const hasSell = sellIndexes.has(i);

        // Buy marker: upward triangle below bar bottom
        const buyMarkerY = centreY + 2.2;
        // Sell marker: downward triangle above bar top
        const sellMarkerY = barY - 1.5;

        return (
          <g key={bar.id}>
            <rect
              x={x} y={barY}
              width={barW} height={Math.max(barHeight, 0.1)}
              fill={fill} opacity={opacity} rx={0.1}
            />
            {/* X-axis label — every other bar to avoid crowding */}
            {i % 2 === 0 && (
              <text
                x={i + 0.5} y={SVG_H - 2}
                fontSize={0.65} fill="var(--muted)"
                textAnchor="middle"
              >
                {bar.localTime}
              </text>
            )}
            {/* Buy signal marker */}
            {hasBuy && !future && (
              <polygon
                points={`${i + 0.5},${buyMarkerY - 1.4} ${i + 0.2},${buyMarkerY} ${i + 0.8},${buyMarkerY}`}
                fill="var(--accent)"
                opacity={0.9}
              />
            )}
            {/* Sell signal marker */}
            {hasSell && !future && (
              <polygon
                points={`${i + 0.5},${sellMarkerY + 1.4} ${i + 0.2},${sellMarkerY} ${i + 0.8},${sellMarkerY}`}
                fill="var(--danger)"
                opacity={0.9}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
