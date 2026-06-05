import Link from "next/link";

const EXECUTION: Array<[string, React.ReactNode]> = [
  ["I", <>FDAX-focused signal logic, <b>one paper contract</b>, long only.</>],
  ["II", <>Completed one-minute bars from <b>09:00 to 17:00</b> Europe/Berlin (FDAX); 24/7 on the live tape.</>],
  ["III", <>Enter next interval when orderflow and volume both clear their thresholds.</>],
  ["IV", <>Hold while one-minute orderflow is positive; exit when it is not.</>],
  ["V", <>Fill paper entries at <b>ask</b>, exits at <b>bid</b>.</>],
];

export default function MethodologyPage() {
  return (
    <div className="doc stack">
      <div className="doc-hero">
        <p className="eyebrow">Strategy Methodology</p>
        <h1>The Pecchiari orderflow method</h1>
        <p className="doc-lede">
          This implementation follows the executable rules in Matteo Pecchiari&apos;s
          <em> Orderflow Imbalance and High&nbsp;Frequency Trading</em>, pages 40–41 and 63–65 — a
          long-only, one-contract reading of completed one-minute imbalance.
        </p>
      </div>

      <article className="panel prose-card" style={{ borderLeft: "4px solid var(--gold)" }}>
        <h2>Live crypto versus delayed FDAX</h2>
        <p>
          Real FDAX tick data requires a paid Eurex/Deutsche Börse entitlement, so it lives in the{" "}
          <Link className="tlink" href="/advanced">FDAX Replay</Link> lab (local worker + CSV, EUR, fixed{" "}
          <code>24</code> / <code>242</code> thresholds). The <Link className="tlink" href="/">Live</Link> console
          applies the <em>identical</em> Lee-Ready classification and one-minute orderflow method to a free,
          browser-reachable crypto-futures feed (Binance USD-M, Bybit fallback). Because that tape is unbounded,
          thresholds <strong>auto-calibrate to the live 85th percentile</strong> rather than using the thesis&apos;s
          fixed FDAX-sample numbers — the same percentile rule (p.64), fit live.
        </p>
      </article>

      <div className="two-col">
        <article className="panel prose-card">
          <h2>Data required</h2>
          <p>
            Each trade needs a timestamp, trade price, trade size, current best bid, current best ask, and contract
            identity. Minute close-price bars alone cannot reproduce classified orderflow.
          </p>
          <h2 className="sub-h">Classification</h2>
          <p>
            Volume above midpoint counts as buying pressure; volume below midpoint as selling pressure. Midpoint prints
            use the Lee-Ready tick-direction fallback; an unresolved initial tie is excluded and reported.
          </p>
        </article>
        <article className="panel prose-card">
          <h2>Execution rule</h2>
          <ol className="rulelist">
            {EXECUTION.map(([n, txt]) => (
              <li key={n}>
                <span className="n">{n}</span>
                <span>{txt}</span>
              </li>
            ))}
          </ol>
          <p className="pull">
            Historical thesis results are references, not reproduced performance — the original 62-day raw data is not
            included here.
          </p>
        </article>
      </div>

      <div className="two-col">
        <article className="panel prose-card">
          <h2>Four source modes</h2>
          <ol className="rulelist">
            <li><span className="n">A</span><span><b>Live Crypto</b> — primary console. Free public Binance/Bybit futures tape in the browser; thresholds auto-calibrate to the live 85th percentile.</span></li>
            <li><span className="n">B</span><span><b>Delayed Paper</b> — FDAX via official 15-minute delayed Eurex files, enabled only after local TAQ verification.</span></li>
            <li><span className="n">C</span><span><b>CSV Replay</b> — local validated trade-and-quote import for research and session review.</span></li>
            <li><span className="n">D</span><span><b>Fixture Demo</b> — toy deterministic data for testing the interface immediately.</span></li>
          </ol>
        </article>
        <article className="panel prose-card">
          <h2>Important boundaries</h2>
          <p>
            Candle bars alone cannot calculate this orderflow strategy. Thresholds 24 and 242 originate from the thesis
            sample and should not be assumed universal across contracts or periods. Contract economics are selected
            separately from strategy rules.
          </p>
        </article>
      </div>
    </div>
  );
}
