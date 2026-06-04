import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "FDAX Pulse | Live Orderflow Paper Trading",
  description:
    "Live paper-trading console running the Pecchiari orderflow strategy on a real public futures feed. Runs immediately — no setup required.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <SiteHeader />
        <main className="app-shell">{children}</main>
        <footer className="site-footer">
          Research simulation only. Live data from a public crypto-futures feed; FDAX uses delayed/local data where applicable. Paper only. No broker connection. No investment advice.
        </footer>
      </body>
    </html>
  );
}
