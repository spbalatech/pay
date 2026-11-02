import { NextResponse } from "next/server";
import { db, audit } from "@/lib/db";
import { env } from "@/lib/env";
import { readSignatureHeaders, verifyWebhookSignature } from "@/lib/paypal/webhooks";
import { handleEvent } from "@/agents/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PayPal webhook receiver.
 *
 * Contract, per PayPal's own guidance:
 *  - verify the signature before trusting anything; an unverified endpoint
 *    accepts a POST from anyone, and this one creates disputes;
 *  - use the RAW body for verification — re-serializing changes the bytes the
 *    signature covers;
 *  - return 200 within 30 seconds and process asynchronously, or PayPal
 *    retries and the same event is handled twice;
 *  - be idempotent, because the same event WILL arrive more than once:
 *    delivery is retried for up to three days until a 200 is seen.
 */
export async function POST(req: Request) {
  // Raw first. Never req.json() here.
  const rawBody = await req.text();

  const headers = readSignatureHeaders(req.headers);
  if (!headers) {
    return NextResponse.json({ error: "missing PayPal signature headers" }, { status: 400 });
  }

  let event: { id?: string; event_type?: string; resource_type?: string; summary?: string };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }

  if (!event.id || !event.event_type) {
    return NextResponse.json({ error: "not a PayPal event envelope" }, { status: 400 });
  }

  // Idempotency gate, before any work. A replay is a success, not an error:
  // returning anything else makes PayPal retry it forever.
  const seen = await db.webhookEvent.findUnique({ where: { paypalEventId: event.id } });
  if (seen) {
    return NextResponse.json({ status: "duplicate", eventId: event.id }, { status: 200 });
  }

  const verified = await verifyWebhookSignature(rawBody, headers);

  const stored = await db.webhookEvent.create({
    data: {
      paypalEventId: event.id,
      eventType: event.event_type,
      resourceType: event.resource_type ?? null,
      summary: event.summary ?? null,
      payload: JSON.parse(rawBody),
      verified,
    },
  });

  if (!verified) {
    // Stored for inspection, never acted on. PayPal's simulate-event endpoint
    // emits events that can never pass real verification, so local testing
    // against it requires an explicit opt-in.
    if (!env().AEGIS_WEBHOOK_ALLOW_UNVERIFIED) {
      await audit("WEBHOOK", "REJECTED_UNVERIFIED", "WebhookEvent", stored.id, {
        eventType: event.event_type,
      });
      return NextResponse.json({ error: "signature verification failed" }, { status: 401 });
    }
    console.warn(
      `[webhook] accepting UNVERIFIED ${event.event_type} because AEGIS_WEBHOOK_ALLOW_UNVERIFIED is set. Never do this in production.`,
    );
  }

  // Answer now, work after. Deliberately not awaited: processing a dispute
  // means a PayPal fetch plus a model call, which will not finish inside
  // PayPal's 30-second window.
  void process(stored.id, event as Parameters<typeof handleEvent>[0]);

  return NextResponse.json({ status: "accepted", eventId: event.id }, { status: 200 });
}

async function process(storedId: string, event: Parameters<typeof handleEvent>[0]) {
  try {
    const result = await handleEvent(event);
    await db.webhookEvent.update({
      where: { id: storedId },
      data: { processedAt: new Date(), processingError: null },
    });
    console.log(`[webhook] ${event.event_type}: ${result}`);
  } catch (err) {
    // Recorded rather than thrown: PayPal already has its 200, and a failure
    // that vanishes into a log line is a failure nobody fixes.
    await db.webhookEvent.update({
      where: { id: storedId },
      data: { processedAt: new Date(), processingError: String(err).slice(0, 2000) },
    });
    console.error(`[webhook] ${event.event_type} failed:`, err);
  }
}

/** Liveness check, so you can confirm the tunnel reaches this route. */
export async function GET() {
  const [total, verified, failed] = await Promise.all([
    db.webhookEvent.count(),
    db.webhookEvent.count({ where: { verified: true } }),
    db.webhookEvent.count({ where: { processingError: { not: null } } }),
  ]);
  return NextResponse.json({
    endpoint: "PayPal webhook receiver",
    webhookIdConfigured: !!env().PAYPAL_WEBHOOK_ID,
    allowUnverified: env().AEGIS_WEBHOOK_ALLOW_UNVERIFIED,
    events: { total, verified, failedProcessing: failed },
  });
}
