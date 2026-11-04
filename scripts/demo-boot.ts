/**
 * Hosted-demo bootstrap. Loads the offline demo data and runs one agent pass,
 * but only when the database is empty, so restarting the service keeps
 * whatever judges have clicked.
 *
 *   npm run demo:boot
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { db } from "../src/lib/db";

async function main() {
  const orders = await db.order.count();
  if (orders > 0) {
    console.log(`[demo-boot] ${orders} orders already present; leaving data as is.`);
    return;
  }
  console.log("[demo-boot] empty database: seeding demo data and running the agents once…");
  execSync("npx tsx scripts/seed.ts --offline", { stdio: "inherit" });
  execSync("npx tsx scripts/run-agents.ts", { stdio: "inherit" });
}

main()
  .catch((err) => {
    // A failed seed should not keep the site down; the overview shows setup steps.
    console.error("[demo-boot] failed:", err);
  })
  .finally(() => db.$disconnect());
