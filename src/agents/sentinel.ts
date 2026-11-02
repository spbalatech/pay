/**
 * SENTINEL — pre-fulfillment dispute-risk assessment.
 *
 * Runs on every new order before it ships. The score is deterministic
 * (see signals.ts); the LLM's job is to turn the signals that fired into a
 * sentence a merchant can act on, and nothing else.
 */
import { db, audit } from "@/lib/db";
import { policy } from "@/lib/env";
import { generate } from "@/lib/ai";
import {
  scoreOrder,
  tierFor,
  recommendationFor,
  predictedReasonCodes,
  type OrderFacts,
  type PayerHistory,
  type Signal,
} from "./signals";
import { matchRules, type ActiveRule } from "./rules";
import type { Order } from "@prisma/client";

const SYSTEM = `You explain dispute-risk decisions to a small-business merchant.

You are given an order and the list of risk signals that fired, each with a
weight. Write 2-3 sentences explaining the recommendation.

Rules:
- Only cite signals in the list. Never invent a signal, a number, or a score.
- Lead with the single heaviest signal.
- Plain language. No jargon, no hedging, no bullet points.
- If the recommendation is HOLD, say concretely what the merchant should verify.`;

export async function assessOrder(order: Order, opts: { actor?: string } = {}) {
  const facts = await orderFacts(order);
  const payer = await payerHistory(order.payerId, order.createdAt);
  const { score, signals } = scoreOrder(facts, payer);

  const activeRules = await loadActiveRules();
  const matched = matchRules(activeRules, facts, payer);

  // A matched prevention rule is a hard override: the merchant approved it.
  const effectiveScore = matched.length > 0 ? Math.max(score, policy().holdThreshold) : score;
  const tier = tierFor(effectiveScore, policy().holdThreshold);
  const reasonCodes = predictedReasonCodes(signals);

  const narrative = await explain(order, effectiveScore, tier, signals, matched);

  const assessment = await db.riskAssessment.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      score: effectiveScore,
      tier,
      signals: signals as unknown as object,
      predictedReasonCodes: reasonCodes,
      narrative,
      recommendation: recommendationFor(tier),
      matchedRuleIds: matched.map((r) => r.id),
    },
    update: {
      score: effectiveScore,
      tier,
      signals: signals as unknown as object,
      predictedReasonCodes: reasonCodes,
      narrative,
      recommendation: recommendationFor(tier),
      matchedRuleIds: matched.map((r) => r.id),
    },
  });

  if (matched.length > 0) {
    await db.rule.updateMany({
      where: { id: { in: matched.map((r) => r.id) } },
      data: { observedMatches: { increment: 1 } },
    });
  }

  await audit(opts.actor ?? "SENTINEL", "ASSESSED_ORDER", "Order", order.id, {
    score: effectiveScore,
    tier,
    signalCodes: signals.map((s) => s.code),
    matchedRuleIds: matched.map((r) => r.id),
  });

  return assessment;
}

async function explain(
  order: Order,
  score: number,
  tier: string,
  signals: Signal[],
  matched: ActiveRule[],
) {
  const fired = signals
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((s) => `- ${s.code} (+${s.weight}): ${s.detail}`)
    .join("\n");

  const ruleLines = matched.length
    ? `\nMerchant-approved prevention rules this order matched:\n${matched
        .map((r) => `- ${r.plainEnglish}`)
        .join("\n")}`
    : "";

  try {
    return await generate({
      tier: "fast",
      maxTokens: 350,
      system: SYSTEM,
      prompt:
        `Order ${order.paypalOrderId}: $${order.amount} ${order.currency}, ` +
        `payer ${order.payerEmail}.\n` +
        `Risk score ${score}/100 → ${tier}.\n\n` +
        `Signals that fired:\n${fired || "- none"}${ruleLines}`,
    });
  } catch (err) {
    // A narrative is presentation; never let it block the decision.
    const top = signals.filter((s) => s.weight > 0).sort((a, b) => b.weight - a.weight)[0];
    return top
      ? `${tier} (${score}/100). Primary signal: ${top.detail}`
      : `${tier} (${score}/100). No elevated signals.`;
  }
}

async function orderFacts(order: Order): Promise<OrderFacts> {
  const agg = await db.order.aggregate({ _avg: { amount: true } });
  const items = Array.isArray(order.items) ? (order.items as Array<{ category?: string }>) : [];

  return {
    amount: Number(order.amount),
    currency: order.currency,
    billingCountry: order.billingCountry,
    shippingCountry: order.shippingCountry,
    shippingLine1: order.shippingLine1,
    shippingIsMultiUnit: order.shippingIsMultiUnit,
    rushShipping: order.rushShipping,
    createdAt: order.createdAt,
    itemCategories: items.map((i) => i.category ?? "UNKNOWN"),
    merchantAverageOrderValue: Number(agg._avg.amount ?? 0),
  };
}

async function payerHistory(payerId: string, before: Date): Promise<PayerHistory> {
  const [orders, refunds, disputes, recent] = await Promise.all([
    db.order.findMany({
      where: { payerId, createdAt: { lt: before } },
      select: { amount: true, createdAt: true },
    }),
    db.transaction.count({ where: { payerId, kind: "REFUND", occurredAt: { lt: before } } }),
    db.dispute.count({ where: { order: { payerId }, filedAt: { lt: before } } }),
    db.order.count({
      where: { payerId, createdAt: { lt: before, gte: new Date(before.getTime() - 86_400_000) } },
    }),
  ]);

  return {
    orderCount: orders.length,
    refundCount: refunds,
    disputeCount: disputes,
    firstSeenAt: orders.length ? orders.reduce((a, o) => (o.createdAt < a ? o.createdAt : a), orders[0].createdAt) : null,
    totalSpend: orders.reduce((s, o) => s + Number(o.amount), 0),
    ordersLast24h: recent,
  };
}

async function loadActiveRules(): Promise<ActiveRule[]> {
  const rules = await db.rule.findMany({ where: { status: "ACTIVE" } });
  return rules.map((r) => ({
    id: r.id,
    plainEnglish: r.plainEnglish,
    action: r.action,
    condition: r.condition as ActiveRule["condition"],
  }));
}

/** Score every order that has no assessment yet. */
export async function runSentinel(limit = 100) {
  const orders = await db.order.findMany({
    where: { risk: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const results = [];
  for (const order of orders) results.push(await assessOrder(order));
  return results;
}
