import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Aegis — chargeback defense",
  description: "Prevent disputes, defend the ones that land, and learn from every outcome.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let counts: Record<string, number> = {};
  try {
    const [orders, watches, disputes, rules] = await Promise.all([
      db.riskAssessment.count({ where: { tier: { in: ["HOLD", "REVIEW"] } } }),
      db.watch.count({ where: { status: "OPEN" } }),
      db.dispute.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      db.rule.count({ where: { status: "PROPOSED" } }),
    ]);
    counts = { orders, watches, disputes, rules };
  } catch {
    // The nav must render even before the database exists, so a fresh clone
    // shows the setup notice rather than a stack trace.
  }

  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Nav counts={counts} />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
