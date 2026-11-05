/**
 * Webhook event handlers.
 *
 * This is the path a production dispute takes into Aegis. Each handler is
 * idempotent at the domain level too, not just at the event level: PayPal
 * retries for up to three days until it sees a 200, and an event that
 * arrives twice must not create two disputes or two transactions.
 */
import { db, audit } from "@/lib/db";
import { getDispute } from "@/lib/paypal/api";
import { assessDispute } from "./advocate";
import { normalizeReason } from "./ev";

type Envelope = {
  id: string;
  event_type: string;
  resource_type?: string;
  summary?: string;
  resource?: Record<string, unknown>;
};

export async function handleEvent(event: Envelope): Promise<string> {
  switch (event.event_type) {
    case "CUSTOMER.DISPUTE.CREATED":
      return disputeCreated(event);
    case "CUSTOMER.DISPUTE.RESOLVED":
    case "CUSTOMER.DISPUTE.UPDATED":
      return disputeChanged(event);
    case "PAYMENT.CAPTURE.COMPLETED":
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.SALE.COMPLETED":
      return captureEvent(event);
    case "BILLING.SUBSCRIPTION.ACTIVATED":
    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.SUSPENDED":
    case "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
      return subscriptionEvent(event);
    default:
      return `ignored ${event.event_type}`;
  }
}

/* ---------------------------------------------------------------- disputes */

async function disputeCreated(event: Envelope): Promise<string> {
  const resource = event.resource as
    | {
        dispute_id?: string;
        reason?: string;
        status?: string;
        dispute_life_cycle_stage?: string;
        dispute_amount?: { value?: string; currency_code?: string };
        seller_response_due_date?: string;
        create_time?: string;
        messages?: Array<{ content?: string; posted_by?: string }>;
        disputed_transactions?: Array<{ seller_transaction_id?: string }>;
      }
    | undefined;

  const disputeId = resource?.dispute_id;
  if (!disputeId) return "no dispute_id in payload";

  const existing = await db.dispute.findUnique({ where: { paypalDisputeId: disputeId } });
  if (existing) return `dispute ${disputeId} already known`;

  // The webhook payload is a summary. Fetch the full record before acting:
  // PayPal's own guidance is to review a dispute via GET before any decision.
  let full = resource;
  try {
    full = { ...resource, ...(await getDispute(disputeId)) } as typeof resource;
  } catch {
    /* fall back to the payload we were handed */
  }

  const captureId = full?.disputed_transactions?.[0]?.seller_transaction_id;
  const order = captureId ? await db.order.findFirst({ where: { captureId } }) : null;

  const buyerNote =
    full?.messages?.find((m) => m.posted_by === "BUYER")?.content ??
    full?.messages?.[0]?.content ??
    null;

  const dispute = await db.dispute.create({
    data: {
      paypalDisputeId: disputeId,
      orderId: order?.id ?? null,
      reasonCode: normalizeReason(full?.reason),
      status: full?.status ?? "OPEN",
      lifeCycleStage: full?.dispute_life_cycle_stage ?? null,
      amount: Number(full?.dispute_amount?.value ?? 0),
      currency: full?.dispute_amount?.currency_code ?? "USD",
      buyerNote,
      filedAt: full?.create_time ? new Date(full.create_time) : new Date(),
      responseDueAt: full?.seller_response_due_date
        ? new Date(full.seller_response_due_date)
        : null,
      source: "LIVE_SANDBOX",
    },
  });

  // A watch on the same order predicted this and failed to prevent it. Saying
  // so is what lets the deflection rate mean anything.
  if (order) {
    await db.watch.updateMany({
      where: { orderId: order.id, status: "OPEN" },
      data: { status: "ESCALATED_TO_DISPUTE", resolvedAt: new Date() },
    });
  }

  await audit("WEBHOOK", "DISPUTE_RECEIVED", "Dispute", dispute.id, {
    paypalDisputeId: disputeId,
    reasonCode: dispute.reasonCode,
    matchedOrder: order?.paypalOrderId ?? null,
  });

  await assessDispute(dispute.id);
  return `dispute ${disputeId} ingested and assessed`;
}

async function disputeChanged(event: Envelope): Promise<string> {
  const resource = event.resource as
    | { dispute_id?: string; status?: string; dispute_life_cycle_stage?: string; dispute_outcome?: { outcome_code?: string } }
    | undefined;

  const disputeId = resource?.dispute_id;
  if (!disputeId) return "no dispute_id in payload";

  const dispute = await db.dispute.findUnique({
    where: { paypalDisputeId: disputeId },
    include: { assessment: true },
  });
  if (!dispute) return `dispute ${disputeId} not known; ignoring`;

  await db.dispute.update({
    where: { id: dispute.id },
    data: {
      status: resource?.status ?? dispute.status,
      lifeCycleStage: resource?.dispute_life_cycle_stage ?? dispute.lifeCycleStage,
    },
  });

  await recordDisputeOutcome(dispute.id, resource?.dispute_outcome?.outcome_code, "WEBHOOK");

  return `dispute ${disputeId} updated`;
}

/**
 * The outcome is what the Learner trains on, so it is recorded the moment
 * PayPal reports it rather than inferred later. Shared by the webhook path
 * and the sync, so a result is learned from whichever sees it first.
 */
export async function recordDisputeOutcome(disputeId: string, code: string | undefined, actor: string) {
  if (!code) return null;
  const assessment = await db.disputeAssessment.findUnique({ where: { disputeId } });
  if (!assessment || assessment.outcome !== "PENDING") return null;

  const outcome =
    code === "RESOLVED_SELLER_FAVOUR" || code === "RESOLVED_SELLER_FAVOR"
      ? "WON"
      : code === "RESOLVED_BUYER_FAVOUR" || code === "RESOLVED_BUYER_FAVOR"
        ? "LOST"
        : assessment.decision === "ACCEPT"
          ? "ACCEPTED"
          : null;
  if (!outcome) return null;

  await db.disputeAssessment.update({
    where: { disputeId },
    data: { outcome, outcomeAt: new Date() },
  });
  await audit(actor, `DISPUTE_${outcome}`, "Dispute", disputeId, { code });
  return outcome;
}

/* ------------------------------------------------------------- payments */

async function captureEvent(event: Envelope): Promise<string> {
  const resource = event.resource as
    | { id?: string; amount?: { value?: string; currency_code?: string }; status?: string; create_time?: string }
    | undefined;

  const txId = resource?.id;
  if (!txId) return "no capture id in payload";

  const kind = event.event_type.endsWith("REFUNDED") ? "REFUND" : "SALE";

  await db.transaction.upsert({
    where: { paypalTransactionId: txId },
    create: {
      paypalTransactionId: txId,
      payerId: "unknown",
      amount: Number(resource?.amount?.value ?? 0),
      currency: resource?.amount?.currency_code ?? "USD",
      kind,
      status: resource?.status ?? "COMPLETED",
      occurredAt: resource?.create_time ? new Date(resource.create_time) : new Date(),
      source: "LIVE_SANDBOX",
    },
    update: { status: resource?.status ?? "COMPLETED" },
  });

  return `${kind.toLowerCase()} ${txId} recorded`;
}

async function subscriptionEvent(event: Envelope): Promise<string> {
  const resource = event.resource as { id?: string; status?: string } | undefined;
  const subId = resource?.id;
  if (!subId) return "no subscription id in payload";

  const existing = await db.subscription.findUnique({ where: { paypalSubscriptionId: subId } });
  if (!existing) return `subscription ${subId} not known; ignoring`;

  await db.subscription.update({
    where: { id: existing.id },
    data: {
      status: resource?.status ?? existing.status,
      ...(event.event_type === "PAYMENT.SALE.COMPLETED" ? { lastRenewedAt: new Date() } : {}),
    },
  });

  return `subscription ${subId} updated`;
}
