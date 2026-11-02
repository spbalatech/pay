/**
 * INTERCEPTOR — pre-dispute deflection.
 *
 * This is the layer a fraud engine cannot be: it watches the order lifecycle
 * *after* payment, where most chargebacks are actually born. The majority of
 * disputes are not stolen cards, they are service failures and friendly
 * fraud — a parcel that stopped moving, a subscription the buyer forgot, a
 * duplicate charge, an unrecognised descriptor. Each has a window where the
 * buyer is still annoyed at the merchant and has not yet called their bank.
 * Intervening inside that window is the cheapest dispute prevention there is.
 *
 * Detection is deterministic. The LLM drafts the outreach and never decides
 * whether to spend money — that is policy plus the EV engine.
 */
import { db, audit } from "@/lib/db";
import { policy } from "@/lib/env";
import { generate } from "@/lib/ai";
import { createRefund } from "@/lib/paypal/api";
import { DISPUTE_FEE_USD } from "./ev";
import type { Order, Shipment, Subscription } from "@prisma/client";

const STALLED_DAYS = 5;
const DORMANT_DAYS = 60;
const SILENT_HIGH_VALUE_USD = 400;

/**
 * Past this many days late there is nothing left to deflect: the buyer has
 * either already filed, already been refunded, or quietly moved on. Alerting
 * anyway is how a prevention queue becomes noise a merchant stops reading.
 */
const INTERVENTION_WINDOW_DAYS = 35;
const MIN_LATE_DAYS = 2;

export type Precursor = {
  code:
    | "STALLED_TRACKING"
    | "PAST_PROMISE_DATE"
    | "NO_TRACKING"
    | "DORMANT_RENEWAL"
    | "DUPLICATE_CHARGE"
    | "SILENT_HIGH_VALUE";
  severity: number; // 0-100
  predictedReasonCode: string;
  rationale: string;
  amountAtRisk: number;
};

const days = (ms: number) => ms / 86_400_000;

/* ------------------------------------------------------------- detectors */

/**
 * Returns at most ONE shipment precursor per order, the most specific one
 * that applies. An order with no tracking is not also "late" — it is
 * untracked, and that is the thing to act on. Emitting every technically
 * true signal buries the merchant.
 */
export function detectShipmentPrecursors(
  order: Order,
  shipments: Shipment[],
  now = new Date(),
): Precursor[] {
  const amount = Number(order.amount);
  const lateDays = order.promiseDate
    ? Math.floor(days(now.getTime() - order.promiseDate.getTime()))
    : null;
  const withinWindow =
    lateDays !== null && lateDays >= MIN_LATE_DAYS && lateDays <= INTERVENTION_WINDOW_DAYS;

  const delivered = shipments.find((s) => s.deliveredAt);

  // Delivered: the only remaining risk is a quiet, expensive order.
  if (delivered?.deliveredAt) {
    const since = Math.floor(days(now.getTime() - delivered.deliveredAt.getTime()));
    if (amount >= SILENT_HIGH_VALUE_USD && since >= 3 && since <= 25) {
      return [
        {
          code: "SILENT_HIGH_VALUE",
          severity: 45,
          predictedReasonCode: "SIGNIFICANTLY_NOT_AS_DESCRIBED",
          rationale: `$${amount.toFixed(2)} order delivered ${since} days ago with no buyer contact. High-value silence precedes "not as described" claims.`,
          amountAtRisk: amount,
        },
      ];
    }
    return [];
  }

  // Undelivered and nothing shipped: the buyer cannot see anything at all.
  if (shipments.length === 0) {
    if (!withinWindow) return [];
    return [
      {
        code: "NO_TRACKING",
        severity: Math.min(90, 40 + lateDays! * 5),
        predictedReasonCode: "ITEM_NOT_RECEIVED",
        rationale: `No tracking on record and the delivery promise date passed ${lateDays} day(s) ago. The buyer has no way to see where their order is.`,
        amountAtRisk: amount,
      },
    ];
  }

  // Shipped but stuck: a stall outranks simple lateness, because the parcel
  // is the problem rather than the schedule.
  const stalls = shipments
    .filter((s) => !s.deliveredAt)
    .map((s) => {
      const lastMovement = s.lastMovementAt ?? s.shippedAt;
      return {
        shipment: s,
        stalled: lastMovement ? Math.floor(days(now.getTime() - lastMovement.getTime())) : null,
      };
    })
    .filter((x) => x.stalled !== null && x.stalled >= STALLED_DAYS)
    .sort((a, b) => b.stalled! - a.stalled!);

  if (stalls.length > 0) {
    const { shipment, stalled } = stalls[0];
    if (stalled! > INTERVENTION_WINDOW_DAYS + 14) return [];
    return [
      {
        code: "STALLED_TRACKING",
        severity: Math.min(90, 35 + stalled! * 4),
        predictedReasonCode: "ITEM_NOT_RECEIVED",
        rationale: `Tracking ${shipment.trackingNumber} (${shipment.carrier}) has not moved in ${stalled} days; last status ${shipment.status}.`,
        amountAtRisk: amount,
      },
    ];
  }

  // Moving, just late. The mildest case, and scored like it.
  if (withinWindow) {
    return [
      {
        code: "PAST_PROMISE_DATE",
        severity: Math.min(65, 25 + lateDays! * 3),
        predictedReasonCode: "ITEM_NOT_RECEIVED",
        rationale: `Promised by ${order.promiseDate!.toISOString().slice(0, 10)}, still in transit ${lateDays} day(s) later.`,
        amountAtRisk: amount,
      },
    ];
  }

  return [];
}

export function detectDormantRenewal(sub: Subscription, now = new Date()): Precursor | null {
  if (sub.status !== "ACTIVE" || !sub.lastRenewedAt) return null;

  const dormant = sub.lastBuyerActivityAt
    ? Math.floor(days(now.getTime() - sub.lastBuyerActivityAt.getTime()))
    : Math.floor(days(now.getTime() - sub.startedAt.getTime()));

  if (dormant < DORMANT_DAYS) return null;

  return {
    code: "DORMANT_RENEWAL",
    severity: Math.min(85, 35 + Math.floor(dormant / 15) * 8),
    predictedReasonCode: "UNAUTHORIZED",
    rationale: `${sub.planName} renewed at $${Number(sub.amount).toFixed(2)} after ${dormant} days of no buyer activity. Forgotten subscriptions are filed as "unauthorized", not "cancel my plan".`,
    amountAtRisk: Number(sub.amount),
  };
}

/** Near-identical captures from one payer inside a short window. */
export async function detectDuplicateCharges(windowMinutes = 180): Promise<Array<{ order: Order; precursor: Precursor }>> {
  const orders = await db.order.findMany({
    where: { capturedAt: { not: null } },
    orderBy: { capturedAt: "asc" },
  });

  const byPayer = new Map<string, Order[]>();
  for (const o of orders) {
    const list = byPayer.get(o.payerId) ?? [];
    list.push(o);
    byPayer.set(o.payerId, list);
  }

  const hits: Array<{ order: Order; precursor: Precursor }> = [];

  for (const list of byPayer.values()) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      if (!prev.capturedAt || !curr.capturedAt) continue;

      const gapMinutes = (curr.capturedAt.getTime() - prev.capturedAt.getTime()) / 60_000;
      const sameAmount = Math.abs(Number(curr.amount) - Number(prev.amount)) < 0.01;

      if (gapMinutes <= windowMinutes && sameAmount) {
        hits.push({
          order: curr,
          precursor: {
            code: "DUPLICATE_CHARGE",
            severity: 80,
            predictedReasonCode: "DUPLICATE",
            rationale: `$${Number(curr.amount).toFixed(2)} charged twice to ${curr.payerEmail} ${Math.round(gapMinutes)} minutes apart (orders ${prev.paypalOrderId}, ${curr.paypalOrderId}). Almost certainly a double submit.`,
            amountAtRisk: Number(curr.amount),
          },
        });
      }
    }
  }

  return hits;
}

/* ------------------------------------------------------------ intervention */

const OUTREACH_SYSTEM = `You write short customer-service messages for a small business, sent before the customer complains.

Constraints:
- 60-90 words. No subject line unless asked. No greeting placeholders like [Name] — use the name given.
- Acknowledge the specific problem using only the facts provided. Never invent a delivery date, a refund amount, a tracking number or a cause.
- Offer one concrete next step.
- Warm and direct. No corporate filler, no apologising twice, no "we value your business".
- Never mention disputes, chargebacks, banks, or that the customer was flagged by a system.`;

/**
 * Chooses the intervention. A preemptive refund is only proposed when the
 * dispute is more expensive than the order — and only auto-executes under the
 * merchant's own ceiling. Everything above it waits for a human.
 */
export function chooseIntervention(p: Precursor): {
  kind: "OUTREACH" | "TRACKING_RESEND" | "PREEMPTIVE_REFUND" | "SUBSCRIPTION_PAUSE";
  autoApprove: boolean;
  reason: string;
} {
  const { autoRefundCeiling } = policy();
  const disputeCost = p.amountAtRisk + DISPUTE_FEE_USD;

  if (p.code === "DUPLICATE_CHARGE") {
    return {
      kind: "PREEMPTIVE_REFUND",
      autoApprove: p.amountAtRisk <= autoRefundCeiling,
      reason: `A duplicate charge has no defence. Refunding now costs $${p.amountAtRisk.toFixed(2)}; losing the dispute costs $${disputeCost.toFixed(2)} plus the fee.`,
    };
  }

  if (p.code === "DORMANT_RENEWAL") {
    return {
      kind: "SUBSCRIPTION_PAUSE",
      autoApprove: false,
      reason: "Pausing and asking beats a forced refund plus a dispute fee, but it changes the customer's plan — a human should approve.",
    };
  }

  if (p.code === "STALLED_TRACKING" && p.severity >= 80 && p.amountAtRisk <= autoRefundCeiling) {
    return {
      kind: "PREEMPTIVE_REFUND",
      autoApprove: true,
      reason: `Parcel is unlikely to arrive and the order is under the $${autoRefundCeiling} auto-refund ceiling.`,
    };
  }

  if (p.code === "NO_TRACKING" || p.code === "PAST_PROMISE_DATE") {
    return {
      kind: "TRACKING_RESEND",
      autoApprove: true,
      reason: "The buyer mostly needs to know where their order is.",
    };
  }

  return {
    kind: "OUTREACH",
    autoApprove: true,
    reason: "Open the conversation before the buyer opens a case.",
  };
}

export async function openWatch(order: Order, p: Precursor) {
  const watch = await db.watch.upsert({
    where: { orderId_precursor: { orderId: order.id, precursor: p.code } },
    create: {
      orderId: order.id,
      precursor: p.code,
      severity: p.severity,
      predictedReasonCode: p.predictedReasonCode,
      amountAtRisk: p.amountAtRisk,
      rationale: p.rationale,
    },
    update: { severity: p.severity, rationale: p.rationale },
  });

  const existing = await db.intervention.count({ where: { watchId: watch.id } });
  if (existing > 0) return watch;

  const choice = chooseIntervention(p);
  const draft =
    choice.kind === "SUBSCRIPTION_PAUSE" || choice.kind === "OUTREACH" || choice.kind === "TRACKING_RESEND"
      ? await draftOutreach(order, p, choice.kind)
      : null;

  await db.intervention.create({
    data: {
      watchId: watch.id,
      kind: choice.kind,
      status: choice.autoApprove ? "AUTO_APPROVED" : "PROPOSED",
      payload: {
        reason: choice.reason,
        message: draft,
        refundAmount: choice.kind === "PREEMPTIVE_REFUND" ? p.amountAtRisk : undefined,
        recipient: order.payerEmail,
      },
    },
  });

  await audit("INTERCEPTOR", "OPENED_WATCH", "Order", order.id, {
    precursor: p.code,
    severity: p.severity,
    intervention: choice.kind,
    autoApproved: choice.autoApprove,
  });

  return watch;
}

async function draftOutreach(order: Order, p: Precursor, kind: string) {
  try {
    return await generate({
      tier: "fast",
      maxTokens: 300,
      system: OUTREACH_SYSTEM,
      prompt:
        `Customer: ${order.payerEmail}\n` +
        `Order: ${order.paypalOrderId}, $${Number(order.amount).toFixed(2)} ${order.currency}, placed ${order.createdAt.toISOString().slice(0, 10)}\n` +
        `Situation: ${p.rationale}\n` +
        `Intended action: ${kind}\n\n` +
        `Write the message.`,
    });
  } catch {
    return null;
  }
}

/** Executes an approved intervention against the real PayPal API. */
export async function executeIntervention(interventionId: string, actor: string) {
  const intervention = await db.intervention.findUniqueOrThrow({
    where: { id: interventionId },
    include: { watch: { include: { order: true } } },
  });

  if (intervention.status === "EXECUTED") return intervention;

  const payload = intervention.payload as { refundAmount?: number; message?: string };
  const order = intervention.watch.order;
  let result: unknown = { note: "Message queued for delivery." };

  try {
    if (intervention.kind === "PREEMPTIVE_REFUND") {
      const captureId = order.captureId;
      if (!captureId) throw new Error("Order has no capture id; cannot refund.");

      const amount = {
        value: (payload.refundAmount ?? Number(order.amount)).toFixed(2),
        currency: order.currency,
      };

      if (order.source === "LIVE_SANDBOX") {
        result = await createRefund(
          captureId,
          amount,
          "Refunded proactively by Aegis before a dispute was filed.",
        );
      } else {
        // The capture id on a SIMULATED order is locally generated, so there is
        // nothing at PayPal to refund. Recorded as skipped rather than faked.
        result = {
          skipped: "SIMULATED_ORDER",
          note: "No live capture exists for this fixture; refund not sent to PayPal.",
          wouldHaveRefunded: amount,
        };
      }
    }

    const updated = await db.intervention.update({
      where: { id: interventionId },
      data: { status: "EXECUTED", executedAt: new Date(), approvedBy: actor, result: result as object },
    });

    await db.watch.update({
      where: { id: intervention.watchId },
      data: { status: "DEFLECTED", resolvedAt: new Date() },
    });

    await audit(actor, "EXECUTED_INTERVENTION", "Watch", intervention.watchId, {
      kind: intervention.kind,
      amountAtRisk: Number(intervention.watch.amountAtRisk),
    });

    return updated;
  } catch (err) {
    await db.intervention.update({
      where: { id: interventionId },
      data: { status: "FAILED", result: { error: String(err) } },
    });
    throw err;
  }
}

/** Full sweep: find every precursor and open watches for them. */
export async function runInterceptor(now = new Date()) {
  const opened: string[] = [];

  const orders = await db.order.findMany({
    where: { status: { in: ["COMPLETED", "CAPTURED", "APPROVED"] } },
    include: { shipments: true },
  });

  for (const order of orders) {
    for (const p of detectShipmentPrecursors(order, order.shipments, now)) {
      const w = await openWatch(order, p);
      opened.push(w.id);
    }
  }

  for (const { order, precursor } of await detectDuplicateCharges()) {
    const w = await openWatch(order, precursor);
    opened.push(w.id);
  }

  const subs = await db.subscription.findMany({ where: { status: "ACTIVE" } });

  for (const sub of subs) {
    const p = detectDormantRenewal(sub, now);
    if (!p) continue;

    // Attach the subscription precursor to that payer's most recent order so
    // it shares the order-centric watch model.
    const order = await db.order.findFirst({
      where: { payerId: sub.payerId },
      orderBy: { createdAt: "desc" },
    });
    if (order) {
      const w = await openWatch(order, p);
      opened.push(w.id);
    }
  }

  // Carry out what policy already approved. Without this the auto-approval
  // ceiling would be decorative: a proposal nobody executes deflects nothing.
  const ready = await db.intervention.findMany({
    where: { status: "AUTO_APPROVED" },
    select: { id: true },
  });

  for (const { id } of ready) {
    try {
      await executeIntervention(id, "INTERCEPTOR");
    } catch (err) {
      // executeIntervention already recorded the failure on the row.
      console.warn(`  ! intervention ${id} failed: ${String(err).slice(0, 120)}`);
    }
  }

  return opened;
}
