"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { executeIntervention } from "@/agents/interceptor";
import { executeDecision } from "@/agents/advocate";
import { approveRule, rejectRule, proposeRules } from "@/agents/learner";
import { runSentinel } from "@/agents/sentinel";
import { runInterceptor } from "@/agents/interceptor";
import { runAdvocate } from "@/agents/advocate";

/** Humans act as themselves in the audit log; the demo signs as the operator. */
const OPERATOR = "human:operator";

export async function approveInterventionAction(interventionId: string) {
  await executeIntervention(interventionId, OPERATOR);
  revalidatePath("/watchlist");
  revalidatePath("/");
}

export async function dismissWatchAction(watchId: string) {
  await db.watch.update({
    where: { id: watchId },
    data: { status: "DISMISSED", resolvedAt: new Date() },
  });
  revalidatePath("/watchlist");
  revalidatePath("/");
}

/**
 * Returns PayPal's refusal as a message rather than throwing: a live case can
 * be refused (wrong stage, evidence PayPal asks for that we lack), and the
 * operator needs to read why. Next.js hides thrown messages in production.
 */
export async function decideDisputeAction(
  disputeId: string,
  decision: "FIGHT" | "ACCEPT",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await executeDecision(disputeId, decision, OPERATOR);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath("/disputes");
  revalidatePath("/");
  return { ok: true };
}

export async function approveRuleAction(ruleId: string) {
  await approveRule(ruleId, OPERATOR);
  revalidatePath("/rulebook");
  revalidatePath("/");
}

export async function rejectRuleAction(ruleId: string) {
  await rejectRule(ruleId, OPERATOR);
  revalidatePath("/rulebook");
}

export async function proposeRulesAction() {
  const { proposed, reason } = await proposeRules();
  revalidatePath("/rulebook");
  return { count: proposed.length, reason };
}

export async function runLoopAction() {
  const scored = await runSentinel();
  const watches = await runInterceptor();
  const decisions = await runAdvocate();
  revalidatePath("/");
  revalidatePath("/orders");
  revalidatePath("/watchlist");
  revalidatePath("/disputes");
  return { scored: scored.length, watches: watches.length, decisions: decisions.length };
}

export async function overrideOrderAction(orderId: string, recommendation: "SHIP" | "HOLD") {
  await db.riskAssessment.update({
    where: { orderId },
    data: { recommendation, decision: "HUMAN_APPROVED", decidedBy: OPERATOR, decidedAt: new Date() },
  });
  await db.auditLog.create({
    data: {
      actor: OPERATOR,
      action: "OVERRODE_RECOMMENDATION",
      targetType: "Order",
      targetId: orderId,
      payload: { recommendation },
    },
  });
  revalidatePath("/orders");
}
