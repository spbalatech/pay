/**
 * Pulls disputes from PayPal.
 *
 * The webhook receiver is the primary path, but a webhook that was never
 * delivered - an endpoint that was down, a subscription registered late, a
 * tunnel that died mid-demo - leaves a dispute PayPal knows about and Aegis
 * does not. Since the whole product is "no case is lost to a missed
 * deadline", relying on delivery alone would be the wrong bet.
 *
 * So this reconciles: list what PayPal has, ingest anything new through the
 * same handler a webhook would, and report what changed. Safe to run on a
 * schedule or by hand.
 */
import { db, audit } from "@/lib/db";
import { listDisputes, getDispute, type Transport } from "@/lib/paypal/transport";
import { assessDispute } from "./advocate";
import { recordDisputeOutcome } from "./ingest";
import { normalizeReason } from "./ev";

export type SyncResult = {
  seen: number;
  ingested: string[];
  updated: string[];
  via: Transport;
};

export async function syncDisputes(opts: { transport?: Transport; pageSize?: number } = {}): Promise<SyncResult> {
  const { items = [], via } = await listDisputes({ pageSize: opts.pageSize ?? 50 }, opts.transport);

  const ingested: string[] = [];
  const updated: string[] = [];

  for (const summary of items) {
    const id = summary.dispute_id;
    if (!id) continue;

    const known = await db.dispute.findUnique({ where: { paypalDisputeId: id } });

    // The list response is a summary; the full record carries the lifecycle
    // stage and the response deadline, and PayPal's guidance is to read a
    // dispute before acting on it.
    const { dispute: full } = await getDispute(id, opts.transport);
    const d = full ?? summary;

    if (known) {
      const nextStatus = d.status ?? known.status;
      const nextStage = d.dispute_life_cycle_stage ?? known.lifeCycleStage;
      if (nextStatus !== known.status || nextStage !== known.lifeCycleStage) {
        await db.dispute.update({
          where: { id: known.id },
          data: { status: nextStatus, lifeCycleStage: nextStage },
        });
        updated.push(id);
      }
      // Without this, a result only arrived by webhook; a missed delivery
      // meant the Learner never saw the loss.
      const outcome = await recordDisputeOutcome(known.id, d.dispute_outcome?.outcome_code, "SYNC");
      if (outcome && !updated.includes(id)) updated.push(id);
      continue;
    }

    const captureId = d.disputed_transactions?.[0]?.seller_transaction_id;
    const order = captureId ? await db.order.findFirst({ where: { captureId } }) : null;

    const created = await db.dispute.create({
      data: {
        paypalDisputeId: id,
        orderId: order?.id ?? null,
        reasonCode: normalizeReason(d.reason),
        status: d.status ?? "OPEN",
        lifeCycleStage: d.dispute_life_cycle_stage ?? null,
        amount: Number(d.dispute_amount?.value ?? 0),
        currency: d.dispute_amount?.currency_code ?? "USD",
        buyerNote: d.messages?.find((m) => m.posted_by === "BUYER")?.content ?? null,
        filedAt: d.create_time ? new Date(d.create_time) : new Date(),
        responseDueAt: d.seller_response_due_date ? new Date(d.seller_response_due_date) : null,
        source: "LIVE_SANDBOX",
      },
    });

    if (order) {
      await db.watch.updateMany({
        where: { orderId: order.id, status: "OPEN" },
        data: { status: "ESCALATED_TO_DISPUTE", resolvedAt: new Date() },
      });
    }

    await audit("SYNC", "DISPUTE_INGESTED", "Dispute", created.id, {
      paypalDisputeId: id,
      via,
      matchedOrder: order?.paypalOrderId ?? null,
    });

    await assessDispute(created.id);
    await recordDisputeOutcome(created.id, d.dispute_outcome?.outcome_code, "SYNC");
    ingested.push(id);
  }

  return { seen: items.length, ingested, updated, via };
}
