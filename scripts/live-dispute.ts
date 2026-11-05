/**
 * Drives a real dispute through the PayPal sandbox, end to end.
 *
 * The sandbox CAN originate buyer disputes: a sandbox personal account opens a
 * case in the sandbox Resolution Centre on a payment it made. What it needs is
 * a real payment from that buyer, approved in a browser. This script makes
 * one, records it in Aegis as a LIVE_SANDBOX order with a real tracker, and
 * then helps move the resulting dispute along:
 *
 *   npm run live -- order               create a real order; approve it as the buyer; it is captured, saved, tracked
 *   npm run live -- order <orderId>     pick up an order the buyer approved after the wait ran out
 *   npm run live -- status <disputeId>  what PayPal says about the case and what it allows now
 *   npm run live -- escalate <disputeId> move an inquiry to a claim (PayPal review)
 *   npm run live -- settle <disputeId> buyer|seller   SANDBOX ONLY: decide the case
 *
 * The order of steps matters, because PayPal only settles a CLAIM that is
 * under review, and only allows escalation BEFORE the seller has responded:
 *   1. order     2. buyer opens the case by hand at https://www.sandbox.paypal.com
 *                   (Activity -> the payment -> Report a problem -> item not received)
 *   3. npm run agents:run  (brings the case into Aegis)
 *   4. escalate  5. Fight in the console (files tracking + letter)
 *   6. settle    7. npm run agents:run  (records the outcome; the Learner sees it)
 */
import "dotenv/config";
import { randomInt } from "node:crypto";
import { db, audit } from "../src/lib/db";
import {
  createOrder,
  getOrder,
  captureOrder,
  createShipmentTracking,
  getDispute,
  escalateDispute,
  adjudicateSandboxDispute,
} from "../src/lib/paypal/api";
import { runSentinel } from "../src/agents/sentinel";

const ITEM = { name: "Noise-cancelling headphones", sku: "AUD-NC700", price: "236.00", category: "PHYSICAL_GOODS" };
// A multi-unit address on purpose: it is one of the shapes the Learner looks
// for, so a lost case here can become a rule.
const SHIP_TO = {
  fullName: "Aegis Demo Buyer",
  line1: "742 Evergreen Terrace",
  line2: "Apt 4B",
  city: "Springfield",
  state: "IL",
  postalCode: "62704",
  countryCode: "US",
};
const RETURN_URL = process.env.AEGIS_PUBLIC_URL ?? "http://localhost:3000/";

async function order() {
  const created = await createOrder({
    amount: ITEM.price,
    items: [{ name: ITEM.name, quantity: "1", unitAmount: ITEM.price, sku: ITEM.sku, category: ITEM.category }],
    shipping: SHIP_TO,
    returnUrl: RETURN_URL,
  });
  const link = created.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!link) throw new Error(`PayPal returned no approval link for order ${created.id}`);

  console.log(`\nOrder ${created.id} created at PayPal ($${ITEM.price}, ${ITEM.name}).`);
  console.log(`\nOpen this link, log in as the sandbox BUYER (personal account) and approve the payment:\n\n  ${link}\n`);
  return finishOrder(created.id);
}

/**
 * Waits for the buyer's approval, then takes the payment and records it.
 * Also the resume path (`order <orderId>`): an approval that lands after the
 * wait gave up is still collectable, so it is picked up rather than redone.
 */
async function finishOrder(orderId: string) {
  console.log("Waiting for the approval (up to 15 minutes)…");

  const deadline = Date.now() + 15 * 60_000;
  let status = (await getOrder(orderId)).status;
  while (status !== "APPROVED" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    status = (await getOrder(orderId)).status;
  }
  if (status !== "APPROVED") {
    throw new Error(
      `Order ${orderId} was not approved in time (status ${status}). ` +
        `If the buyer approves it later, run: npm run live -- order ${orderId}`,
    );
  }

  const created = { id: orderId };
  const captured = await captureOrder(created.id);
  const unit = captured.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (!capture || capture.status !== "COMPLETED") {
    throw new Error(`Capture did not complete for ${created.id}: ${capture?.status ?? "no capture"}`);
  }
  const payerEmail = captured.payer?.email_address ?? "unknown@personal.example.com";
  const now = new Date();

  const saved = await db.order.create({
    data: {
      paypalOrderId: created.id,
      captureId: capture.id,
      payerId: `PAYER-${payerEmail.split("@")[0].toUpperCase()}`,
      payerEmail,
      amount: ITEM.price,
      currency: "USD",
      status: "COMPLETED",
      billingCountry: captured.payer?.address?.country_code ?? null,
      shippingCountry: SHIP_TO.countryCode,
      shippingLine1: `${SHIP_TO.line1} ${SHIP_TO.line2}`,
      shippingIsMultiUnit: true,
      items: [{ name: ITEM.name, sku: ITEM.sku, price: Number(ITEM.price), category: "electronics" }],
      createdAt: now,
      capturedAt: new Date(capture.create_time ?? now),
      promiseDate: new Date(now.getTime() + 5 * 86_400_000),
      fulfilledAt: now,
      source: "LIVE_SANDBOX",
    },
  });

  // A real tracker at PayPal, so the Advocate's proof of delivery is PayPal's
  // own record and Fight can file it as evidence.
  const trackingNumber = `9400${Array.from({ length: 18 }, () => randomInt(10)).join("")}`;
  await createShipmentTracking({
    captureId: capture.id,
    trackingNumber,
    carrier: "USPS",
    status: "DELIVERED",
    shipDate: now.toISOString().slice(0, 10),
  });
  await db.shipment.create({
    data: {
      orderId: saved.id,
      trackingNumber,
      carrier: "USPS",
      status: "DELIVERED",
      shippedAt: now,
      lastMovementAt: now,
      deliveredAt: now,
      source: "LIVE_SANDBOX",
    },
  });

  await audit("LIVE", "LIVE_ORDER_CAPTURED", "Order", saved.id, {
    paypalOrderId: created.id,
    captureId: capture.id,
    trackingNumber,
  });
  await runSentinel();

  console.log(`\nPaid and saved: capture ${capture.id}, USPS tracking ${trackingNumber} (delivered).`);
  console.log(
    "\nNext: as the buyer at https://www.sandbox.paypal.com go to Activity -> this payment -> Report a problem ->\n" +
      "a physical item you didn't receive. Then `npm run agents:run`, then `npm run live -- escalate <case id>`,\n" +
      "then press Fight in the console, then `npm run live -- settle <case id> buyer|seller`.\n",
  );
}

async function status(id: string) {
  const d = await getDispute(id);
  const actions = (d.links ?? []).map((l) => l.rel).filter((r) => r !== "self");
  console.log(`\n${d.dispute_id}: ${d.reason} $${d.dispute_amount?.value}`);
  console.log(`  status ${d.status}, stage ${d.dispute_life_cycle_stage}, respond by ${d.seller_response_due_date ?? "-"}`);
  console.log(`  allowed now: ${actions.join(", ") || "nothing"}`);
  console.log(`  outcome: ${d.dispute_outcome?.outcome_code ?? "pending"}\n`);
}

async function main() {
  const [cmd, id, side] = process.argv.slice(2);
  if (cmd === "order") return id ? finishOrder(id) : order();
  if (!id) throw new Error("Usage: npm run live -- order | status <id> | escalate <id> | settle <id> buyer|seller");
  if (cmd === "status") return status(id);
  if (cmd === "escalate") {
    await escalateDispute(id, "Escalating for PayPal review; delivery is confirmed by carrier tracking.");
    return status(id);
  }
  if (cmd === "settle") {
    if (side !== "buyer" && side !== "seller") throw new Error("settle needs buyer or seller");
    const d = await getDispute(id);
    if (!(d.links ?? []).some((l) => l.rel === "adjudicate")) {
      throw new Error(
        `PayPal does not offer settling on ${id} (status ${d.status}, stage ${d.dispute_life_cycle_stage}). ` +
          (d.dispute_life_cycle_stage === "INQUIRY"
            ? `An inquiry must be escalated to a claim first, then fought, then settled.`
            : `PayPal will decide this case itself; \`npm run agents:run\` picks up the result when it does.`),
      );
    }
    await adjudicateSandboxDispute(id, side === "buyer" ? "BUYER_FAVOR" : "SELLER_FAVOR");
    return status(id);
  }
  throw new Error(`Unknown command ${cmd}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
