import { CloudCog, FlaskConical, LockKeyhole, MonitorCog, Timer, Upload } from "lucide-react";

export default function SetupPage() {
  return (
    <section className="document-page">
      <p className="eyebrow">Zero-Cost Setup</p>
      <h1>Run a local delayed-paper worker</h1>
      <p className="lede">
        FDAX Pulse keeps strategy processing and permitted raw data on your Mac. Supabase is
        optional and receives compact outputs only when synchronization is configured.
      </p>
      <div className="setup-steps">
        <article className="panel step">
          <Timer />
          <h2>1. Delayed Paper Session</h2>
          <p>Accept the official delayed-data terms yourself, then qualify matching pre-trade and post-trade files for an explicit FDAX maturity. The supplied June sample has passed structural TAQ qualification.</p>
          <pre>python -m worker.fdax_pulse.cli --serve-local-api --local-store</pre>
        </article>
        <article className="panel step">
          <CloudCog />
          <h2>2. Optional Supabase Sync</h2>
          <p>Connect a dedicated project only for owner-protected compact session viewing. Missing sync must never interrupt local paper processing.</p>
        </article>
        <article className="panel step">
          <Upload />
          <h2>3. Import TAQ CSV</h2>
          <p>Provide FDAX timestamp, trade price, size, bid, ask, and symbol fields in IQFeed-like or Databento-like CSV form.</p>
          <pre>python -m worker.fdax_pulse.cli --csv /path/to/file.csv --local-store</pre>
        </article>
        <article className="panel step">
          <FlaskConical />
          <h2>4. Fixture Demo</h2>
          <p>Toy deterministic events demonstrate three paper trades without external market data.</p>
          <pre>python -m worker.fdax_pulse.cli --fixture --mode automatic --local-store</pre>
        </article>
        <article className="panel step locked">
          <LockKeyhole />
          <h2>5. Real-Time Feed Locked</h2>
          <p>Databento XEUR.EOBI remains an intentional paid entitlement boundary. The zero-cost release never requests real-time market data.</p>
        </article>
        <article className="panel step">
          <MonitorCog />
          <h2>Local Status API</h2>
          <pre>python -m worker.fdax_pulse.cli --serve-local-api --local-store</pre>
          <p>Serves compact sessions only on <code>127.0.0.1:8787</code> for a local dashboard view.</p>
        </article>
      </div>
      <article className="panel data-quality">
        <p className="eyebrow">Accepted Data Policy</p>
        <h2>Rows are quarantined when execution would be dishonest</h2>
        <p>
          The worker rejects crossed or missing quotes, invalid sizes, wrong contracts, malformed
          timestamps, stale execution quotes, and out-of-session ticks. Unresolved midpoint ties
          are excluded from orderflow and reported. Every exclusion is retained in the session report.
        </p>
        <p>
          Official delayed files are parsed as NDJSON and joined only by exact product identifier
          and selected maturity. Raw downloaded payloads are not uploaded to Supabase.
        </p>
      </article>
    </section>
  );
}
