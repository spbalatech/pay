"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { ColDef } from "ag-grid-community";
import { GridShell, moneyFmt, dateFmt, pctFmt, humanCode } from "./GridShell";
import { RecommendationBadge, SourceBadge, DueCell, StatusCell } from "./cells";
import { Drawer } from "../Drawer";
import { decideDisputeAction } from "@/app/actions";
import { Archive, CalendarClock, Check, CircleDollarSign, FileText, Mail, X } from "lucide-react";
import { Icon, BADGE_ICON } from "../icons";

export type DisputeRow = {
  id: string;
  paypalDisputeId: string;
  reasonCode: string;
  amount: number;
  status: string;
  buyerNote: string | null;
  filedAt: string;
  responseDueAt: string | null;
  source: string;
  paypalOrderId: string | null;
  payerEmail: string | null;
  pWin: number | null;
  evFight: number | null;
  evAccept: number | null;
  evidenceStrength: number | null;
  recommendation: string | null;
  decision: string | null;
  decisionStatus: string | null;
  outcome: string | null;
  rebuttalDraft: string | null;
  evidence: Array<{ kind: string; found: boolean; detail: string; sourceRef?: string }>;
  timeline: Array<{ at: string; what: string; source: string }>;
};

const usd = (n: number) => `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Expected values are stored as signed amounts (a loss is negative). The grid
// shows them as costs, which is how a merchant reads them.
const costFmt = (p: { value: unknown }) => (p.value === null || p.value === undefined ? "" : usd(Number(p.value)));

/** Records quote raw API codes (DHL_GLOBAL_MAIL); show them as words. */
const plain = (text: string) => text.replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, (c) => humanCode(c).toLowerCase());

const isClosed = (d: DisputeRow) => d.decisionStatus === "EXECUTED" || d.status === "RESOLVED" || d.status === "CLOSED";

export function DisputeGrid({ rows }: { rows: DisputeRow[] }) {
  const [selected, setSelected] = useState<DisputeRow | null>(null);
  const [pending, startTransition] = useTransition();
  const close = useCallback(() => setSelected(null), []);

  const columnDefs = useMemo<ColDef<DisputeRow>[]>(
    () => [
      {
        field: "reasonCode",
        headerName: "Reason",
        width: 230,
        valueFormatter: (p) => humanCode(String(p.value)),
        // Reason code is the unit a claims operator thinks in, and the
        // aggregated claim total per code is the number they report upward.
        rowGroup: true,
        hide: true,
      },
      { colId: "status", headerName: "Status", width: 125, valueGetter: (p) => (!p.data ? null : isClosed(p.data) ? (p.data.outcome ?? "CLOSED") : "OPEN"), cellRenderer: StatusCell },
      { field: "payerEmail", headerName: "Payer", minWidth: 175, flex: 1 },
      { field: "amount", headerName: "Claim", width: 118, type: "numericColumn", valueFormatter: moneyFmt, aggFunc: "sum" },
      { field: "pWin", headerName: "Win chance", width: 118, type: "numericColumn", valueFormatter: pctFmt },
      { field: "evFight", headerName: "Cost if fought", width: 135, type: "numericColumn", valueFormatter: costFmt },
      { field: "evAccept", headerName: "Cost if accepted", width: 145, type: "numericColumn", valueFormatter: costFmt },
      { field: "recommendation", headerName: "Aegis says", width: 120, cellRenderer: RecommendationBadge },
      { field: "responseDueAt", headerName: "Deadline", width: 120, cellRenderer: DueCell },
      { field: "filedAt", headerName: "Filed", width: 100, valueFormatter: dateFmt },
      { field: "source", headerName: "", width: 100, cellRenderer: SourceBadge, filter: false, sortable: false },
    ],
    [],
  );

  const decide = (decision: "FIGHT" | "ACCEPT") =>
    selected &&
    startTransition(async () => {
      await decideDisputeAction(selected.id, decision);
      setSelected(null);
    });

  const s = selected;
  const closed = s ? isClosed(s) : false;
  const costFight = s?.evFight != null ? Math.abs(s.evFight) : null;
  const costAccept = s?.evAccept != null ? Math.abs(s.evAccept) : null;
  const saving = costFight !== null && costAccept !== null ? Math.abs(costAccept - costFight) : null;
  const winPct = Math.round((s?.pWin ?? 0) * 100);

  return (
    <>
      <GridShell<DisputeRow>
        rowData={rows}
        columnDefs={columnDefs}
        height={520}
        phoneColumns={["amount", "status"]}
        getRowId={(p) => p.data.id}
        onRowClicked={(e) => setSelected(e.data ?? null)}
        autoGroupColumnDef={{
          headerName: "Reason / dispute",
          field: "paypalDisputeId",
          minWidth: 260,
          cellClass: (p: { node: { group?: boolean } }) => (p.node.group ? "" : "cell-id"),
        }}
      />
      <p className="page-sub" style={{ marginTop: 12 }}>
        Click any dispute to open its case file: what happened, the evidence, the verdict in dollars, and the
        drafted response.
      </p>

      <Drawer
        open={!!s}
        onClose={close}
        kicker={s ? `${humanCode(s.reasonCode)} · ${s.paypalDisputeId}` : null}
        title={s ? `${usd(s.amount)} claim${s.payerEmail ? ` from ${s.payerEmail}` : ""}` : ""}
        footer={
          s && !closed ? (
            <div className="btn-row">
              <button
                className={`btn btn-lg ${s.recommendation === "FIGHT" ? "btn-primary" : ""}`}
                disabled={pending}
                onClick={() => decide("FIGHT")}
              >
                <Icon as={BADGE_ICON.FIGHT} />
                Fight it
              </button>
              <button
                className={`btn btn-lg ${s.recommendation === "ACCEPT" ? "btn-primary" : ""}`}
                disabled={pending}
                onClick={() => decide("ACCEPT")}
              >
                <Icon as={BADGE_ICON.ACCEPT} />
                Accept &amp; refund
              </button>
              <span className="tile-note" style={{ alignSelf: "center" }}>
                Nothing is sent to PayPal until you choose.
              </span>
            </div>
          ) : null
        }
      >
        {s ? (
          <>
            {s.buyerNote ? <blockquote className="quote">“{s.buyerNote}”</blockquote> : null}

            {closed ? (
              <div className="verdict verdict-closed">
                <div className="verdict-label"><Icon as={Archive} size={14} />Closed case</div>
                <div className="verdict-main">
                  {s.decision ? `You chose to ${s.decision.toLowerCase()}` : "Decided"} · outcome{" "}
                  {s.outcome?.toLowerCase() ?? "unknown"}
                </div>
                <p className="verdict-note">
                  Past cases like this are what the Learner studies to write prevention rules.
                </p>
              </div>
            ) : s.recommendation ? (
              <div className={`verdict ${s.recommendation === "FIGHT" ? "verdict-fight" : "verdict-accept"}`}>
                <div className="verdict-label"><Icon as={CircleDollarSign} size={14} />Aegis recommends</div>
                <div className="verdict-main">
                  {s.recommendation === "FIGHT" ? "Fight this dispute" : "Accept and refund"}
                </div>
                {costFight !== null && costAccept !== null ? (
                  <p className="verdict-note">
                    {s.recommendation === "FIGHT"
                      ? `With a ${winPct}% chance to win, fighting is expected to cost ${usd(costFight)} versus ${usd(costAccept)} for refunding — about ${usd(saving ?? 0)} better.`
                      : `With only a ${winPct}% chance to win, fighting is expected to cost ${usd(costFight)} once fees and staff time are counted, versus ${usd(costAccept)} to refund — accepting is about ${usd(saving ?? 0)} cheaper.`}
                  </p>
                ) : null}
              </div>
            ) : null}

            <h3 className="detail-h h-icon"><Icon as={CalendarClock} size={14} />What happened</h3>
            {s.timeline.length ? (
              <ol className="timeline">
                {s.timeline.map((t, i) => (
                  <li key={i}>
                    <span className="timeline-date">
                      {new Date(t.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                    <span>{plain(t.what)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="detail-p muted">No timeline was recorded for this case.</p>
            )}

            <h3 className="detail-h h-icon">
              <Icon as={FileText} size={14} />
              Evidence{s.evidenceStrength != null && !closed ? ` · ${s.evidenceStrength}% strength` : ""}
            </h3>
            {s.evidence.length ? (
              <ul className="checklist">
                {s.evidence.map((e) => (
                  <li key={e.kind}>
                    <span className={e.found ? "check-yes" : "check-missing"} aria-hidden>
                      <Icon as={e.found ? Check : X} size={15} />
                    </span>
                    <span style={{ color: e.found ? "var(--ink)" : "var(--ink-muted)" }}>
                      {e.found ? e.detail : `${humanCode(e.kind)} — ${e.detail.replace(/\.$/, "")}.`}
                      <span className="sr-only">{e.found ? " (found)" : " (missing)"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="detail-p muted">No evidence was gathered — this case closed before Aegis assessed it.</p>
            )}

            {!closed ? (
              <>
                <h3 className="detail-h h-icon"><Icon as={Mail} size={14} />Response letter</h3>
                {s.rebuttalDraft ? (
                  <pre className="detail-pre">{s.rebuttalDraft}</pre>
                ) : (
                  <p className="detail-p muted">
                    {s.recommendation === "FIGHT"
                      ? "Aegis drafts the response letter here, citing only the evidence above, when an AI model is connected."
                      : "No letter needed — the recommendation is to accept."}
                  </p>
                )}
              </>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </>
  );
}
