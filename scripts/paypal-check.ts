/**
 * Exercises every PayPal endpoint Aegis depends on, against the configured
 * environment. Run after setting credentials to confirm the sandbox app has
 * the features switched on.
 *
 *   npm run paypal:check
 */
import "dotenv/config";
import { env, hasPayPal } from "../src/lib/env";
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

  console.log(failures === 0 ? "\nall endpoints reachable\n" : `\n${failures} endpoint(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nfailed: ${err}\n`);
  process.exit(1);
});
