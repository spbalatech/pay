/**
 * Exercises every PayPal endpoint Aegis depends on, against the configured
 * environment. Run after setting credentials to confirm the sandbox app has
 * the features switched on.
 *
 *   npm run paypal:check
 */
import "dotenv/config";
import { env, hasPayPal } from "../src/lib/env";
import { paypal, PayPalError } from "../src/lib/paypal/client";
import { randomUUID } from "node:crypto";
import {
  createOrder,
  getOrder,
  createInvoice,
  sendInvoice,
  listInvoices,
  listDisputes,
  listTransactions,
  createProduct,
  createSubscriptionPlan,
} from "../src/lib/paypal/api";

let failures = 0;

async function step(name: string, fn: () => Promise<string>) {
  try {
    console.log(`  ok    ${name.padEnd(24)} ${await fn()}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name.padEnd(24)} ${String(err).replace(/\s+/g, " ").slice(0, 160)}`);
  }
}

async function main() {
  if (!hasPayPal()) {
    console.log("\nNo PayPal credentials configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.\n");
    process.exit(1);
  }

  console.log(`\nPayPal ${env().PAYPAL_ENVIRONMENT} check\n`);

  let orderId = "";
  await step("create_order", async () => {
    const o = await createOrder({
      amount: "184.00",
      items: [{ name: "Walnut desk shelf", quantity: "1", unitAmount: "184.00", sku: "WD-SHELF-02" }],
      shipping: {
        fullName: "Dana Whitfield",
        line1: "92 Delancey Ave Apt 4C",
        city: "Brooklyn",
        state: "NY",
        postalCode: "11211",
        countryCode: "US",
      },
    });
    orderId = o.id;
    return `${o.id} ${o.status}`;
  });

  await step("get_order", async () => {
    const o = await getOrder(orderId);
    return `${o.id} $${o.purchase_units?.[0]?.amount?.value}`;
  });

  let invoiceId = "";
  await step("create_invoice", async () => {
    const i = await createInvoice({
      recipientEmail: "dana.whitfield@example.com",
      amount: "420.00",
      itemName: "Wholesale order",
    });
    invoiceId = i.id;
    return `${i.id} ${i.status}`;
  });
  await step("send_invoice", async () => {
    await sendInvoice(invoiceId);
    return "sent";
  });
  await step("list_invoices", async () => `${(await listInvoices(5)).items?.length ?? 0} found`);

  await step("list_disputes", async () => `${(await listDisputes({ pageSize: 10 })).items?.length ?? 0} found`);
  await step(
    "transaction_search",
    async () => `${(await listTransactions(new Date(Date.now() - 29 * 864e5), new Date())).length} found`,
  );

  let productId = "";
  await step("create_product", async () => {
    const p = await createProduct({ name: "Aegis pantry club", description: "Monthly curated kitchen goods." });
    productId = p.id;
    return p.id;
  });
  await step("create_subscription_plan", async () => {
    const plan = await createSubscriptionPlan({ productId, name: "Pantry club, monthly", amount: "34.00" });
    return `${plan.id} ${plan.status}`;
  });

  // Card capture is optional: it needs Advanced Credit and Debit Card Payments
  // on the sandbox business account, which is only available in the 37
  // Expanded Checkout countries. Reported separately so a "no" here does not
  // read as a broken integration.
  console.log("\noptional — headless card capture (needs Advanced Card Payments):");
  try {
    const o = await paypal<{ id: string; status: string; purchase_units?: Array<{ payments?: { captures?: Array<{ id: string; status: string }> } }> }>(
      "/v2/checkout/orders",
      {
        method: "POST",
        idempotencyKey: randomUUID(),
        body: {
          intent: "CAPTURE",
          purchase_units: [{ amount: { currency_code: "USD", value: "12.00" } }],
          payment_source: {
            card: { number: "4111111111111111", expiry: "2027-12", name: "Test Buyer", security_code: "123" },
          },
        },
      },
    );
    const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
    console.log(`  ok    card capture             ${o.id} ${o.status}` + (cap ? ` capture=${cap.id}` : ""));
    console.log("\n  Advanced Card Payments IS enabled — re-run `npm run seed` and orders");
    console.log("  will be stored as LIVE_SANDBOX with real capture ids.\n");
  } catch (err) {
    const issue = err instanceof PayPalError ? err.issue : String(err).slice(0, 60);
    console.log(`  off   card capture             ${issue}`);
    if (issue === "PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING") {
      console.log("\n  Not enabled on this sandbox business account. This is optional:");
      console.log("  without it, orders are stored as LIVE_UNCAPTURED, which is accurate.");
      console.log("  Only the 37 Expanded Checkout countries can enable it (India cannot).\n");
    } else {
      console.log("");
    }
  }

  console.log(failures === 0 ? "all required endpoints reachable\n" : `${failures} required endpoint(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nfailed: ${err}\n`);
  process.exit(1);
});
