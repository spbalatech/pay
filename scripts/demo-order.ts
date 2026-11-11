/**
 * Inserts one SIMULATED order that matches an approved prevention rule, so a
 * demo can show Sentinel enforcing it.
 *
 * Approving a rule does not re-score orders Sentinel has already assessed, and
 * a pass of the agents only scores orders it has never seen. Without a new
 * order there is nothing for the rule to act on. This makes exactly one,
 * labelled SIMULATED like every other fixture, and checks it against the rule
 * with the same matcher Sentinel uses before writing anything.
 *
 *   npm run demo:order               match the most recently approved rule
 *   npm run demo:order -- <ruleId>   match a specific ACTIVE rule
 *
 * It does not score the order: run the agents afterwards, as a merchant would.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db, audit } from "../src/lib/db";
import { matchRules, type ActiveRule, type Predicate, type RuleCondition } from "../src/agents/rules";
import type { OrderFacts, PayerHistory } from "../src/agents/signals";

const DAY = 86_400_000;
const ITEM = { name: "Ceramic dinner set, 8pc", sku: "CR-DINE-07", category: "PHYSICAL_GOODS" };

// A buyer Aegis has never seen: the payer predicates resolve to zero.
const NEW_PAYER: PayerHistory = {
  orderCount: 0,
  refundCount: 0,
  disputeCount: 0,
  firstSeenAt: null,
  totalSpend: 0,
  ordersLast24h: 0,
};

/** The order shape the rule asks for, or why a new order cannot have it. */
function shapeFor(condition: RuleCondition) {
  const shape = { amount: 389, multiUnit: false, rush: false, mismatch: false };

  for (const p of condition.all as Predicate[]) {
    switch (p.field) {
      case "amount":
        shape.amount = p.op === "gte" ? Math.max(shape.amount, p.value) : Math.min(shape.amount, p.value);
        break;
      case "shippingIsMultiUnit":
        shape.multiUnit = p.value;
        break;
      case "rushShipping":
        shape.rush = p.value;
        break;
      case "countryMismatch":
        shape.mismatch = p.value;
        break;
      case "payerOrderCount":
        if (p.op === "gte" && p.value > 0) return { reason: `it needs a buyer with ${p.value}+ prior orders` };
        break;
      case "payerDisputeCount":
      case "payerRefundCount":
        if (p.value > 0) return { reason: `it needs a buyer with a ${p.field} of ${p.value}+` };
        break;
    }
  }
  return { shape };
}

async function main() {
  const ruleId = process.argv[2];
  const rule = await db.rule.findFirst({
    where: { status: "ACTIVE", ...(ruleId ? { id: ruleId } : {}) },
    orderBy: { approvedAt: "desc" },
  });
  if (!rule) {
    console.log(ruleId ? `\nNo ACTIVE rule ${ruleId}.\n` : "\nNo ACTIVE rule. Approve one in the Rulebook first.\n");
    process.exit(1);
  }

  // One unscored demo order at a time, so a retake never stacks them up.
  const pending = await db.order.findFirst({
    where: { paypalOrderId: { startsWith: "SIMORD-DEMO-" }, risk: null },
  });
  if (pending) {
    console.log(`\n${pending.paypalOrderId} is already waiting to be scored. Run the agents.\n`);
    return;
  }

  const result = shapeFor(rule.condition as unknown as RuleCondition);
  if (!("shape" in result) || !result.shape) {
    console.log(`\nA new order cannot match "${rule.plainEnglish}": ${result.reason}. Nothing inserted.\n`);
    process.exit(1);
  }
  const { shape } = result;

  const tag = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const now = new Date();
  const order = {
    paypalOrderId: `SIMORD-DEMO-${tag}`,
    payerId: `PAYER-DEMO-${tag}`,
    payerEmail: `demo.buyer.${tag.toLowerCase()}@example.com`,
    amount: shape.amount,
    billingCountry: "US",
    shippingCountry: shape.mismatch ? "CA" : "US",
    shippingLine1: shape.multiUnit ? "410 Harbor St Apt 12B" : "410 Harbor St",
    shippingIsMultiUnit: shape.multiUnit,
    rushShipping: shape.rush,
  };

  // Same matcher Sentinel runs. If this fails, the order would prove nothing.
  const facts: OrderFacts = {
    amount: order.amount,
    currency: "USD",
    billingCountry: order.billingCountry,
    shippingCountry: order.shippingCountry,
    shippingLine1: order.shippingLine1,
    shippingIsMultiUnit: order.shippingIsMultiUnit,
    rushShipping: order.rushShipping,
    createdAt: now,
    itemCategories: [ITEM.category],
    merchantAverageOrderValue: 0,
  };
  const asRule: ActiveRule = {
    id: rule.id,
    plainEnglish: rule.plainEnglish,
    action: rule.action,
    condition: rule.condition as unknown as RuleCondition,
  };
  if (matchRules([asRule], facts, NEW_PAYER).length === 0) {
    console.log(`\nThe order built for "${rule.plainEnglish}" does not match it. Nothing inserted.\n`);
    process.exit(1);
  }

  const saved = await db.order.create({
    data: {
      ...order,
      currency: "USD",
      status: "COMPLETED",
      items: [{ name: ITEM.name, sku: ITEM.sku, price: order.amount, category: ITEM.category }],
      createdAt: now,
      capturedAt: now,
      promiseDate: new Date(now.getTime() + 5 * DAY),
      source: "SIMULATED",
    },
  });

  await audit("DEMO", "INSERTED_DEMO_ORDER", "Order", saved.id, {
    paypalOrderId: saved.paypalOrderId,
    ruleId: rule.id,
    amount: order.amount,
  });

  console.log(`\nInserted ${saved.paypalOrderId} ($${order.amount.toFixed(2)}, SIMULATED), matching:`);
  console.log(`  ${rule.plainEnglish}`);
  console.log(`Run the agents to have Sentinel score it.\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
