/**
 * Deterministic signal engine.
 *
 * Risk scores are computed here, in plain arithmetic, from facts we can point
 * at. The LLM never invents a score — it explains the signals this file
 * produces. That split is what makes a score defensible to a merchant who
 * asks "why did you hold my order?", and it keeps the numbers reproducible
 * between runs.
 */

export type Signal = {
  code: string;
  weight: number; // points added to the 0-100 risk score
  detail: string;
  /** Reason codes this signal historically precedes, used by the Learner. */
  impliesReasonCodes: string[];
};

export type PayerHistory = {
  orderCount: number;
  refundCount: number;
  disputeCount: number;
  firstSeenAt: Date | null;
  totalSpend: number;
  /** Sales by this payer in the 24h before the order under assessment. */
  ordersLast24h: number;
};

export type OrderFacts = {
  amount: number;
  currency: string;
  billingCountry: string | null;
  shippingCountry: string | null;
  shippingLine1: string | null;
  shippingIsMultiUnit: boolean;
  rushShipping: boolean;
  createdAt: Date;
  itemCategories: string[];
  merchantAverageOrderValue: number;
};

const MULTI_UNIT = /\b(apt|apartment|unit|suite|ste|#|floor|fl|rm|room)\b/i;
const FORWARDER = /\b(ship\s?ito|shipito|myus|stackry|reship|forward(ing)?|freight\s?forward)\b/i;

export function detectMultiUnit(line1: string | null | undefined): boolean {
  return !!line1 && MULTI_UNIT.test(line1);
}

/** Returns every signal that fired, each carrying its own weight. */
export function scoreOrder(order: OrderFacts, payer: PayerHistory): { score: number; signals: Signal[] } {
  const signals: Signal[] = [];

  // --- payer novelty -------------------------------------------------------
  if (payer.orderCount === 0) {
    signals.push({
      code: "FIRST_TIME_PAYER",
      weight: 12,
      detail: "No prior orders from this payer.",
      impliesReasonCodes: ["UNAUTHORIZED"],
    });
  } else if (payer.orderCount >= 5 && payer.disputeCount === 0) {
    signals.push({
      code: "ESTABLISHED_PAYER",
      weight: -15,
      detail: `${payer.orderCount} prior orders, no disputes.`,
      impliesReasonCodes: [],
    });
  }

  // --- payer's own dispute record -----------------------------------------
  if (payer.disputeCount > 0) {
    const rate = payer.disputeCount / Math.max(payer.orderCount, 1);
    signals.push({
      code: "PAYER_HAS_DISPUTED_BEFORE",
      weight: Math.min(35, Math.round(rate * 100) + 10),
      detail: `${payer.disputeCount} dispute(s) across ${payer.orderCount} order(s).`,
      impliesReasonCodes: ["SIGNIFICANTLY_NOT_AS_DESCRIBED", "ITEM_NOT_RECEIVED"],
    });
  }

  if (payer.refundCount >= 3) {
    signals.push({
      code: "HIGH_REFUND_PAYER",
      weight: 10,
      detail: `${payer.refundCount} prior refunds.`,
      impliesReasonCodes: ["SIGNIFICANTLY_NOT_AS_DESCRIBED"],
    });
  }

  // --- amount outlier ------------------------------------------------------
  if (order.merchantAverageOrderValue > 0) {
    const ratio = order.amount / order.merchantAverageOrderValue;
    if (ratio >= 4) {
      signals.push({
        code: "AMOUNT_FAR_ABOVE_NORM",
        weight: 18,
        detail: `$${order.amount.toFixed(2)} is ${ratio.toFixed(1)}x your average order.`,
        impliesReasonCodes: ["UNAUTHORIZED"],
      });
    } else if (ratio >= 2.5) {
      signals.push({
        code: "AMOUNT_ABOVE_NORM",
        weight: 8,
        detail: `$${order.amount.toFixed(2)} is ${ratio.toFixed(1)}x your average order.`,
        impliesReasonCodes: ["UNAUTHORIZED"],
      });
    }
  }

  // --- address geometry ----------------------------------------------------
  if (
    order.billingCountry &&
    order.shippingCountry &&
    order.billingCountry !== order.shippingCountry
  ) {
    signals.push({
      code: "BILLING_SHIPPING_COUNTRY_MISMATCH",
      weight: 20,
      detail: `Billing ${order.billingCountry}, shipping ${order.shippingCountry}.`,
      impliesReasonCodes: ["UNAUTHORIZED"],
    });
  }

  if (order.shippingLine1 && FORWARDER.test(order.shippingLine1)) {
    signals.push({
      code: "FREIGHT_FORWARDER_ADDRESS",
      weight: 22,
      detail: "Shipping address resembles a reshipping service.",
      impliesReasonCodes: ["UNAUTHORIZED", "ITEM_NOT_RECEIVED"],
    });
  }

  if (order.shippingIsMultiUnit && order.amount >= 150) {
    signals.push({
      code: "HIGH_VALUE_TO_MULTI_UNIT",
      weight: 14,
      detail: "Order over $150 to a multi-unit address; delivery is harder to prove.",
      impliesReasonCodes: ["ITEM_NOT_RECEIVED"],
    });
  }

  // --- velocity ------------------------------------------------------------
  if (payer.ordersLast24h >= 3) {
    signals.push({
      code: "PAYER_VELOCITY",
      weight: 16,
      detail: `${payer.ordersLast24h} orders from this payer in 24h.`,
      impliesReasonCodes: ["UNAUTHORIZED", "DUPLICATE"],
    });
  }

  // --- behavioural ---------------------------------------------------------
  if (order.rushShipping && order.amount >= 200 && payer.orderCount === 0) {
    signals.push({
      code: "RUSH_HIGH_VALUE_NEW_PAYER",
      weight: 15,
      detail: "Rush shipping on a high-value first order.",
      impliesReasonCodes: ["UNAUTHORIZED"],
    });
  }

  const hour = order.createdAt.getUTCHours();
  if (hour >= 2 && hour <= 5 && order.amount >= 300) {
    signals.push({
      code: "ODD_HOUR_HIGH_VALUE",
      weight: 6,
      detail: `Placed at ${String(hour).padStart(2, "0")}:00 UTC.`,
      impliesReasonCodes: ["UNAUTHORIZED"],
    });
  }

  const base = 10; // every order carries some irreducible dispute risk
  const score = Math.max(0, Math.min(100, base + signals.reduce((s, x) => s + x.weight, 0)));

  return { score, signals };
}

export function tierFor(score: number, holdThreshold: number): "CLEAR" | "REVIEW" | "HOLD" {
  if (score >= holdThreshold) return "HOLD";
  if (score >= Math.max(35, holdThreshold - 25)) return "REVIEW";
  return "CLEAR";
}

export function recommendationFor(tier: "CLEAR" | "REVIEW" | "HOLD"): "SHIP" | "VERIFY" | "HOLD" {
  return tier === "HOLD" ? "HOLD" : tier === "REVIEW" ? "VERIFY" : "SHIP";
}

/** Reason codes implied by the signals that fired, most-implied first. */
export function predictedReasonCodes(signals: Signal[]): string[] {
  const tally = new Map<string, number>();
  for (const s of signals) {
    if (s.weight <= 0) continue;
    for (const rc of s.impliesReasonCodes) {
      tally.set(rc, (tally.get(rc) ?? 0) + s.weight);
    }
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([rc]) => rc);
}
