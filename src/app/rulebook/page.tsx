import { db } from "@/lib/db";
import { calibration } from "@/agents/learner";
import { RuleCard, ProposeButton } from "@/components/RuleCard";
import { WIN_RATE_PRIORS } from "@/agents/ev";
import { aiAvailable } from "@/lib/ai";
import { Icon, NAV_ICON } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function RulebookPage() {
  const [rules, cal, hasModel] = await Promise.all([
    db.rule.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    calibration(),
    aiAvailable(),
  ]);

  const proposed = rules.filter((r) => r.status === "PROPOSED");
  const active = rules.filter((r) => r.status === "ACTIVE");
  const rejected = rules.filter((r) => r.status === "REJECTED");

  const serialize = (r: (typeof rules)[number]) => ({
    id: r.id,
    plainEnglish: r.plainEnglish,
    action: r.action,
    status: r.status,
    condition: JSON.stringify(r.condition),
    derivedFrom: r.derivedFrom as { disputeIds?: string[]; reasoning?: string },
    projectedDisputesAvoided: r.projectedDisputesAvoided,
    projectedSavings: Number(r.projectedSavings),
    observedMatches: r.observedMatches,
  });

  return (
    <>
      <div className="page-head">
        <h1 className="page-title"><Icon as={NAV_ICON["/rulebook"]} size={22} className="title-icon" />Rulebook</h1>
        <p className="page-sub">
          Learner reads resolved disputes, finds the shapes that keep costing you money, and writes a
          prevention rule for you to approve. It can only compose conditions from a fixed predicate
          set, and every proposal must cite at least three recorded disputes it would have prevented —
          so an approved rule can never do something you did not sanction. Approved rules are
          enforced by Sentinel on new orders.
        </p>
      </div>

      <ProposeButton />

      <h2 className="card-title" style={{ marginTop: 22, fontSize: 14 }}>
        Awaiting your approval ({proposed.length})
      </h2>
      {proposed.length === 0 ? (
        <div className="empty">
          {hasModel ? (
            <>
              No proposals. Learner needs at least three resolved disputes sharing a pattern before it
              will generalise — &ldquo;not yet&rdquo; is a valid answer.
            </>
          ) : (
            <>
              No AI model is connected, so Learner cannot write rules yet. Add an Anthropic API key
              (or run a local model), then press &ldquo;Look for new patterns&rdquo;.
            </>
          )}
        </div>
      ) : (
        proposed.map((r) => <RuleCard key={r.id} rule={serialize(r)} />)
      )}

      <h2 className="card-title" style={{ marginTop: 26, fontSize: 14 }}>
        Active ({active.length})
      </h2>
      {active.length === 0 ? (
        <div className="empty">No active rules yet.</div>
      ) : (
        active.map((r) => <RuleCard key={r.id} rule={serialize(r)} />)
      )}

      {rejected.length > 0 ? (
        <>
          <h2 className="card-title" style={{ marginTop: 26, fontSize: 14 }}>
            Rejected ({rejected.length})
          </h2>
          {rejected.map((r) => (
            <RuleCard key={r.id} rule={serialize(r)} />
          ))}
        </>
      ) : null}

      <div className="card" style={{ marginTop: 26 }}>
        <h3 className="card-title">Win-rate calibration</h3>
        <p className="detail-p">
          The fight-or-accept maths starts from built-in estimated win rates, which are starting
          guesses, not facts about your shop. Once a dispute reason has five resolved cases, your own win rate
          replaces the estimate.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--ink-muted)" }}>
              <th style={{ padding: "6px 8px 6px 0", fontWeight: 500 }}>Dispute reason</th>
              <th style={{ padding: "6px 8px 6px 0", fontWeight: 500 }}>Starting estimate</th>
              <th style={{ padding: "6px 8px 6px 0", fontWeight: 500 }}>Your win rate</th>
              <th style={{ padding: "6px 8px 6px 0", fontWeight: 500 }}>Cases</th>
              <th style={{ padding: "6px 0", fontWeight: 500 }}>Using</th>
            </tr>
          </thead>
          <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
            {cal.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: "10px 0", color: "var(--ink-muted)" }}>
                  No resolved disputes yet.
                </td>
              </tr>
            ) : (
              cal.map((c) => (
                <tr key={c.reasonCode} style={{ borderTop: "1px solid var(--hairline)" }}>
                  <td style={{ padding: "7px 0" }}>{c.reasonCode.toLowerCase().replace(/_/g, " ")}</td>
                  <td style={{ padding: "7px 0", color: "var(--ink-secondary)" }}>
                    {Math.round((WIN_RATE_PRIORS[c.reasonCode] ?? WIN_RATE_PRIORS.OTHER) * 100)}%
                  </td>
                  <td style={{ padding: "7px 0" }}>
                    {c.observedWinRate === null ? "—" : `${Math.round(c.observedWinRate * 100)}%`}
                  </td>
                  <td style={{ padding: "7px 0", color: "var(--ink-secondary)" }}>{c.sampleSize}</td>
                  <td style={{ padding: "7px 0" }}>
                    <span className={`badge ${c.calibrated ? "badge-good" : "badge-muted"}`}>
                      <span aria-hidden>{c.calibrated ? "●" : "·"}</span>
                      {c.calibrated ? "yours" : "estimate"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
