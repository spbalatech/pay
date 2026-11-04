/**
 * The numbers the console leads with. Prevention is only credible if it is
 * counted, so deflections and defence are reported side by side.
 */
import { db } from "@/lib/db";
import { DISPUTE_FEE_USD } from "./ev";

export async function dashboardMetrics() {
  const [orders, holds, watches, deflected, disputes, resolved, accepted, activeRules, proposedRules] =
    await Promise.all([
      db.order.count(),
      db.riskAssessment.count({ where: { tier: "HOLD" } }),
      db.watch.count(),
      db.watch.findMany({ where: { status: "DEFLECTED" }, select: { amountAtRisk: true } }),
      db.dispute.count(),
      db.disputeAssessment.findMany({
        where: { outcome: { in: ["WON", "LOST", "ACCEPTED"] } },
        select: { outcome: true, dispute: { select: { amount: true } } },
      }),
      db.disputeAssessment.count({ where: { outcome: "ACCEPTED" } }),
      db.rule.count({ where: { status: "ACTIVE" } }),
      db.rule.count({ where: { status: "PROPOSED" } }),
    ]);

  const deflectedValue = deflected.reduce((s, w) => s + Number(w.amountAtRisk) + DISPUTE_FEE_USD, 0);
  const won = resolved.filter((r) => r.outcome === "WON");
  const lost = resolved.filter((r) => r.outcome === "LOST");
  const contested = won.length + lost.length;

  const retainedByDefence = won.reduce((s, r) => s + Number(r.dispute.amount) + DISPUTE_FEE_USD, 0);
  const escalated = await db.watch.count({ where: { status: "ESCALATED_TO_DISPUTE" } });
  // Same filter as the sidebar badge, so the two numbers always agree.
  const openDisputes = await db.dispute.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] } } });

  return {
    orders,
    ordersHeld: holds,
    watchesOpened: watches,
    disputesDeflected: deflected.length,
    deflectionRate: watches ? deflected.length / watches : null,
    valueDeflected: round2(deflectedValue),
    escalatedToDispute: escalated,
    disputes,
    openDisputes,
    disputesContested: contested,
    winRate: contested ? won.length / contested : null,
    disputesAccepted: accepted,
    valueRetainedByDefence: round2(retainedByDefence),
    totalValueProtected: round2(deflectedValue + retainedByDefence),
    activeRules,
    proposedRules,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
