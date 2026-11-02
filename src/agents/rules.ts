/**
 * The rulebook the Learner writes and Sentinel enforces.
 *
 * Conditions are a small, closed predicate language rather than generated
 * code: the Learner can only compose checks that already exist here, so an
 * approved rule can never do something the merchant did not sanction.
 */
import type { OrderFacts, PayerHistory } from "./signals";

export type Predicate =
  | { field: "amount"; op: "gte" | "lte"; value: number }
  | { field: "shippingIsMultiUnit"; op: "eq"; value: boolean }
  | { field: "rushShipping"; op: "eq"; value: boolean }
  | { field: "countryMismatch"; op: "eq"; value: boolean }
  | { field: "payerOrderCount"; op: "gte" | "lte"; value: number }
  | { field: "payerDisputeCount"; op: "gte"; value: number }
  | { field: "payerRefundCount"; op: "gte"; value: number };

export type RuleCondition = { all: Predicate[] };

export type ActiveRule = {
  id: string;
  plainEnglish: string;
  action: string;
  condition: RuleCondition;
};

export const PREDICATE_FIELDS: Predicate["field"][] = [
  "amount",
  "shippingIsMultiUnit",
  "rushShipping",
  "countryMismatch",
  "payerOrderCount",
  "payerDisputeCount",
  "payerRefundCount",
];

export const RULE_ACTIONS = [
  "HOLD",
  "REQUIRE_SIGNATURE",
  "REQUIRE_TRACKING",
  "VERIFY_PAYER",
  "REQUIRE_CONFIRMATION",
] as const;

function resolve(field: Predicate["field"], order: OrderFacts, payer: PayerHistory): number | boolean {
  switch (field) {
    case "amount":
      return order.amount;
    case "shippingIsMultiUnit":
      return order.shippingIsMultiUnit;
    case "rushShipping":
      return order.rushShipping;
    case "countryMismatch":
      return (
        !!order.billingCountry &&
        !!order.shippingCountry &&
        order.billingCountry !== order.shippingCountry
      );
    case "payerOrderCount":
      return payer.orderCount;
    case "payerDisputeCount":
      return payer.disputeCount;
    case "payerRefundCount":
      return payer.refundCount;
  }
}

function test(p: Predicate, order: OrderFacts, payer: PayerHistory): boolean {
  const actual = resolve(p.field, order, payer);
  switch (p.op) {
    case "eq":
      return actual === p.value;
    case "gte":
      return typeof actual === "number" && actual >= (p.value as number);
    case "lte":
      return typeof actual === "number" && actual <= (p.value as number);
  }
}

export function matchRules(rules: ActiveRule[], order: OrderFacts, payer: PayerHistory): ActiveRule[] {
  return rules.filter(
    (r) =>
      Array.isArray(r.condition?.all) &&
      r.condition.all.length > 0 &&
      r.condition.all.every((p) => test(p, order, payer)),
  );
}
