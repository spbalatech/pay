"use client";

import { useState, useTransition } from "react";
import { approveRuleAction, rejectRuleAction, proposeRulesAction } from "@/app/actions";

export type SerializedRule = {
  id: string;
  plainEnglish: string;
  action: string;
  status: string;
  condition: string;
  derivedFrom: { disputeIds?: string[]; reasoning?: string };
  projectedDisputesAvoided: number;
  projectedSavings: number;
  observedMatches: number;
};

export function RuleCard({ rule }: { rule: SerializedRule }) {
  const [pending, startTransition] = useTransition();
  const cited = rule.derivedFrom.disputeIds?.length ?? 0;

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", justifyContent: "space-between" }}>
        <h3 className="card-title" style={{ marginBottom: 6, fontSize: 14, fontWeight: 560 }}>
          {rule.plainEnglish}
        </h3>
        <span className={`badge ${rule.status === "ACTIVE" ? "badge-good" : rule.status === "REJECTED" ? "badge-muted" : "badge-warning"}`}>
          <span aria-hidden>{rule.status === "ACTIVE" ? "●" : rule.status === "REJECTED" ? "·" : "▲"}</span>
          {rule.status.toLowerCase()}
        </span>
      </div>

      <div className="detail-grid" style={{ marginTop: 8 }}>
        <div>
          <dl>
            <div className="kv">
              <dt>Derived from</dt>
              <dd>
                {cited} real dispute{cited === 1 ? "" : "s"}
              </dd>
            </div>
            <div className="kv">
              <dt>Projected avoided</dt>
              <dd>{rule.projectedDisputesAvoided}/quarter</dd>
            </div>
            <div className="kv">
              <dt>Projected retained</dt>
              <dd>${rule.projectedSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd>
            </div>
            <div className="kv">
              <dt>Enforcement action</dt>
              <dd>{rule.action.toLowerCase().replace(/_/g, " ")}</dd>
            </div>
            {rule.status === "ACTIVE" ? (
              <div className="kv">
                <dt>Matched since approval</dt>
                <dd>{rule.observedMatches} orders</dd>
              </div>
            ) : null}
          </dl>

          {rule.status === "PROPOSED" ? (
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                className="btn btn-primary"
                disabled={pending}
                onClick={() => startTransition(async () => void (await approveRuleAction(rule.id)))}
              >
                Approve & enforce
              </button>
              <button
                className="btn"
                disabled={pending}
                onClick={() => startTransition(async () => void (await rejectRuleAction(rule.id)))}
              >
                Reject
              </button>
            </div>
          ) : null}
        </div>

        <div>
          {rule.derivedFrom.reasoning ? (
            <>
              <h4 className="detail-h">Why</h4>
              <p className="detail-p">{rule.derivedFrom.reasoning}</p>
            </>
          ) : null}
          <h4 className="detail-h">Machine condition</h4>
          <pre className="detail-pre">{pretty(rule.condition)}</pre>
        </div>
      </div>
    </div>
  );
}

function pretty(json: string) {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export function ProposeButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="btn-row" style={{ alignItems: "center" }}>
      <button
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMsg(null);
            try {
              const r = await proposeRulesAction();
              setMsg(r.reason ?? `${r.count} rule${r.count === 1 ? "" : "s"} proposed.`);
            } catch (err) {
              setMsg(`Could not propose: ${String(err).slice(0, 140)}`);
            }
          })
        }
      >
        {pending ? "Analysing outcomes…" : "Look for new patterns"}
      </button>
      {msg ? <span className="tile-note">{msg}</span> : null}
    </div>
  );
}
