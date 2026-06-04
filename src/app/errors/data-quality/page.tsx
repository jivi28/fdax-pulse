export default function DataQualityPage() {
  return (
    <section className="auth-page panel">
      <p className="eyebrow">Paper Session Blocked</p>
      <h1>Source failed execution checks</h1>
      <p className="muted">
        The worker quarantines rows with crossed quotes, missing bid/ask state, invalid trade
        size, wrong contract, malformed time, stale executable quotes, unresolved midpoint ties,
        or events outside the Berlin paper session. Delayed Paper also requires verified TAQ-level
        trade and prevailing bid/ask data before any strategy calculation.
      </p>
    </section>
  );
}
