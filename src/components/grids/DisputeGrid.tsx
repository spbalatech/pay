"use client";

import { useMemo, useState, useTransition } from "react";
import type { ColDef } from "ag-grid-community";
import { GridShell, moneyFmt, dateFmt, pctFmt, humanCode } from "./GridShell";
import { RecommendationBadge, SourceBadge, DueCell } from "./cells";
import { decideDisputeAction } from "@/app/actions";

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

export function DisputeGrid({ rows }: { rows: DisputeRow[] }) {
  const [selected, setSelected] = useState<DisputeRow | null>(null);
  const [pending, startTransition] = useTransition();

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
      { field: "paypalDisputeId", headerName: "Dispute", width: 180, cellStyle: { fontFamily: "var(--mono)", fontSize: "11.5px" } },
      { field: "payerEmail", headerName: "Payer", minWidth: 175, flex: 1 },
      { field: "amount", headerName: "Claim", width: 118, type: "numericColumn", valueFormatter: moneyFmt, aggFunc: "sum" },
      { field: "evidenceStrength", headerName: "Evidence", width: 112, type: "numericColumn", valueFormatter: (p) => (p.value == null ? "" : `${p.value}%`) },
      { field: "pWin", headerName: "P(win)", width: 100, type: "numericColumn", valueFormatter: pctFmt },
      { field: "evFight", headerName: "EV fight", width: 115, type: "numericColumn", valueFormatter: moneyFmt },
      { field: "evAccept", headerName: "EV accept", width: 118, type: "numericColumn", valueFormatter: moneyFmt },
      { field: "recommendation", headerName: "Agent says", width: 125, cellRenderer: RecommendationBadge },
      { field: "responseDueAt", headerName: "Deadline", width: 120, cellRenderer: DueCell },
      { field: "filedAt", headerName: "Filed", width: 100, valueFormatter: dateFmt },
      { field: "source", headerName: "", width: 100, cellRenderer: SourceBadge, filter: false, sortable: false },
    ],
    [],
  );

  return (
    <>
      <GridShell<DisputeRow>
        rowData={rows}
        columnDefs={columnDefs}
        height={520}
        getRowId={(p) => p.data.id}
        onRowClicked={(e) => setSelected(e.data ?? null)}
        autoGroupColumnDef={{ headerName: "Reason code", minWidth: 260 }}
      />

      {selected ? (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 className="card-title">
            {humanCode(selected.reasonCode)} · ${selected.amount.toFixed(2)} · {selected.paypalDisputeId}
          </h3>

          {selected.buyerNote ? (
            <p className="detail-p">
              <span style={{ color: "var(--ink-muted)" }}>Buyer: </span>“{selected.buyerNote}”
            </p>
          ) : null}

          <div className="detail-grid">
            <div>
              <h4 className="detail-h">The arithmetic</h4>
              <dl>
                <div className="kv">
                  <dt>Evidence strength</dt>
                  <dd>{selected.evidenceStrength ?? "—"}%</dd>
                </div>
                <div className="kv">
                  <dt>P(win)</dt>
                  <dd>{selected.pWin === null ? "—" : `${Math.round(selected.pWin * 100)}%`}</dd>
                </div>
                <div className="kv">
                  <dt>EV of fighting</dt>
                  <dd>{selected.evFight === null ? "—" : `$${selected.evFight.toFixed(2)}`}</dd>
                </div>
                <div className="kv">
                  <dt>EV of accepting</dt>
                  <dd>{selected.evAccept === null ? "—" : `$${selected.evAccept.toFixed(2)}`}</dd>
                </div>
                <div className="kv">
                  <dt>Recommendation</dt>
                  <dd>{selected.recommendation?.toLowerCase() ?? "—"}</dd>
                </div>
              </dl>

              <div className="btn-row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-primary"
                  disabled={pending || selected.decisionStatus === "EXECUTED"}
                  onClick={() =>
                    startTransition(async () => {
                      await decideDisputeAction(selected.id, "FIGHT");
                      setSelected(null);
                    })
                  }
                >
                  Fight it
                </button>
                <button
                  className="btn"
                  disabled={pending || selected.decisionStatus === "EXECUTED"}
                  onClick={() =>
                    startTransition(async () => {
                      await decideDisputeAction(selected.id, "ACCEPT");
                      setSelected(null);
                    })
                  }
                >
                  Accept & refund
                </button>
              </div>
              {selected.decisionStatus === "EXECUTED" ? (
                <p className="tile-note" style={{ marginTop: 8 }}>
                  Already decided: {selected.decision?.toLowerCase()} · outcome {selected.outcome?.toLowerCase()}
                </p>
              ) : null}
            </div>

            <div>
              <h4 className="detail-h">Evidence checklist</h4>
              <ul className="checklist">
                {selected.evidence.map((e) => (
                  <li key={e.kind}>
                    <span className={e.found ? "check-yes" : "check-no"} aria-hidden>
                      {e.found ? "✓" : "○"}
                    </span>
                    <span style={{ color: e.found ? "var(--ink-secondary)" : "var(--ink-muted)" }}>
                      {e.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="detail-h">Reconstructed timeline</h4>
              <ul className="checklist">
                {selected.timeline.map((t, i) => (
                  <li key={i}>
                    <span className="check-no" style={{ fontVariantNumeric: "tabular-nums", minWidth: 52, fontSize: 11 }}>
                      {new Date(t.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                    <span>{t.what}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {selected.rebuttalDraft ? (
            <>
              <h4 className="detail-h" style={{ marginTop: 14 }}>
                Drafted rebuttal
              </h4>
              <pre className="detail-pre">{selected.rebuttalDraft}</pre>
            </>
          ) : null}
        </div>
      ) : (
        <p className="page-sub" style={{ marginTop: 12 }}>
          Select a dispute to see the evidence, the arithmetic, and the drafted rebuttal.
        </p>
      )}
    </>
  );
}
