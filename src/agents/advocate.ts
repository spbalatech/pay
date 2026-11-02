/**
 * ADVOCATE — dispute defence.
 *
 * For each filed dispute: reconstruct what actually happened from PayPal's
 * own records, check the evidence that matters for that reason code, compute
 * whether fighting is worth it in dollars, and draft the rebuttal. Accepting
 * is a real answer, not a failure — on small claims it is usually the correct
 * one, and saying so is the point.
 */
import { db, audit } from "@/lib/db";
import { policy } from "@/lib/env";
import { generate } from "@/lib/ai";
import { acceptDisputeClaim, getDispute } from "@/lib/paypal/api";
import { payerTransactionHistory, type PayerHistoryResult } from "@/lib/paypal/transport";
import {
  checklistFor,
  evidenceStrength,
  expectedValue,
  type EvidenceItem,
} from "./ev";
import type { Dispute, Order, Shipment } from "@prisma/client";

export type TimelineEvent = { at: string; what: string; source: string };

const REBUTTAL_SYSTEM = `You draft dispute rebuttals that a PayPal claims reviewer will read in under a minute.

Structure:
1. One sentence stating what the merchant is contesting and why.
2. A short numbered list of evidence, each item naming the record that proves it (tracking number, capture id, order id, delivery timestamp).
3. One closing sentence requesting the claim be denied.

Hard rules:
- Use ONLY the evidence marked found=true. Never assert anything not in the evidence list.
- Never invent tracking numbers, dates, signatures, or policy text.
- If the evidence is thin, write a shorter and more modest letter rather than an emphatic one.
- No emotion, no accusing the buyer of lying, no threats. Under 220 words.`;

/* -------------------------------------------------------------- evidence */

/** What PayPal's own transaction record says about this payer. */
export type PayerLedger = {
  available: boolean;
  reason?: string;
  priorSettled: number;
  priorRefunded: number;
  matchingAmountCount: number;
};

export function buildEvidence(
  dispute: Dispute,
  order: Order | null,
  shipments: Shipment[],
  payerPriorOrders: number,
  ledger: PayerLedger,
): EvidenceItem[] {
  const checklist = checklistFor(dispute.reasonCode);
  const delivered = shipments.find((s) => s.deliveredAt);
  const anyTracking = shipments[0];

  return checklist.map(({ kind, weight }) => {
    switch (kind) {
      case "TRACKING_EXISTS":
        return mk(kind, weight, !!anyTracking,
          anyTracking ? `Tracking ${anyTracking.trackingNumber} via ${anyTracking.carrier}.` : "No tracking on record.",
          anyTracking?.trackingNumber);

      case "TRACKING_DELIVERED":
        return mk(kind, weight, !!delivered?.deliveredAt,
          delivered?.deliveredAt ? `Carrier confirmed delivery ${delivered.deliveredAt.toISOString()}.` : "Carrier has not confirmed delivery.",
          delivered?.trackingNumber);

      case "DELIVERED_BEFORE_FILING":
        return mk(kind, weight, !!delivered?.deliveredAt && delivered.deliveredAt < dispute.filedAt,
          delivered?.deliveredAt
            ? `Delivered ${delivered.deliveredAt.toISOString().slice(0, 10)}, dispute filed ${dispute.filedAt.toISOString().slice(0, 10)}.`
            : "No delivery date to compare against the filing date.",
          delivered?.trackingNumber);

      case "SIGNATURE_ON_DELIVERY":
        return mk(kind, weight, !!delivered?.signatureRequired,
          delivered?.signatureRequired ? "Delivery required a signature." : "No signature confirmation.",
          delivered?.trackingNumber);

      case "SHIPPED_TO_ORDER_ADDRESS":
        return mk(kind, weight, !!order?.shippingLine1,
          order?.shippingLine1 ? `Shipped to the address on the order (${order.shippingLine1}).` : "Shipping address not on record.",
          order?.paypalOrderId);

      case "BILLING_SHIPPING_MATCH":
        return mk(kind, weight,
          !!order?.billingCountry && order.billingCountry === order.shippingCountry,
          order ? `Billing ${order.billingCountry ?? "?"} / shipping ${order.shippingCountry ?? "?"}.` : "No address data.",
          order?.paypalOrderId);

      case "PAYER_HAS_PRIOR_ORDERS":
        return mk(kind, weight, payerPriorOrders > 0,
          `${payerPriorOrders} prior order(s) from this payer.`,
          order?.payerId);

      case "PAYER_PAYMENT_HISTORY_AT_PAYPAL":
        if (!ledger.available) {
          return mk(kind, weight, false,
            `Transaction history unavailable: ${ledger.reason ?? "transaction search is off for this app"}.`);
        }
        return mk(kind, weight, ledger.priorSettled > 0 && ledger.priorRefunded === 0,
          ledger.priorSettled > 0
            ? `${ledger.priorSettled} settled payment(s) from this payer at PayPal, ${ledger.priorRefunded} refunded.`
            : "No prior settled payments from this payer at PayPal.",
          order?.payerEmail);

      case "SEPARATE_TRANSACTIONS_AT_PAYPAL":
        if (!ledger.available) {
          return mk(kind, weight, false,
            `Transaction history unavailable: ${ledger.reason ?? "transaction search is off for this app"}.`);
        }
        return mk(kind, weight, ledger.matchingAmountCount <= 1,
          ledger.matchingAmountCount <= 1
            ? "Only one transaction at PayPal matches this amount, so the charge was not duplicated."
            : `${ledger.matchingAmountCount} transactions at PayPal match this amount - the buyer may be right.`,
          order?.captureId);

      case "ITEM_DESCRIPTION_ON_ORDER":
        return mk(kind, weight, !!order && Array.isArray(order.items) && (order.items as unknown[]).length > 0,
          order && Array.isArray(order.items)
            ? `Order lists ${(order.items as Array<{ name?: string }>).map((i) => i.name).filter(Boolean).join(", ")}.`
            : "No itemisation on the order.",
          order?.paypalOrderId);

      case "DISTINCT_CAPTURE_IDS":
        return mk(kind, weight, !!order?.captureId,
          order?.captureId ? `This charge captured as ${order.captureId}.` : "No capture id on record.",
          order?.captureId);

      case "REFUND_RECORD_EXISTS":
      case "REFUND_COMPLETED":
      case "NO_RETURN_RECEIVED":
      case "BUYER_CONTACTED_MERCHANT_FIRST":
      case "REFUND_POLICY_DISCLOSED":
      case "DISTINCT_ORDER_CONTENTS":
      case "DISTINCT_ORDER_DATES":
      default:
        // Not derivable from the PayPal API alone. Reported as missing rather
        // than assumed, so the strength score stays honest.
        return mk(kind, weight, false, "Not available from PayPal records; merchant must supply.");
    }
  });
}

const mk = (
  kind: string,
  weight: number,
  found: boolean,
  detail: string,
  sourceRef?: string | null,
): EvidenceItem => ({ kind, weight, found, detail, sourceRef: sourceRef ?? undefined });

export function buildTimeline(order: Order | null, shipments: Shipment[], dispute: Dispute): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (order) {
    events.push({ at: order.createdAt.toISOString(), what: `Order ${order.paypalOrderId} placed for $${Number(order.amount).toFixed(2)}.`, source: "orders" });
    if (order.capturedAt) events.push({ at: order.capturedAt.toISOString(), what: `Payment captured (${order.captureId ?? "n/a"}).`, source: "payments" });
    if (order.promiseDate) events.push({ at: order.promiseDate.toISOString(), what: "Delivery promise date.", source: "merchant" });
  }

  for (const s of shipments) {
    if (s.shippedAt) events.push({ at: s.shippedAt.toISOString(), what: `Shipped via ${s.carrier} (${s.trackingNumber}).`, source: "shipment-tracking" });
    if (s.lastMovementAt) events.push({ at: s.lastMovementAt.toISOString(), what: `Last carrier scan: ${s.status}.`, source: "shipment-tracking" });
    if (s.deliveredAt) events.push({ at: s.deliveredAt.toISOString(), what: "Carrier marked delivered.", source: "shipment-tracking" });
  }

  events.push({ at: dispute.filedAt.toISOString(), what: `Buyer filed ${dispute.reasonCode} for $${Number(dispute.amount).toFixed(2)}.`, source: "disputes" });

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/* ------------------------------------------------------------- assessment */

export async function assessDispute(disputeId: string) {
  const dispute = await db.dispute.findUniqueOrThrow({
    where: { id: disputeId },
    include: { order: { include: { shipments: true } } },
  });

  const order = dispute.order;
  const shipments = order?.shipments ?? [];
  const priorOrders = order
    ? await db.order.count({ where: { payerId: order.payerId, createdAt: { lt: order.createdAt } } })
    : 0;

  const ledger = await payerLedger(order, dispute);
  const evidence = buildEvidence(dispute, order, shipments, priorOrders, ledger);
  const strength = evidenceStrength(evidence);
  const timeline = buildTimeline(order, shipments, dispute);
  const calibrated = await calibratedWinRate(dispute.reasonCode);

  const ev = expectedValue({
    claimAmount: Number(dispute.amount),
    reasonCode: dispute.reasonCode,
    evidenceStrength: strength,
    calibratedWinRate: calibrated,
  });

  const rebuttal = ev.recommendation === "FIGHT" ? await draftRebuttal(dispute, evidence, timeline) : null;

  const assessment = await db.disputeAssessment.upsert({
    where: { disputeId: dispute.id },
    create: {
      disputeId: dispute.id,
      pWin: ev.pWin,
      evFight: ev.evFight,
      evAccept: ev.evAccept,
      evidenceStrength: strength,
      evidence: evidence as unknown as object,
      timeline: timeline as unknown as object,
      recommendation: ev.recommendation,
      rebuttalDraft: rebuttal,
    },
    update: {
      pWin: ev.pWin,
      evFight: ev.evFight,
      evAccept: ev.evAccept,
      evidenceStrength: strength,
      evidence: evidence as unknown as object,
      timeline: timeline as unknown as object,
      recommendation: ev.recommendation,
      rebuttalDraft: rebuttal,
    },
  });

  await audit("ADVOCATE", "ASSESSED_DISPUTE", "Dispute", dispute.id, {
    reasonCode: dispute.reasonCode,
    amount: Number(dispute.amount),
    evidenceStrength: strength,
    pWin: ev.pWin,
    recommendation: ev.recommendation,
    explanation: ev.explanation,
  });

  return { assessment, ev };
}

/**
 * Reads PayPal's transaction record for this payer.
 *
 * Transaction Search is a per-app feature that is off by default, so an
 * unavailable ledger is a normal state: the evidence items that depend on it
 * are reported as missing, which lowers the evidence strength honestly rather
 * than failing the assessment or quietly pretending the checks passed.
 */
async function payerLedger(order: Order | null, dispute: Dispute): Promise<PayerLedger> {
  const empty = { available: false, priorSettled: 0, priorRefunded: 0, matchingAmountCount: 0 };
  if (!order) return { ...empty, reason: "dispute is not matched to an order" };

  const since = new Date(order.createdAt.getTime() - 180 * 86_400_000);
  const res: PayerHistoryResult = await payerTransactionHistory(order.payerEmail, since, order.createdAt);

  if (!res.available) return { ...empty, reason: res.reason };

  const claim = Number(dispute.amount);
  let priorSettled = 0;
  let priorRefunded = 0;
  let matchingAmountCount = 0;

  for (const t of res.transactions) {
    const info = t.transaction_info;
    const value = Math.abs(Number(info?.transaction_amount?.value ?? 0));
    const isRefund = value !== 0 && Number(info?.transaction_amount?.value ?? 0) < 0;

    if (isRefund) priorRefunded++;
    else if (info?.transaction_status === "S") priorSettled++;

    if (Math.abs(value - claim) < 0.01) matchingAmountCount++;
  }

  return { available: true, priorSettled, priorRefunded, matchingAmountCount };
}

/**
 * Per-merchant win rate observed on resolved disputes of this reason code.
 * Below 5 samples we stay with the documented prior rather than overfit.
 */
async function calibratedWinRate(reasonCode: string): Promise<number | undefined> {
  const resolved = await db.disputeAssessment.findMany({
    where: { outcome: { in: ["WON", "LOST"] }, dispute: { reasonCode } },
    select: { outcome: true },
  });

  if (resolved.length < 5) return undefined;
  return resolved.filter((r) => r.outcome === "WON").length / resolved.length;
}

async function draftRebuttal(dispute: Dispute, evidence: EvidenceItem[], timeline: TimelineEvent[]) {
  const found = evidence.filter((e) => e.found);
  if (found.length === 0) return null;

  try {
    return await generate({
      tier: "reasoning",
      maxTokens: 700,
      system: REBUTTAL_SYSTEM,
      prompt:
        `Dispute ${dispute.paypalDisputeId}\n` +
        `Reason code: ${dispute.reasonCode}\n` +
        `Claim: $${Number(dispute.amount).toFixed(2)} ${dispute.currency}\n` +
        `Buyer's stated reason: ${dispute.buyerNote ?? "(none given)"}\n\n` +
        `Evidence we hold (found=true only):\n` +
        found.map((e) => `- ${e.kind}: ${e.detail}${e.sourceRef ? ` [ref ${e.sourceRef}]` : ""}`).join("\n") +
        `\n\nEvidence we do NOT hold:\n` +
        evidence.filter((e) => !e.found).map((e) => `- ${e.kind}`).join("\n") +
        `\n\nOrder timeline:\n` +
        timeline.map((t) => `- ${t.at}: ${t.what}`).join("\n") +
        `\n\nDraft the rebuttal.`,
    });
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- execution */

/**
 * Carries out the decision. Only auto-executes an ACCEPT under the merchant's
 * ceiling; a FIGHT always needs a human, because the rebuttal goes out in the
 * merchant's name.
 */
export async function executeDecision(
  disputeId: string,
  decision: "FIGHT" | "ACCEPT",
  actor: string,
) {
  const dispute = await db.dispute.findUniqueOrThrow({
    where: { id: disputeId },
    include: { assessment: true },
  });

  if (decision === "ACCEPT") {
    if (dispute.source === "LIVE_SANDBOX") {
      // Which actions are legal changes with the dispute's lifecycle stage,
      // so PayPal's current answer is checked rather than assumed.
      const live = await getDispute(dispute.paypalDisputeId);
      const allowed = live.allowed_response_options?.allowed_response_options;
      if (allowed && !allowed.includes("ACCEPT_CLAIM")) {
        throw new Error(
          `PayPal does not currently allow ACCEPT_CLAIM on ${dispute.paypalDisputeId} ` +
            `(stage ${live.dispute_life_cycle_stage ?? "unknown"}; allowed: ${allowed.join(", ")}).`,
        );
      }

      await acceptDisputeClaim(
        dispute.paypalDisputeId,
        "Accepting the claim; refund issued to the buyer.",
        { value: Number(dispute.amount).toFixed(2), currency: dispute.currency },
      );
    }

    await db.disputeAssessment.update({
      where: { disputeId: dispute.id },
      data: {
        decision: "ACCEPT",
        decisionStatus: "EXECUTED",
        decidedBy: actor,
        executedAt: new Date(),
        outcome: "ACCEPTED",
        outcomeAt: new Date(),
      },
    });
  } else {
    await db.disputeAssessment.update({
      where: { disputeId: dispute.id },
      data: {
        decision: "FIGHT",
        decisionStatus: "EXECUTED",
        decidedBy: actor,
        executedAt: new Date(),
      },
    });
  }

  await audit(actor, `EXECUTED_${decision}`, "Dispute", dispute.id, {
    amount: Number(dispute.amount),
    reasonCode: dispute.reasonCode,
    source: dispute.source,
  });

  return db.dispute.findUniqueOrThrow({ where: { id: dispute.id }, include: { assessment: true } });
}

/**
 * Assess every open dispute.
 *
 * PayPal's own integration guidance is explicit: never automatically accept a
 * dispute claim without review. So auto-accept ships DISABLED
 * (AEGIS_AUTO_ACCEPT_CEILING_USD=0) and a merchant who wants it must set a
 * ceiling themselves. With it off, the Advocate still does all the work -
 * evidence, expected value, a recommendation and a drafted rebuttal - and a
 * human presses the button. That is the intended shape of the product; the
 * agent removes the 40 minutes of assembly, not the decision.
 */
export async function runAdvocate() {
  const { autoAcceptCeiling } = policy();

  const open = await db.dispute.findMany({
    where: { status: { notIn: ["RESOLVED", "CLOSED"] } },
    orderBy: { responseDueAt: "asc" },
  });

  const results = [];
  for (const d of open) {
    const { assessment, ev } = await assessDispute(d.id);

    const shouldAutoAccept =
      autoAcceptCeiling > 0 &&
      ev.recommendation === "ACCEPT" &&
      Number(d.amount) <= autoAcceptCeiling &&
      assessment.decisionStatus === "PROPOSED";

    if (shouldAutoAccept) {
      await executeDecision(d.id, "ACCEPT", "ADVOCATE");
    }

    results.push({ disputeId: d.id, recommendation: ev.recommendation, autoAccepted: shouldAutoAccept });
  }

  return results;
}
