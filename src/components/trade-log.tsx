import type { PaperFill } from "@/lib/domain";

interface TradeRow {
  index: number;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  ticks: number;
  pnl: number;
}

/**
 * Scannable closed-trade table shared by the live console and the advanced
 * replay console. Trades are derived from [entry, exit] fill pairs, so callers
 * pass the flat fill list plus the instrument's tick economics.
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
  const rows: TradeRow[] = [];
  for (let i = 0; i + 1 < fills.length; i += 2) {
    const entry = fills[i];
    const exit = fills[i + 1];
    const ticks = (exit.price - entry.price) / tickSize;
    rows.push({
      index: rows.length + 1,
      entryTime: entry.time,
      exitTime: exit.time,
      entryPrice: entry.price,
      exitPrice: exit.price,
      ticks: Math.round(ticks * 100) / 100,
      pnl: ticks * tickValue,
    });
  }

  if (rows.length === 0) {
    return <p className="muted empty-panel">No closed trades yet. Each round trip lands here.</p>;
  }

  return (
    <table className="trade-log">
      <thead>
        <tr>
          <th>#</th>
          <th>In</th>
          <th>Out</th>
          <th>Entry</th>
          <th>Exit</th>
          <th>Ticks</th>
          <th>P&amp;L</th>
        </tr>
      </thead>
      <tbody>
        {rows
          .slice()
          .reverse()
          .map((row) => (
            <tr key={row.index} className={row.pnl >= 0 ? "win" : "loss"}>
              <td className="mono">{row.index}</td>
              <td className="mono">{row.entryTime}</td>
              <td className="mono">{row.exitTime}</td>
              <td className="mono">{row.entryPrice.toFixed(priceDecimals)}</td>
              <td className="mono">{row.exitPrice.toFixed(priceDecimals)}</td>
              <td className={`mono ${row.ticks >= 0 ? "positive" : "negative"}`}>
                {row.ticks > 0 ? "+" : ""}
                {row.ticks}
              </td>
              <td className={`mono ${row.pnl >= 0 ? "positive" : "negative"}`}>
                {row.pnl > 0 ? "+" : ""}
                {row.pnl.toFixed(2)} {currency}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
