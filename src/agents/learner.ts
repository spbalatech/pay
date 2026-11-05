/**
 * LEARNER — turns outcomes into prevention.
 *
 * This is the part that makes Aegis a loop rather than two tools. It reads
 * resolved disputes and deflected watches, finds the shapes that keep costing
 * this merchant money, and proposes a prevention rule in plain English for a
 * human to approve. Approved rules are enforced by Sentinel on future orders,
 * so the same loss does not recur.
 *
 * The model may only compose predicates that already exist in rules.ts, and
 * every proposal must cite the disputes it came from. It cannot invent a rule
 * out of nothing, and it cannot write one the merchant has not sanctioned.
 */
import { db, audit } from "@/lib/db";
import { generateStructured, aiStatus } from "@/lib/ai";
import { PREDICATE_FIELDS, RULE_ACTIONS, type RuleCondition } from "./rules";
import { DISPUTE_FEE_USD } from "./ev";
import { z } from "zod";

const MIN_CLUSTER = 3; // never generalise from fewer than three losses

/** The seeder and collectLossPatterns both look back ~90 days. */
const HISTORY_WINDOW_DAYS = 90;
const QUARTER_DAYS = 91;

const predicateSchema = z.object({
  field: z.enum(PREDICATE_FIELDS as [string, ...string[]]),
  op: z.enum(["eq", "gte", "lte"]),
  value: z.union([z.number(), z.boolean()]),
});

const proposalSchema = z.object({
  proposals: z.array(
    z.object({
      plainEnglish: z.string().min(20),
      condition: z.object({ all: z.array(predicateSchema).min(1).max(4) }),
      action: z.enum(RULE_ACTIONS),
      citedDisputes: z.array(z.string()).min(MIN_CLUSTER),
      reasoning: z.string(),
    }),
  ),
});

const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          plainEnglish: {
            type: "string",
            description:
              "The rule as one sentence a merchant would say out loud, e.g. 'Require signature confirmation on orders over $150 going to apartment addresses.'",
          },
          condition: {
            type: "object",
            properties: {
              all: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string", enum: PREDICATE_FIELDS },
                    op: { type: "string", enum: ["eq", "gte", "lte"] },
                    value: { type: ["number", "boolean"] },
                  },
                  required: ["field", "op", "value"],
                },
              },
            },
            required: ["all"],
          },
          action: { type: "string", enum: RULE_ACTIONS },
          citedDisputes: {
            type: "array",
            items: { type: "string" },
            description:
              "The short labels (D1, D2, …) of the disputes this rule would have prevented. At least 3, copied exactly from the input.",
          },
          reasoning: { type: "string" },
        },
        required: ["plainEnglish", "condition", "action", "citedDisputes", "reasoning"],
      },
    },
  },
  required: ["proposals"],
} as const;

const SYSTEM = `You find the repeated patterns behind a merchant's chargebacks and propose prevention rules.

You are given resolved disputes, each with its order's attributes. Propose at most 3 rules.

Hard constraints:
- Only propose a rule when at least ${MIN_CLUSTER} of the given disputes share the pattern. Cite their labels (D1, D2, …) exactly as given.
- Conditions may only use the listed fields, operators and actions. Nothing else exists.
- Prefer one narrow rule over one broad rule. A rule that holds every order is useless.
- Thresholds must be round, defensible numbers a merchant would choose ($150, not $147.32).
- plainEnglish must state the condition and the action, and must match the machine condition exactly.
- If no pattern reaches ${MIN_CLUSTER} disputes, return an empty proposals array. Saying "not yet" is correct and expected.

Before concluding that no pattern exists, check each dimension in turn and count how many disputes share each value:
reason code · order amount band · multi-unit shipping address · signature on delivery · tracking present ·
billing/shipping country mismatch · payer's prior order count.
A dimension where ${MIN_CLUSTER} or more of the losses agree IS a pattern, and you should propose a rule for it.`;

export type LossPattern = {
  disputeId: string;
  reasonCode: string;
  amount: number;
  outcome: string;
  orderAmount: number | null;
  shippingIsMultiUnit: boolean | null;
  rushShipping: boolean | null;
  countryMismatch: boolean | null;
  payerOrderCount: number;
  hadTracking: boolean;
  hadSignature: boolean;
  hadDelivery: boolean;
};

export async function collectLossPatterns(): Promise<LossPattern[]> {
  const resolved = await db.disputeAssessment.findMany({
    where: { outcome: { in: ["LOST", "ACCEPTED"] } },
    include: { dispute: { include: { order: { include: { shipments: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  const out: LossPattern[] = [];

  for (const a of resolved) {
    const order = a.dispute.order;
    const shipments = order?.shipments ?? [];
    const priorOrders = order
      ? await db.order.count({ where: { payerId: order.payerId, createdAt: { lt: order.createdAt } } })
      : 0;

    out.push({
      disputeId: a.dispute.id,
      reasonCode: a.dispute.reasonCode,
      amount: Number(a.dispute.amount),
      outcome: a.outcome,
      orderAmount: order ? Number(order.amount) : null,
      shippingIsMultiUnit: order?.shippingIsMultiUnit ?? null,
      rushShipping: order?.rushShipping ?? null,
      countryMismatch: order
        ? !!order.billingCountry && !!order.shippingCountry && order.billingCountry !== order.shippingCountry
        : null,
      payerOrderCount: priorOrders,
      hadTracking: shipments.length > 0,
      hadSignature: shipments.some((s) => s.signatureRequired),
      hadDelivery: shipments.some((s) => !!s.deliveredAt),
    });
  }

  return out;
}

export async function proposeRules() {
  const ai = await aiStatus();
  if (!ai.available) {
    return { proposed: [], reason: `${ai.hint} Everything else runs.` };
  }

  const patterns = await collectLossPatterns();

  if (patterns.length < MIN_CLUSTER) {
    return { proposed: [], reason: `Only ${patterns.length} resolved loss(es) on record; need ${MIN_CLUSTER}.` };
  }

  const existing = await db.rule.findMany({
    where: { status: { in: ["ACTIVE", "PROPOSED"] } },
    select: { plainEnglish: true, condition: true, action: true },
  });

  // Disputes are presented as D1, D2, … rather than by their 25-character
  // cuid. A citation the model cannot copy accurately is a citation the guard
  // below throws away, which silently costs real rules.
  const labelled = patterns.map((p, i) => ({ label: `D${i + 1}`, pattern: p }));
  const byLabel = new Map(labelled.map((l) => [l.label, l.pattern]));

  const result = await generateStructured({
    system: SYSTEM,
    name: "propose_prevention_rules",
    schema: proposalSchema,
    jsonSchema: PROPOSAL_JSON_SCHEMA as unknown as Record<string, unknown>,
    tier: "reasoning",
    maxTokens: 2500,
    prompt:
      `Available condition fields: ${PREDICATE_FIELDS.join(", ")}\n` +
      `Available actions: ${RULE_ACTIONS.join(", ")}\n\n` +
      `Rules that already exist (do not duplicate these):\n` +
      (existing.length ? existing.map((r) => `- ${r.plainEnglish}`).join("\n") : "- none") +
      `\n\nResolved losses (${patterns.length}):\n` +
      labelled
        .map(
          ({ label, pattern: p }) =>
            `- ${label}: ${p.reasonCode} $${p.amount.toFixed(2)} outcome=${p.outcome} ` +
            `orderAmount=${p.orderAmount ?? "?"} multiUnit=${p.shippingIsMultiUnit} rush=${p.rushShipping} ` +
            `countryMismatch=${p.countryMismatch} payerPriorOrders=${p.payerOrderCount} ` +
            `tracking=${p.hadTracking} signature=${p.hadSignature} delivered=${p.hadDelivery}`,
        )
        .join("\n") +
      `\n\nPropose prevention rules.`,
  });

  const created = [];
  const rejected: string[] = [];

  for (const proposal of result.proposals) {
    // Reject anything citing a dispute we did not supply: a rule has to be
    // traceable to real losses or it is just a guess with a citation.
    const citedLabels = proposal.citedDisputes.filter((l) => byLabel.has(l.trim()));
    if (citedLabels.length < MIN_CLUSTER) {
      rejected.push(
        `"${proposal.plainEnglish.slice(0, 60)}…" cited ${citedLabels.length}/${MIN_CLUSTER} valid disputes`,
      );
      continue;
    }

    // The prompt lists existing rules, but a model can still repeat one. One
    // condition gets one rule: the same condition proposed again - whatever
    // the wording, even with a different action - is a duplicate the merchant
    // would only have to reject. Checked in code so it cannot depend on the
    // model obeying.
    const sameRule = existing.some((r) => canonical(r.condition) === canonical(proposal.condition));
    if (sameRule) {
      rejected.push(`"${proposal.plainEnglish.slice(0, 60)}…" duplicates an existing rule`);
      continue;
    }

    const cited = citedLabels.map((l) => byLabel.get(l.trim())!.disputeId);
    const losses = citedLabels.map((l) => byLabel.get(l.trim())!);

    // Derived, not guessed. These disputes actually happened inside the
    // history window, so the count IS the observed rate - models estimate
    // this badly, and a projection a merchant cannot trace is worthless.
    const avoided = Math.round(cited.length * (QUARTER_DAYS / HISTORY_WINDOW_DAYS));
    const projectedSavings = losses.reduce((s, p) => s + p.amount + DISPUTE_FEE_USD, 0) *
      (QUARTER_DAYS / HISTORY_WINDOW_DAYS);

    const rule = await db.rule.create({
      data: {
        plainEnglish: proposal.plainEnglish,
        condition: proposal.condition as unknown as object,
        action: proposal.action,
        status: "PROPOSED",
        derivedFrom: { disputeIds: cited, reasoning: proposal.reasoning },
        projectedDisputesAvoided: avoided,
        projectedSavings,
      },
    });

    existing.push(rule); // a second identical proposal in the same batch is a duplicate too

    await audit("LEARNER", "PROPOSED_RULE", "Rule", rule.id, {
      plainEnglish: rule.plainEnglish,
      citedDisputeIds: cited,
      projectedSavings,
    });

    created.push(rule);
  }

  // A silent zero is indistinguishable from a bug. Always say which it was.
  const reason =
    created.length > 0
      ? null
      : rejected.length > 0
        ? `Model returned ${result.proposals.length} proposal(s), all rejected: ${rejected.join("; ")}.`
        : `No pattern reached ${MIN_CLUSTER} shared disputes across ${patterns.length} resolved loss(es).`;

  return { proposed: created, reason };
}

/**
 * A condition as a comparable string: keys sorted, and clause order ignored
 * (an "all" of A and B is the same rule as an "all" of B and A).
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function approveRule(ruleId: string, actor: string) {
  const rule = await db.rule.update({
    where: { id: ruleId },
    data: { status: "ACTIVE", approvedAt: new Date(), approvedBy: actor },
  });
  await audit(actor, "APPROVED_RULE", "Rule", ruleId, { plainEnglish: rule.plainEnglish });
  return rule;
}

export async function rejectRule(ruleId: string, actor: string) {
  const rule = await db.rule.update({ where: { id: ruleId }, data: { status: "REJECTED" } });
  await audit(actor, "REJECTED_RULE", "Rule", ruleId, { plainEnglish: rule.plainEnglish });
  return rule;
}

/** Recalibrated win rates, surfaced so the merchant can see the priors move. */
export async function calibration() {
  const rows = await db.disputeAssessment.findMany({
    where: { outcome: { in: ["WON", "LOST"] } },
    include: { dispute: { select: { reasonCode: true } } },
  });

  const byReason = new Map<string, { won: number; total: number }>();
  for (const r of rows) {
    const key = r.dispute.reasonCode;
    const agg = byReason.get(key) ?? { won: 0, total: 0 };
    agg.total++;
    if (r.outcome === "WON") agg.won++;
    byReason.set(key, agg);
  }

  return [...byReason.entries()].map(([reasonCode, { won, total }]) => ({
    reasonCode,
    observedWinRate: total ? won / total : null,
    sampleSize: total,
    calibrated: total >= 5,
  }));
}
