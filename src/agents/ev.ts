/**
 * Expected-value engine for dispute decisions.
 *
 * The question a merchant actually faces is not "can I win?" but "is winning
 * worth what it costs to try?". A $22 claim that takes 40 minutes to fight is
 * a loss even when you win it. This file answers that in dollars.
 *
 * The priors below are starting estimates, not measured truths. The Learner
 * recalibrates them per merchant from observed WON/LOST outcomes
 * (`calibratedWinRate`), so the longer Aegis runs the less the seed values
 * matter. They are documented here rather than hidden in a model prompt so a
 * merchant can audit and override them.
 */

export const DISPUTE_FEE_USD = 20; // PayPal's per-dispute fee on a lost case
export const STAFF_COST_PER_DISPUTE_USD = 18; // ~40 min of operator time

/** Seed win-rate priors, given strong evidence, by reason code. Tunable. */
export const WIN_RATE_PRIORS: Record<string, number> = {
  ITEM_NOT_RECEIVED: 0.72,
  SIGNIFICANTLY_NOT_AS_DESCRIBED: 0.41,
  UNAUTHORIZED: 0.38,
  DUPLICATE: 0.81,
  CREDIT_NOT_PROCESSED: 0.76,
  INCORRECT_AMOUNT: 0.70,
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 0.72,
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 0.41,
  OTHER: 0.45,
};

export type EvidenceItem = {
  kind: string;
  found: boolean;
  weight: number; // contribution to evidence strength when found
  detail: string;
  sourceRef?: string; // which PayPal object proves it
};

/** Which evidence actually moves the needle, per reason code. */
export const EVIDENCE_CHECKLIST: Record<string, Array<{ kind: string; weight: number }>> = {
  ITEM_NOT_RECEIVED: [
    { kind: "TRACKING_EXISTS", weight: 25 },
    { kind: "TRACKING_DELIVERED", weight: 35 },
    { kind: "DELIVERED_BEFORE_FILING", weight: 15 },
    { kind: "SIGNATURE_ON_DELIVERY", weight: 15 },
    { kind: "SHIPPED_TO_ORDER_ADDRESS", weight: 10 },
  ],
  SIGNIFICANTLY_NOT_AS_DESCRIBED: [
    { kind: "ITEM_DESCRIPTION_ON_ORDER", weight: 25 },
    { kind: "TRACKING_DELIVERED", weight: 20 },
    { kind: "NO_RETURN_RECEIVED", weight: 25 },
    { kind: "BUYER_CONTACTED_MERCHANT_FIRST", weight: 15 },
    { kind: "REFUND_POLICY_DISCLOSED", weight: 15 },
  ],
  UNAUTHORIZED: [
    { kind: "BILLING_SHIPPING_MATCH", weight: 25 },
    // A settled payment history at PayPal is the strongest answer to "I did not
    // authorise this": the same payer has paid this merchant before and did
    // not dispute it. Read from transaction search, not from our own records.
    { kind: "PAYER_PAYMENT_HISTORY_AT_PAYPAL", weight: 30 },
    { kind: "PAYER_HAS_PRIOR_ORDERS", weight: 15 },
    { kind: "TRACKING_DELIVERED", weight: 20 },
    { kind: "SIGNATURE_ON_DELIVERY", weight: 10 },
  ],
  DUPLICATE: [
    { kind: "DISTINCT_CAPTURE_IDS", weight: 35 },
    // Two settled transactions at PayPal for the same payer is what makes a
    // duplicate claim refutable - or confirms it.
    { kind: "SEPARATE_TRANSACTIONS_AT_PAYPAL", weight: 25 },
    { kind: "DISTINCT_ORDER_CONTENTS", weight: 22 },
    { kind: "DISTINCT_ORDER_DATES", weight: 18 },
  ],
  CREDIT_NOT_PROCESSED: [
    { kind: "REFUND_RECORD_EXISTS", weight: 60 },
    { kind: "REFUND_COMPLETED", weight: 40 },
  ],
};

export function checklistFor(reasonCode: string) {
  return EVIDENCE_CHECKLIST[reasonCode] ?? EVIDENCE_CHECKLIST.ITEM_NOT_RECEIVED;
}

/** 0-100, the share of the available evidence weight we actually hold. */
export function evidenceStrength(evidence: EvidenceItem[]): number {
  const total = evidence.reduce((s, e) => s + e.weight, 0);
  if (total === 0) return 0;
  const held = evidence.filter((e) => e.found).reduce((s, e) => s + e.weight, 0);
  return Math.round((held / total) * 100);
}

/**
 * P(win) = prior for the reason code, scaled by how much of the needed
 * evidence we hold. With no evidence we floor at 5%: PayPal does occasionally
 * side with a merchant on a bare response, but betting on it is irrational.
 */
export function probabilityOfWinning(
  reasonCode: string,
  strength: number,
  calibratedWinRate?: number,
) {
  const prior = calibratedWinRate ?? WIN_RATE_PRIORS[reasonCode] ?? WIN_RATE_PRIORS.OTHER;
  const scaled = prior * (0.1 + 0.9 * (strength / 100));
  return Math.max(0.05, Math.min(0.95, scaled));
}

export type EVResult = {
  pWin: number;
  evFight: number;
  evAccept: number;
  recommendation: "FIGHT" | "ACCEPT";
  margin: number;
  explanation: string;
};

export function expectedValue(input: {
  claimAmount: number;
  reasonCode: string;
  evidenceStrength: number;
  calibratedWinRate?: number;
  staffCost?: number;
  disputeFee?: number;
}): EVResult {
  const staff = input.staffCost ?? STAFF_COST_PER_DISPUTE_USD;
  const fee = input.disputeFee ?? DISPUTE_FEE_USD;
  const pWin = probabilityOfWinning(input.reasonCode, input.evidenceStrength, input.calibratedWinRate);

  // Fighting: keep the money if we win; lose the claim plus the dispute fee if
  // we don't; pay the staff cost either way.
  const evFight = pWin * 0 + (1 - pWin) * -(input.claimAmount + fee) - staff;

  // Accepting: refund the claim, no dispute fee, minimal handling.
  const evAccept = -input.claimAmount - 2;

  const recommendation = evFight >= evAccept ? "FIGHT" : "ACCEPT";
  const margin = Math.abs(evFight - evAccept);

  const explanation =
    `P(win)=${(pWin * 100).toFixed(0)}% at ${input.evidenceStrength}% evidence strength. ` +
    `Fighting is worth ${fmt(evFight)}, accepting ${fmt(evAccept)} ` +
    `(claim $${input.claimAmount.toFixed(2)}, dispute fee $${fee}, staff cost $${staff}). ` +
    `${recommendation === "FIGHT" ? "Fight" : "Accept"} by ${fmt(margin)}.`;

  return {
    pWin,
    evFight: round2(evFight),
    evAccept: round2(evAccept),
    recommendation,
    margin: round2(margin),
    explanation,
  };
}

const fmt = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;
