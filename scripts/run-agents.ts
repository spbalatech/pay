/**
 * One full pass of the loop, in dependency order. Safe to re-run: every agent
 * upserts rather than duplicating.
 *
 *   npm run agents:run
 */
import "dotenv/config";
import { runSentinel } from "../src/agents/sentinel";
import { runInterceptor } from "../src/agents/interceptor";
import { runAdvocate } from "../src/agents/advocate";
import { proposeRules } from "../src/agents/learner";
import { dashboardMetrics } from "../src/agents/metrics";

async function main() {
  console.log("\n[SENTINEL] scoring unassessed orders…");
  const scored = await runSentinel();
  console.log(`  ${scored.length} order(s) assessed; ${scored.filter((s) => s.tier === "HOLD").length} held.`);

  console.log("\n[INTERCEPTOR] scanning for dispute precursors…");
  const watches = await runInterceptor();
  console.log(`  ${watches.length} watch(es) open.`);

  console.log("\n[ADVOCATE] assessing open disputes…");
  const decisions = await runAdvocate();
  console.log(
    `  ${decisions.length} assessed; ${decisions.filter((d) => d.recommendation === "FIGHT").length} to fight, ` +
      `${decisions.filter((d) => d.autoAccepted).length} auto-accepted.`,
  );

  // The Learner is the only agent that hard-depends on the model: a rule it
  // cannot propose must not take the rest of the loop down with it.
  console.log("\n[LEARNER] looking for repeated loss patterns…");
  try {
    const { proposed, reason } = await proposeRules();
    if (reason) console.log(`  ${reason}`);
    for (const r of proposed) console.log(`  proposed: ${r.plainEnglish}`);
  } catch (err) {
    console.warn(`  ! rule proposal unavailable: ${String(err).slice(0, 160)}`);
  }

  console.log("\n[METRICS]");
  console.table(await dashboardMetrics());
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
