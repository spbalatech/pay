import { db } from "@/lib/db";

/**
 * "What Aegis just did", in a merchant's words. Built from the audit log, which
 * already records every agent decision, so the feed can never claim an action
 * that did not happen.
 */
export type ActivityItem = {
  id: string;
  agent: "Sentinel" | "Interceptor" | "Advocate" | "Learner" | "You";
  phase: "prevent" | "defend" | "learn" | "human";
  text: string;
  href: string;
  at: string;
};

const words = (code: string) => code.toLowerCase().replace(/_/g, " ");

const SIGNAL_TEXT: Record<string, string> = {
  PAYER_HAS_DISPUTED_BEFORE: "buyer has disputed before",
  BILLING_SHIPPING_COUNTRY_MISMATCH: "billing and shipping countries differ",
  HIGH_VALUE_TO_MULTI_UNIT: "high value to a shared address",
  FREIGHT_FORWARDER_ADDRESS: "ships to a freight forwarder",
  AMOUNT_FAR_ABOVE_NORM: "amount far above normal",
  AMOUNT_ABOVE_NORM: "amount above normal",
  HIGH_REFUND_PAYER: "buyer refunds often",
  PAYER_VELOCITY: "many orders in a short time",
  RUSH_HIGH_VALUE_NEW_PAYER: "rushed high-value order from a new buyer",
  ODD_HOUR_HIGH_VALUE: "high value at an odd hour",
  FIRST_TIME_PAYER: "first-time buyer",
};

const INTERVENTION_TEXT: Record<string, string> = {
  OUTREACH: "Reached out to a buyer",
  TRACKING_RESEND: "Re-sent tracking details to a buyer",
  PREEMPTIVE_REFUND: "Refunded a buyer before they could dispute",
  SUBSCRIPTION_PAUSE: "Paused a forgotten subscription renewal",
  FULFILLMENT_HOLD: "Held a shipment",
};

type Payload = Record<string, unknown>;

function describe(actor: string, action: string, p: Payload): Omit<ActivityItem, "id" | "at"> | null {
  const money = (n: unknown) => `$${Math.round(Number(n)).toLocaleString()}`;
  // Executions can be by the agent (within policy) or by a person approving it.
  const who = action === "EXECUTED_INTERVENTION" ? "INTERCEPTOR" : actor;
  switch (`${who}:${action}`) {
    case "SENTINEL:ASSESSED_ORDER": {
      if (p.tier !== "HOLD") return null;
      const why = ((p.signalCodes as string[]) ?? []).slice(0, 2).map((c) => SIGNAL_TEXT[c] ?? words(c));
      return {
        agent: "Sentinel",
        phase: "prevent",
        text: `Held an order before shipping (risk ${p.score})${why.length ? ` — ${why.join(", ")}` : ""}.`,
        href: "/orders",
      };
    }
    case "INTERCEPTOR:EXECUTED_INTERVENTION":
      return {
        agent: actor.startsWith("human:") ? "You" : "Interceptor",
        phase: actor.startsWith("human:") ? "human" : "prevent",
        text: `${INTERVENTION_TEXT[String(p.kind)] ?? words(String(p.kind))} — ${money(p.amountAtRisk)} kept out of a likely dispute.`,
        href: "/watchlist",
      };
    case "ADVOCATE:ASSESSED_DISPUTE":
      return {
        agent: "Advocate",
        phase: "defend",
        text:
          p.recommendation === "FIGHT"
            ? `Built the case to fight a ${money(p.amount)} ${words(String(p.reasonCode))} dispute (${Math.round(Number(p.pWin) * 100)}% chance to win).`
            : `Advised accepting a ${money(p.amount)} ${words(String(p.reasonCode))} claim — fighting would cost more than it recovers.`,
        href: "/disputes",
      };
    case "LEARNER:PROPOSED_RULE":
      return { agent: "Learner", phase: "learn", text: "Proposed a new prevention rule for your approval.", href: "/rulebook" };
    case "ADVOCATE:EXECUTED_FIGHT":
    case "ADVOCATE:EXECUTED_ACCEPT":
      return {
        agent: "Advocate",
        phase: "defend",
        text: action === "EXECUTED_FIGHT" ? "Submitted evidence to fight a dispute." : "Accepted a dispute within your auto-accept limit.",
        href: "/disputes",
      };
    default:
      if (actor.startsWith("human:"))
        return { agent: "You", phase: "human", text: `${words(action).replace(/^./, (c) => c.toUpperCase())}.`, href: "/audit" };
      return null;
  }
}

export async function recentActivity(limit = 6): Promise<ActivityItem[]> {
  const logs = await db.auditLog.findMany({ orderBy: { at: "desc" }, take: 300 });
  const items: ActivityItem[] = [];
  const perAgent: Record<string, number> = {};
  for (const l of logs) {
    const d = describe(l.actor, l.action, (l.payload ?? {}) as Payload);
    if (!d || items.some((i) => i.text === d.text)) continue;
    // A single run writes dozens of rows at once; cap each agent so the feed
    // shows the whole loop rather than one agent's batch.
    perAgent[d.agent] = (perAgent[d.agent] ?? 0) + 1;
    if (perAgent[d.agent] > 2) continue;
    items.push({ ...d, id: l.id, at: l.at.toISOString() });
    if (items.length >= limit) break;
  }
  return items;
}
