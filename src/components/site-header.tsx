import Link from "next/link";
import { DatabaseZap, Timer } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <span className="brand-mark">FDAX</span>
        <span>PULSE</span>
        <small>Live Orderflow Console</small>
      </Link>
      <nav aria-label="Primary navigation">
        <Link href="/">Live</Link>
        <Link href="/journal">Journal</Link>
        <Link href="/methodology">Methodology</Link>
        <Link href="/advanced">Advanced</Link>
        <Link href="/setup">Setup</Link>
      </nav>
      <div className="header-badges">
        <span className="badge warn"><Timer size={13} /> Paper only</span>
        <span className="badge"><DatabaseZap size={13} /> Free tier</span>
      </div>
    </header>
  );
}
