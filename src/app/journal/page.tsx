"use client";

import { useEffect, useState } from "react";

import { fetchLatestLocalSession } from "@/lib/local-worker";
import type { WorkerSession } from "@/lib/domain";

const fixtureFills = [
  { time: "09:01:00", side: "BUY", price: "18,000.5", reason: "OF 243 / Volume 243 trigger" },
  { time: "09:03:00", side: "SELL", price: "18,001.0", reason: "Orderflow changed to -4" },
  { time: "09:05:00", side: "BUY", price: "18,002.0", reason: "OF 260 / Volume 260 trigger" },
  { time: "09:06:00", side: "SELL", price: "18,001.0", reason: "Orderflow changed to -18" },
  { time: "09:08:00", side: "BUY", price: "18,000.5", reason: "OF 255 / Volume 255 trigger" },
  { time: "09:10:00", side: "SELL", price: "18,002.0", reason: "Orderflow changed to -6" },
];

function eur(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} EUR`;
}

export default function JournalPage() {
  const [session, setSession] = useState<WorkerSession | null>(null);

  useEffect(() => {
    void fetchLatestLocalSession().then(setSession).catch(() => undefined);
  }, []);

  const fills = session
    ? session.fills.map((fill) => ({
        time: fill.time,
        side: fill.side.toUpperCase(),
        price: fill.price.toLocaleString("en-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
        reason: fill.reason,
      }))
    : fixtureFills;
  const sourceLabel = session ? (session.sourceMode === "delayed_paper" ? "Delayed Paper" : "CSV Replay") : "Fixture Demo";
  const netPnl = session ? session.realizedPnlEur : 25;
  const grossPnl = session ? session.grossPnlEur : 25;
  const positionCount = session ? Math.floor(session.fills.length / 2) : 3;

  const summary: Array<{ k: string; v: string; cls?: string }> = [
    { k: "Source", v: sourceLabel },
    { k: "Net paper P&L", v: eur(netPnl), cls: netPnl >= 0 ? "up" : "dn" },
    { k: "Gross reference", v: eur(grossPnl) },
    { k: "Round-trips", v: String(positionCount) },
    { k: "Fill model", v: session ? "Bid / ask realistic" : "Demo / reference" },
    { k: "Contract math", v: session ? "Selected session spec" : "Demo only" },
    { k: "Commission / slippage", v: "EUR 0.00 / 0 ticks" },
    { k: "Thresholds", v: "24 / 242 · fixed" },
  ];

  return (
    <div className="doc stack">
      <div className="doc-hero">
        <p className="eyebrow">Paper Journal · Local-First</p>
        <h1>The session ledger</h1>
        <p className="doc-lede">
          Live crypto, delayed-paper and CSV sessions all settle here. Live sessions stream in the browser; nothing
          leaves your machine unless optional Supabase sync is configured — and then only <em>compact</em> results,
          never raw exchange payloads.
        </p>
      </div>

      <section className="summary-grid">
        {summary.map((item) => (
          <div key={item.k}>
            <span className="k">{item.k}</span>
            <span className={`v ${item.cls ?? ""}`} style={item.v.length > 14 ? { fontSize: 15 } : undefined}>
              {item.v}
            </span>
          </div>
        ))}
      </section>

      <section className="panel" style={{ padding: "var(--pad)" }}>
        <div className="section-rule">
          <h2>Fills</h2>
          <span className="meta">{fills.length} entries</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="blotter">
            <thead>
              <tr>
                <th>Time</th>
                <th>Side</th>
                <th className="num">Fill</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {fills.map((fill, index) => (
                <tr key={`${fill.time}-${fill.side}-${index}`}>
                  <td className="mono">{fill.time}</td>
                  <td>
                    <span className={`side ${fill.side.toLowerCase()}`}>{fill.side}</span>
                  </td>
                  <td className="num mono">{fill.price}</td>
                  <td className="rationale">{fill.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="ribbon">
        <span>
          {session
            ? "Paper session output only. Delayed market data where applicable; no broker execution or expected-performance claim."
            : "Toy deterministic fixture — not real FDAX market data and not a claim of expected performance."}
        </span>
      </p>
    </div>
  );
}
