import Link from "next/link";

export default function MethodologyPage() {
  return (
    <section className="document-page">
      <p className="eyebrow">Strategy Methodology</p>
      <h1>Pecchiari FDAX orderflow strategy</h1>
      <p className="lede">
        This implementation follows the executable rules in Matteo Pecchiari&apos;s
        <em> Orderflow Imbalance and High Frequency Trading</em>, pages 40-41 and 63-65.
      </p>
      <article className="panel notice-card">
        <h2>Live demo vs. FDAX</h2>
        <p>
          Real FDAX (DAX futures) tick data requires a paid Eurex/Deutsche Börse entitlement, so it
          lives in the <Link className="text-link" href="/advanced">Advanced</Link> console (local
          worker + CSV). The public <Link className="text-link" href="/">Live</Link> console applies
          the <em>identical</em> Lee-Ready classification and one-minute orderflow method to a free,
          real public crypto-futures feed (trade price, size, and best bid/ask). The thesis&apos;s
          fixed <code>24</code> / <code>242</code> thresholds are themselves the 85th percentile of
          its own sample (p.64), so the live console auto-calibrates thresholds to the live 85th
          percentile — the same method, fitted to the live market.
        </p>
      </article>
      <div className="document-grid">
        <article className="panel text-card">
          <h2>Data required</h2>
          <p>
            Each imported trade needs a timestamp, trade price, trade size, current best bid,
            current best ask, and FDAX contract identity. Minute close-price bars alone cannot
            reproduce classified orderflow.
          </p>
          <h2>Classification</h2>
          <p>
            Volume trades above midpoint count as buying pressure and volume below midpoint as
            selling pressure. Midpoint prints use the Lee-Ready tick-direction fallback; an
            unresolved initial tie is excluded and reported.
          </p>
        </article>
        <article className="panel text-card">
          <h2>Execution rule</h2>
          <ul className="rule-list">
            <li>FDAX-focused signal logic, one paper contract, long only.</li>
            <li>Use completed one-minute bars from 09:00 to 17:00 Europe/Berlin.</li>
            <li>Enter next interval when orderflow &gt; 24 and volume &gt; 242.</li>
            <li>Hold while one-minute orderflow is positive; exit when it is not.</li>
            <li>Fill paper entries at ask and exits at bid.</li>
          </ul>
          <p className="notice">
            The thesis&apos;s historical results are references, not reproduced performance:
            its original 62-day raw data is not included here.
          </p>
        </article>
      </div>
      <div className="document-grid mode-explainer">
        <article className="panel text-card">
          <h2>Three source modes</h2>
          <ul className="rule-list">
            <li><strong>Delayed Paper:</strong> primary mode, enabled only after an official 15-minute delayed source is verified TAQ-sufficient.</li>
            <li><strong>CSV Replay:</strong> local validated trade-and-quote import for research and session review.</li>
            <li><strong>Fixture Demo:</strong> toy deterministic data for testing the interface immediately.</li>
          </ul>
        </article>
        <article className="panel text-card">
          <h2>Important boundaries</h2>
          <p>
            Candle bars alone cannot calculate this orderflow strategy. Thresholds 24 and 242
            originate from the thesis sample and should not be assumed universal across contracts
            or periods. Contract economics must be selected separately from strategy rules.
          </p>
        </article>
      </div>
      <Link className="text-link" href="/">Return to paper console</Link>
    </section>
  );
}
