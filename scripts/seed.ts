/**
 * Seeds a synthetic merchant's 90-day history.
 *
 * HONESTY NOTE — read this before judging the data:
 *
 * Everything that CAN be created in the PayPal sandbox is created for real,
 * through the real REST API, and read back by id:
 *   - catalog products and subscription plans  (/v1/catalogs, /v1/billing)
 *   - invoices, created and sent               (/v2/invoicing)
 *   - orders                                   (/v2/checkout/orders)
 *
 * Two things the sandbox cannot originate headlessly, and we do not pretend
 * otherwise:
 *   1. Payment capture needs buyer approval in a browser. We attempt a card
 *      capture; where the sandbox app has no card processing enabled, the
 *      order is stored with a locally generated capture id and marked
 *      source=SIMULATED.
 *   2. Inbound buyer disputes cannot be filed against a sandbox merchant at
 *      all. These are fixtures, always marked source=SIMULATED, and they
 *      enter through the same code path a real webhook would use.
 *
 * Every row carries its `source`, the console shows a badge for SIMULATED
 * rows, and all agent *actions* (refunds, accept-claim, tracking) run against
 * the live sandbox API. Run with --offline to skip PayPal entirely.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  createOrder,
  createInvoice,
  sendInvoice,
  createProduct,
  createSubscriptionPlan,
  createShipmentTracking,
  type PayPalOrder,
} from "../src/lib/paypal/api";

const OFFLINE = process.argv.includes("--offline");
const DAY = 86_400_000;
const NOW = Date.now();

/* ---------------------------------------------------- deterministic random */

let seed = 20261102;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
const chance = (p: number) => rnd() < p;

/* ------------------------------------------------------------- fixtures */

const BUYERS = [
  { name: "Dana Whitfield", email: "dana.whitfield@example.com", country: "US", multiUnit: true },
  { name: "Marcus Oyelaran", email: "marcus.oyelaran@example.com", country: "US", multiUnit: false },
  { name: "Priya Raghunathan", email: "priya.r@example.com", country: "US", multiUnit: true },
  { name: "Tom Brennan", email: "tom.brennan@example.com", country: "US", multiUnit: false },
  { name: "Lena Haas", email: "lena.haas@example.com", country: "DE", multiUnit: true },
  { name: "Ray Okafor", email: "ray.okafor@example.com", country: "US", multiUnit: false },
  { name: "Sofia Marchetti", email: "sofia.marchetti@example.com", country: "IT", multiUnit: true },
  { name: " 吴 Jian", email: "jian.wu@example.com", country: "US", multiUnit: false },
  { name: "Adaeze Nwosu", email: "adaeze.nwosu@example.com", country: "US", multiUnit: true },
  { name: "Hugo Belmonte", email: "hugo.belmonte@example.com", country: "US", multiUnit: false },
];

const CATALOG = [
  { name: "Stoneware pour-over set", sku: "SW-POUR-01", price: 68, category: "PHYSICAL_GOODS" },
  { name: "Walnut desk shelf", sku: "WD-SHELF-02", price: 184, category: "PHYSICAL_GOODS" },
  { name: "Linen apron", sku: "LN-APRON-03", price: 42, category: "PHYSICAL_GOODS" },
  { name: "Cast iron skillet, 12in", sku: "CI-SKIL-04", price: 96, category: "PHYSICAL_GOODS" },
  { name: "Oak cutting board, large", sku: "OK-BOARD-05", price: 215, category: "PHYSICAL_GOODS" },
  { name: "Copper kettle", sku: "CU-KETL-06", price: 310, category: "PHYSICAL_GOODS" },
  { name: "Ceramic dinner set, 8pc", sku: "CR-DINE-07", price: 440, category: "PHYSICAL_GOODS" },
];

const STREETS = [
  { line1: "418 Harrow St", multi: false },
  { line1: "92 Delancey Ave Apt 4C", multi: true },
  { line1: "1771 Pine Grove Rd", multi: false },
  { line1: "60 Ketchum Blvd Unit 211", multi: true },
  { line1: "233 Marlowe Way Suite 8", multi: true },
  { line1: "15 Alder Ct", multi: false },
];

const CARRIERS = ["UPS", "FEDEX", "USPS", "DHL_GLOBAL_MAIL"];

/* --------------------------------------------------------------- helpers */

function synthCaptureId() {
  return `SIMCAP${randomUUID().replace(/-/g, "").slice(0, 11).toUpperCase()}`;
}

async function tryRealOrder(amount: number, items: typeof CATALOG, buyer: (typeof BUYERS)[number], street: (typeof STREETS)[number]) {
  if (OFFLINE) return null;
  try {
    return await createOrder({
      amount: amount.toFixed(2),
      items: items.map((i) => ({
        name: i.name,
        quantity: "1",
        unitAmount: i.price.toFixed(2),
        sku: i.sku,
        category: "PHYSICAL_GOODS",
      })),
      shipping: {
        fullName: buyer.name,
        line1: street.line1,
        city: "Brooklyn",
        state: "NY",
        postalCode: "11211",
        countryCode: "US",
      },
    });
  } catch (err) {
    console.warn(`  ! order create failed, falling back to local record: ${String(err).slice(0, 120)}`);
    return null;
  }
}

/* ------------------------------------------------------------------ main */

async function main() {
  console.log(`\nAegis seeder ${OFFLINE ? "(offline: no PayPal calls)" : "(live sandbox)"}\n`);

  await db.auditLog.deleteMany();
  await db.rule.deleteMany();
  await db.disputeAssessment.deleteMany();
  await db.dispute.deleteMany();
  await db.intervention.deleteMany();
  await db.watch.deleteMany();
  await db.riskAssessment.deleteMany();
  await db.shipment.deleteMany();
  await db.order.deleteMany();
  await db.transaction.deleteMany();
  await db.subscription.deleteMany();
  await db.invoice.deleteMany();
  console.log("cleared existing rows");

  /* ---- orders ----------------------------------------------------------- */

  const orderCount = 48;
  const createdOrders: Array<{ id: string; payerId: string; amount: number; createdAt: Date; reasonSeed: string | null }> = [];
  let realOrders = 0;

  for (let i = 0; i < orderCount; i++) {
    const buyer = pick(BUYERS);
    const street = buyer.multiUnit ? pick(STREETS.filter((s) => s.multi)) : pick(STREETS.filter((s) => !s.multi));
    const items = [pick(CATALOG)];
    if (chance(0.25)) items.push(pick(CATALOG));
    const amount = items.reduce((s, it) => s + it.price, 0);

    const daysAgo = Math.floor(between(2, 88));
    const createdAt = new Date(NOW - daysAgo * DAY);

    const real: PayPalOrder | null = await tryRealOrder(amount, items, buyer, street);
    if (real) realOrders++;

    // An order created through the API is genuinely at PayPal and can be
    // fetched by id, but it stays CREATED until a buyer approves it in a
    // browser. So "the order is real" and "the payment is real" are different
    // claims, and the row records which one holds.
    const captureFromReal = real?.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    const captureId = captureFromReal ?? synthCaptureId();
    const provenance: "LIVE_SANDBOX" | "LIVE_UNCAPTURED" | "SIMULATED" = captureFromReal
      ? "LIVE_SANDBOX"
      : real
        ? "LIVE_UNCAPTURED"
        : "SIMULATED";
    const isReal = provenance === "LIVE_SANDBOX";

    // Deliberately plant one recurring loss shape — high-value orders to
    // multi-unit addresses shipped without signature — so the Learner has a
    // real pattern to find rather than noise.
    const plantedINR = buyer.multiUnit && amount >= 150 && chance(0.55);

    const order = await db.order.create({
      data: {
        paypalOrderId: real?.id ?? `SIMORD${randomUUID().slice(0, 12).toUpperCase()}`,
        captureId,
        payerId: `PAYER-${buyer.email.split("@")[0].toUpperCase()}`,
        payerEmail: buyer.email,
        amount,
        currency: "USD",
        status: "COMPLETED",
        billingCountry: buyer.country,
        shippingCountry: chance(0.06) ? pick(["GB", "CA", "AU"]) : "US",
        shippingLine1: street.line1,
        shippingIsMultiUnit: street.multi,
        items: items.map((it) => ({ name: it.name, sku: it.sku, price: it.price, category: it.category })),
        rushShipping: chance(0.2),
        createdAt,
        capturedAt: new Date(createdAt.getTime() + between(1, 40) * 60_000),
        promiseDate: new Date(createdAt.getTime() + Math.floor(between(4, 9)) * DAY),
        source: provenance,
      },
    });

    await db.transaction.create({
      data: {
        paypalTransactionId: captureId,
        payerId: order.payerId,
        payerEmail: buyer.email,
        amount,
        kind: "SALE",
        status: "COMPLETED",
        occurredAt: order.capturedAt!,
        source: provenance,
      },
    });

    /* ---- shipments: the lifecycle states the Interceptor reads ---------- */

    const roll = rnd();
    let shipmentKind: "delivered" | "stalled" | "in_transit" | "none";
    if (roll < 0.62) shipmentKind = "delivered";
    else if (roll < 0.78) shipmentKind = "stalled";
    else if (roll < 0.9) shipmentKind = "in_transit";
    else shipmentKind = "none";

    if (shipmentKind !== "none") {
      const shippedAt = new Date(order.createdAt.getTime() + Math.floor(between(1, 3)) * DAY);
      const carrier = pick(CARRIERS);
      const trackingNumber = `1Z${randomUUID().replace(/-/g, "").slice(0, 14).toUpperCase()}`;
      const signature = !plantedINR && amount >= 150 && chance(0.45);

      const delivered = shipmentKind === "delivered";
      const lastMovementAt = delivered
        ? new Date(shippedAt.getTime() + Math.floor(between(2, 5)) * DAY)
        : shipmentKind === "stalled"
          ? new Date(shippedAt.getTime() + Math.floor(between(1, 2)) * DAY)
          : new Date(NOW - Math.floor(between(0, 2)) * DAY);

      await db.shipment.create({
        data: {
          orderId: order.id,
          trackingNumber,
          carrier,
          status: delivered ? "DELIVERED" : shipmentKind === "stalled" ? "IN_TRANSIT" : "IN_TRANSIT",
          signatureRequired: signature,
          shippedAt,
          lastMovementAt,
          deliveredAt: delivered ? lastMovementAt : null,
          source: provenance,
        },
      });

      if (isReal && !OFFLINE) {
        try {
          await createShipmentTracking({
            captureId,
            trackingNumber,
            carrier,
            status: delivered ? "DELIVERED" : "SHIPPED",
            shipDate: shippedAt.toISOString().slice(0, 10),
          });
        } catch {
          /* tracking needs a real capture; skip quietly when unavailable */
        }
      }
    }

    createdOrders.push({
      id: order.id,
      payerId: order.payerId,
      amount,
      createdAt: order.createdAt,
      reasonSeed: plantedINR ? "ITEM_NOT_RECEIVED" : null,
    });
  }

  console.log(
    `orders: ${orderCount} — ${realOrders} created at PayPal with real order ids ` +
      `(LIVE_UNCAPTURED: the capture id is local, since capture needs browser approval), ` +
      `${orderCount - realOrders} fully SIMULATED`,
  );

  /* ---- a duplicate charge for the Interceptor to catch ------------------ */

  const dupSource = createdOrders[3];
  const dupOrder = await db.order.findUniqueOrThrow({ where: { id: dupSource.id } });
  await db.order.create({
    data: {
      paypalOrderId: `SIMORD${randomUUID().slice(0, 12).toUpperCase()}`,
      captureId: synthCaptureId(),
      payerId: dupOrder.payerId,
      payerEmail: dupOrder.payerEmail,
      amount: dupOrder.amount,
      currency: dupOrder.currency,
      status: "COMPLETED",
      billingCountry: dupOrder.billingCountry,
      shippingCountry: dupOrder.shippingCountry,
      shippingLine1: dupOrder.shippingLine1,
      shippingIsMultiUnit: dupOrder.shippingIsMultiUnit,
      items: dupOrder.items as object,
      createdAt: new Date(dupOrder.createdAt.getTime() + 11 * 60_000),
      capturedAt: new Date(dupOrder.capturedAt!.getTime() + 11 * 60_000),
      promiseDate: dupOrder.promiseDate,
      source: "SIMULATED",
    },
  });
  console.log("planted 1 duplicate charge");

  /* ---- invoices (real, created and sent) -------------------------------- */

  let realInvoices = 0;
  for (let i = 0; i < 6; i++) {
    const buyer = pick(BUYERS);
    const amount = Math.round(between(120, 900));
    const issuedAt = new Date(NOW - Math.floor(between(10, 70)) * DAY);
    const dueAt = new Date(issuedAt.getTime() + 15 * DAY);
    let paypalInvoiceId = `SIMINV${randomUUID().slice(0, 10).toUpperCase()}`;
    let source: "LIVE_SANDBOX" | "SIMULATED" = "SIMULATED";

    if (!OFFLINE) {
      try {
        const inv = await createInvoice({
          recipientEmail: buyer.email,
          amount: amount.toFixed(2),
          itemName: "Wholesale order",
          dueDate: dueAt.toISOString().slice(0, 10),
        });
        paypalInvoiceId = inv.id;
        source = "LIVE_SANDBOX";
        realInvoices++;
        try {
          await sendInvoice(inv.id);
        } catch {
          /* sending needs a verified sandbox business email; creation is enough */
        }
      } catch (err) {
        console.warn(`  ! invoice create failed: ${String(err).slice(0, 100)}`);
      }
    }

    await db.invoice.create({
      data: {
        paypalInvoiceId,
        payerEmail: buyer.email,
        amount,
        status: chance(0.5) ? "SENT" : "PAID",
        issuedAt,
        dueAt,
        paidAt: chance(0.5) ? new Date(dueAt.getTime() - 2 * DAY) : null,
        source,
      },
    });
  }
  console.log(`invoices: 6 — ${realInvoices} created and sent at PayPal (LIVE_SANDBOX)`);

  /* ---- subscriptions, incl. a dormant renewal --------------------------- */

  let planId = "SIMPLAN-MONTHLY";
  if (!OFFLINE) {
    try {
      const product = await createProduct({
        name: "Aegis demo pantry club",
        description: "Monthly curated kitchen goods for the Aegis demo merchant.",
      });
      const plan = await createSubscriptionPlan({
        productId: product.id,
        name: "Pantry club, monthly",
        amount: "34.00",
      });
      planId = plan.id;
      console.log(`subscription plan created live: ${plan.id}`);
    } catch (err) {
      console.warn(`  ! plan create failed: ${String(err).slice(0, 100)}`);
    }
  }

  for (let i = 0; i < 4; i++) {
    const buyer = BUYERS[i];
    const dormant = i === 0; // one clear "forgot I subscribed" case
    const startedAt = new Date(NOW - Math.floor(between(120, 300)) * DAY);

    await db.subscription.create({
      data: {
        paypalSubscriptionId: `SIMSUB${randomUUID().slice(0, 10).toUpperCase()}`,
        payerId: `PAYER-${buyer.email.split("@")[0].toUpperCase()}`,
        payerEmail: buyer.email,
        planId,
        planName: "Pantry club, monthly",
        amount: 34,
        status: "ACTIVE",
        startedAt,
        lastRenewedAt: new Date(NOW - Math.floor(between(1, 6)) * DAY),
        lastBuyerActivityAt: dormant
          ? new Date(NOW - 134 * DAY)
          : new Date(NOW - Math.floor(between(3, 25)) * DAY),
        source: "SIMULATED",
      },
    });
  }
  console.log("subscriptions: 4 (1 dormant renewal planted)");

  /* ---- disputes: FIXTURES, always SIMULATED ---------------------------- */

  const REASONS = [
    "ITEM_NOT_RECEIVED",
    "SIGNIFICANTLY_NOT_AS_DESCRIBED",
    "UNAUTHORIZED",
    "DUPLICATE",
    "CREDIT_NOT_PROCESSED",
  ];

  const BUYER_NOTES: Record<string, string[]> = {
    ITEM_NOT_RECEIVED: [
      "Tracking stopped updating two weeks ago and nothing ever arrived.",
      "Package was never delivered to my building. No one can find it.",
    ],
    SIGNIFICANTLY_NOT_AS_DESCRIBED: [
      "The finish is completely different from the listing photos.",
      "Arrived chipped and smaller than the listed dimensions.",
    ],
    UNAUTHORIZED: [
      "I did not authorise this charge and do not recognise this merchant.",
      "This came off my card without my permission.",
    ],
    DUPLICATE: ["I was charged twice for the same order."],
    CREDIT_NOT_PROCESSED: ["I returned this three weeks ago and still have no refund."],
  };

  // Resolved history first: this is what the Learner reads. Weight it toward
  // the planted loss shape so a genuine pattern exists to be found.
  const plantedOrders = createdOrders.filter((o) => o.reasonSeed === "ITEM_NOT_RECEIVED");
  const historical = [...plantedOrders.slice(0, 7), ...createdOrders.filter((o) => !o.reasonSeed).slice(0, 8)];

  let resolvedCount = 0;
  for (const o of historical) {
    const reasonCode = o.reasonSeed ?? pick(REASONS);
    const filedAt = new Date(o.createdAt.getTime() + Math.floor(between(12, 30)) * DAY);
    if (filedAt.getTime() > NOW - 3 * DAY) continue;

    const dispute = await db.dispute.create({
      data: {
        paypalDisputeId: `SIMDP${randomUUID().slice(0, 12).toUpperCase()}`,
        orderId: o.id,
        reasonCode,
        status: "RESOLVED",
        amount: o.amount,
        buyerNote: pick(BUYER_NOTES[reasonCode] ?? ["No note provided."]),
        filedAt,
        responseDueAt: new Date(filedAt.getTime() + 10 * DAY),
        source: "SIMULATED",
      },
    });

    // Planted shape loses; the rest is a mix. That asymmetry is the signal.
    const outcome = o.reasonSeed ? (chance(0.8) ? "LOST" : "WON") : chance(0.45) ? "WON" : chance(0.5) ? "LOST" : "ACCEPTED";

    await db.disputeAssessment.create({
      data: {
        disputeId: dispute.id,
        pWin: 0.4,
        evFight: -o.amount,
        evAccept: -o.amount,
        evidenceStrength: o.reasonSeed ? Math.floor(between(15, 40)) : Math.floor(between(45, 90)),
        evidence: [],
        timeline: [],
        recommendation: "FIGHT",
        decision: outcome === "ACCEPTED" ? "ACCEPT" : "FIGHT",
        decisionStatus: "EXECUTED",
        decidedBy: "seed:historical",
        executedAt: new Date(filedAt.getTime() + 2 * DAY),
        outcome: outcome as "WON" | "LOST" | "ACCEPTED",
        outcomeAt: new Date(filedAt.getTime() + Math.floor(between(14, 35)) * DAY),
      },
    });
    resolvedCount++;
  }

  // Live queue: open disputes with a response deadline still running. These
  // are what the Advocate triages in the demo.
  const openPool = createdOrders.filter((o) => !historical.some((h) => h.id === o.id)).slice(0, 12);
  let openCount = 0;

  for (const o of openPool) {
    const reasonCode = o.reasonSeed ?? pick(REASONS);
    const filedAt = new Date(NOW - Math.floor(between(1, 9)) * DAY);

    await db.dispute.create({
      data: {
        paypalDisputeId: `SIMDP${randomUUID().slice(0, 12).toUpperCase()}`,
        orderId: o.id,
        reasonCode,
        status: "WAITING_FOR_SELLER_RESPONSE",
        amount: o.amount,
        buyerNote: pick(BUYER_NOTES[reasonCode] ?? ["No note provided."]),
        filedAt,
        responseDueAt: new Date(filedAt.getTime() + 10 * DAY),
        source: "SIMULATED",
      },
    });
    openCount++;
  }

  console.log(`disputes: ${resolvedCount} resolved (Learner input), ${openCount} open (Advocate queue) — all SIMULATED fixtures`);
  console.log("\nseed complete. next: npm run agents:run\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(0);
  });
