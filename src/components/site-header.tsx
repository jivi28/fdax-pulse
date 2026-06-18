"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: Array<[string, string]> = [
  ["/", "Live"],
  ["/methodology", "Methodology"],
];

export function SiteHeader() {
  const pathname = usePathname();
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <header className="masthead">
      <div className="masthead-top">
        <Link className="wordmark" href="/">
          <span className="mark">
            <i>Orderflow</i> <b>Pulse</b>
          </span>
          <span className="kicker">Live Crypto-Futures Tape · Paper Orderflow Research</span>
        </Link>
        <div className="masthead-meta">
          <span className="dateline">{today}</span>
          <span className="edition">Research Simulation · No Broker · No Advice</span>
        </div>
      </div>
      <nav className="masthead-nav" aria-label="Primary navigation">
        {NAV.map(([href, label]) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={`navlink ${active ? "active" : ""}`}>
              {label}
            </Link>
          );
        })}
        <span className="nav-spacer" />
        <div className="nav-status">
          <span className="badge">Paper · No Broker</span>
        </div>
      </nav>
    </header>
  );
}
