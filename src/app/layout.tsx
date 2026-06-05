import type { Metadata } from "next";
import { Newsreader, Archivo, IBM_Plex_Mono } from "next/font/google";

import { SiteHeader } from "@/components/site-header";
import "./globals.css";

// "The Orderflow Ledger" broadsheet type system: editorial serif display,
// clean grotesk UI, tabular mono for every live figure.
const serif = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif-src",
  display: "swap",
});
const sans = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-src",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-src",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Orderflow Pulse — Live Crypto-Futures Orderflow",
  description:
    "A premium broadsheet console running the Pecchiari orderflow strategy live on a real public futures feed. Runs immediately — no setup.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="app">
        <div className="shell masthead-shell">
          <SiteHeader />
        </div>
        <main className="shell">{children}</main>
        <footer className="shell ledger-footer">
          Research simulation only. Live data from a public crypto-futures feed; FDAX uses delayed/local data where applicable.
          Paper only. No broker connection. No investment advice.
        </footer>
      </body>
    </html>
  );
}
