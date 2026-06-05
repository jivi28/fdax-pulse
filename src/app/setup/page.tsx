const STEPS: Array<{ num: string; title: string; body: string; code?: string; locked?: boolean }> = [
  {
    num: "01",
    title: "Delayed Paper session",
    body: "Accept the official delayed-data terms yourself, then qualify matching pre-trade and post-trade files for an explicit FDAX maturity.",
    code: "python -m worker.fdax_pulse.cli --serve-local-api",
  },
  {
    num: "02",
    title: "Optional Supabase sync",
    body: "Connect a dedicated project only for owner-protected compact session viewing. Missing sync never interrupts local paper processing.",
  },
  {
    num: "03",
    title: "Import TAQ CSV",
    body: "Provide FDAX timestamp, trade price, size, bid, ask and symbol fields in IQFeed-like or Databento-like form.",
    code: "python -m worker.fdax_pulse.cli --csv file.csv",
  },
  {
    num: "04",
    title: "Fixture demo",
    body: "Toy deterministic events demonstrate three paper trades without any external market data.",
    code: "python -m worker.fdax_pulse.cli --fixture",
  },
  {
    num: "05",
    title: "Real-time feed locked",
    body: "Databento XEUR.EOBI remains an intentional paid-entitlement boundary. The zero-cost release never requests real-time data.",
    locked: true,
  },
  {
    num: "06",
    title: "Local status API",
    body: "Serves compact sessions only on 127.0.0.1:8787 for a local dashboard view.",
    code: "--serve-local-api --local-store",
  },
];

export default function SetupPage() {
  return (
    <div className="doc stack">
      <div className="doc-hero">
        <p className="eyebrow">Zero-Cost Setup</p>
        <h1>Run a local delayed-paper worker</h1>
        <p className="doc-lede">
          The <em>Live</em> crypto console needs none of this — it streams a free public feed straight in the browser.
          The steps below set up the optional local worker for <em>FDAX</em> delayed-paper and CSV sessions, which keep
          permitted raw data on your Mac.
        </p>
      </div>

      <p className="ribbon">
        <span>
          <b>No setup for Live.</b> The crypto orderflow console runs entirely client-side — no worker, no API keys, no
          entitlement. Setup below is only for the FDAX delayed/CSV worker.
        </span>
      </p>

      <section className="steps">
        {STEPS.map((step) => (
          <article key={step.num} className={`panel step ${step.locked ? "locked" : ""}`}>
            <span className="num">Step {step.num}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
            {step.code && (
              <pre>
                <code>{step.code}</code>
              </pre>
            )}
          </article>
        ))}
      </section>

      <article className="panel prose-card" style={{ borderLeft: "4px solid var(--gold)" }}>
        <p className="eyebrow">Accepted Data Policy</p>
        <h2>Rows are quarantined when execution would be dishonest</h2>
        <p>
          The worker rejects crossed or missing quotes, invalid sizes, wrong contracts, malformed timestamps, stale
          execution quotes and out-of-session ticks. Unresolved midpoint ties are excluded from orderflow and reported.
          Every exclusion is retained in the session report.
        </p>
      </article>
    </div>
  );
}
