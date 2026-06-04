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
  const sourceLabel = session
    ? session.sourceMode === "delayed_paper"
      ? "Delayed Paper"
      : "CSV Replay"
    : "Fixture Demo";
  const netPnl = session ? session.realizedPnlEur : 25;
  const grossPnl = session ? session.grossPnlEur : 25;
  const positionCount = session ? Math.floor(session.fills.length / 2) : 3;
  return (
    <section className="document-page">
      <p className="eyebrow">Paper Journal</p>
      <h1>Paper session journal</h1>
      <p className="lede">
        Local delayed-paper and CSV sessions remain on your Mac by default. Optional Supabase sync
        can populate this hosted view with compact session results. Without a local or synchronized session, the preview below is the fixture demo.
      </p>
      <article className="panel journal">
        <div className="journal-summary">
          <div><span>Source</span><strong>{sourceLabel}</strong></div>
          <div><span>Net paper P&amp;L</span><strong className={netPnl >= 0 ? "positive" : "negative"}>{netPnl >= 0 ? "+" : ""}{netPnl.toFixed(2)} EUR</strong></div>
          <div><span>Gross reference P&amp;L</span><strong>{grossPnl >= 0 ? "+" : ""}{grossPnl.toFixed(2)} EUR</strong></div>
          <div><span>Positions</span><strong>{positionCount}</strong></div>
          <div><span>Fill model</span><strong>{session ? "Bid / ask realistic" : "Demo / reference"}</strong></div>
          <div><span>Contract math</span><strong>{session ? "Selected session spec" : "Demo only"}</strong></div>
          <div><span>Commission / slippage</span><strong>EUR 0.00 / 0 ticks</strong></div>
        </div>
        <table>
          <thead><tr><th>Time CET</th><th>Action</th><th>Fill</th><th>Rationale</th></tr></thead>
          <tbody>
            {fills.map((fill, index) => (
              <tr key={`${fill.time}-${fill.side}-${index}`}><td className="mono">{fill.time}</td><td><span className={`action ${fill.side.toLowerCase()}`}>{fill.side}</span></td><td className="mono">{fill.price}</td><td>{fill.reason}</td></tr>
            ))}
          </tbody>
        </table>
      </article>
      <p className="notice">
        {session
          ? "Paper session output only. Delayed market data where applicable; no broker execution or expected-performance claim."
          : "Toy deterministic fixture - not real FDAX market data and not a claim of expected performance."}
      </p>
    </section>
  );
}
