"use client";

import type { PaperFill } from "@/lib/domain";

interface BlotterRow {
  time: string;
  side: "buy" | "sell";
  price: number;
  reason: string;
  pnl: number | null;
}

/**
 * "The Orderflow Ledger" paper blotter — a ruled broadsheet table of every
 * paper fill. Entries show "—" realized; exits show the round-trip P&L in green
 * (win) or oxblood (loss). Shared by the live console and FDAX replay.
 */
export function TradeLog({
  fills,
  tickSize,
  tickValue,
  currency = "EUR",
  priceDecimals = 1,
}: {
  fills: PaperFill[];
  tickSize: number;
  tickValue: number;
  currency?: string;
  priceDecimals?: number;
}) {
  const rows: BlotterRow[] = [];
  let entryPrice: number | null = null;
  for (const fill of fills) {
    if (fill.side === "buy") {
      entryPrice = fill.price;
      rows.push({ time: fill.time, side: "buy", price: fill.price, reason: fill.reason, pnl: null });
    } else {
      const pnl = entryPrice !== null ? ((fill.price - entryPrice) / tickSize) * tickValue : null;
      rows.push({ time: fill.time, side: "sell", price: fill.price, reason: fill.reason, pnl });
      entryPrice = null;
    }
  }

  if (rows.length === 0) {
    return <div className="empty">No paper fills yet this session.</div>;
  }

  function money(value: number) {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)} ${currency}`;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="blotter">
        <thead>
          <tr>
            <th>Time</th>
            <th>Side</th>
            <th className="num">Fill</th>
            <th>Rationale</th>
            <th className="num">Realized</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .slice()
            .reverse()
            .map((row, i) => (
              <tr key={`${row.time}-${row.side}-${i}`}>
                <td className="mono">{row.time}</td>
                <td>
                  <span className={`side ${row.side}`}>{row.side.toUpperCase()}</span>
                </td>
                <td className="num mono">{row.price.toFixed(priceDecimals)}</td>
                <td className="rationale">{row.reason}</td>
                <td
                  className="num mono"
                  style={{ color: row.pnl == null ? "var(--faint)" : row.pnl >= 0 ? "var(--up)" : "var(--down)" }}
                >
                  {row.pnl == null ? "—" : money(row.pnl)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
