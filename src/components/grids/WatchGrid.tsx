"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { ColDef } from "ag-grid-community";
import { Drawer } from "../Drawer";
import { GridShell, moneyFmt, dateFmt, humanCode } from "./GridShell";
import { SourceBadge, ScoreCell } from "./cells";
import { approveInterventionAction, dismissWatchAction } from "@/app/actions";
import { Check, Mail, Send, TriangleAlert, X } from "lucide-react";
import type { ICellRendererParams } from "ag-grid-community";
import { Icon, WARNING_ICON } from "../icons";

/** Warning-sign name with its icon (group rows of the watchlist). */
function WarningCell(p: ICellRendererParams) {
  if (!p.value) return null;
  return (
    <span className="with-icon">
      <Icon as={WARNING_ICON[String(p.value)] ?? TriangleAlert} size={15} />
      {p.valueFormatted ?? humanCode(String(p.value))}
    </span>
  );
}

export type WatchRow = {
  id: string;
  precursor: string;
  severity: number;
  predictedReasonCode: string;
  amountAtRisk: number;
  rationale: string;
  status: string;
  openedAt: string;
  orderId: string;
  paypalOrderId: string;
  payerEmail: string;
  source: string;
  intervention: {
    id: string;
    kind: string;
    status: string;
    reason: string;
    message: string | null;
    refundAmount: number | null;
  } | null;
};

const KIND_LABEL: Record<string, string> = {
  OUTREACH: "Reach out",
  TRACKING_RESEND: "Resend tracking",
  PREEMPTIVE_REFUND: "Refund now",
  SUBSCRIPTION_PAUSE: "Pause subscription",
  FULFILLMENT_HOLD: "Hold fulfillment",
};

export function WatchGrid({ rows }: { rows: WatchRow[] }) {
  const [selected, setSelected] = useState<WatchRow | null>(null);
  const close = useCallback(() => setSelected(null), []);
  const [pending, startTransition] = useTransition();

  const columnDefs = useMemo<ColDef<WatchRow>[]>(
    () => [
      {
        field: "precursor",
        headerName: "Warning sign",
        width: 190,
        valueFormatter: (p) => (p.value ? humanCode(String(p.value)) : ""),
        cellRenderer: WarningCell,
        rowGroup: true,
        hide: true,
      },
      { field: "payerEmail", headerName: "Payer", minWidth: 180, flex: 1 },
      {
        field: "amountAtRisk",
        headerName: "At risk",
        width: 120,
        type: "numericColumn",
        valueFormatter: moneyFmt,
        aggFunc: "sum",
      },
      { field: "severity", headerName: "Severity", width: 130, cellRenderer: ScoreCell },
      {
        field: "predictedReasonCode",
        headerName: "Would become",
        width: 180,
        valueFormatter: (p) => (p.value ? humanCode(String(p.value)) : ""),
      },
      {
        colId: "proposed",
        headerName: "Proposed",
        width: 165,
        valueGetter: (p) => (p.data?.intervention ? KIND_LABEL[p.data.intervention.kind] ?? p.data.intervention.kind : "—"),
      },
      { field: "status", headerName: "Status", width: 125, valueFormatter: (p) => (p.value ? humanCode(String(p.value)) : "") },
      { field: "openedAt", headerName: "Opened", width: 105, valueFormatter: dateFmt },
      { field: "source", headerName: "", width: 100, cellRenderer: SourceBadge, filter: false, sortable: false },
    ],
    [],
  );

  return (
    <>
      <GridShell<WatchRow>
        rowData={rows}
        columnDefs={columnDefs}
        height={470}
        phoneColumns={["amountAtRisk"]}
        getRowId={(p) => p.data.id}
        onRowClicked={(e) => setSelected(e.data ?? null)}
        getRowClass={(p) => (p.data && p.data.severity >= 75 ? "row-hold" : p.data && p.data.severity >= 55 ? "row-review" : "")}
        autoGroupColumnDef={{
          headerName: "Warning sign / order",
          field: "paypalOrderId",
          minWidth: 240,
          cellClass: (p: { node: { group?: boolean } }) => (p.node.group ? "" : "cell-id"),
        }}
      />

      {selected ? (
        <Drawer
          open
          onClose={close}
          title={
            <>
              <Icon as={WARNING_ICON[selected.precursor] ?? TriangleAlert} size={18} className="title-icon" />{" "}
              {humanCode(selected.precursor)} · {selected.paypalOrderId} · ${selected.amountAtRisk.toFixed(2)} at risk
            </>
          }
        >

          <p className="detail-p">{selected.rationale}</p>

          {selected.intervention ? (
            <div className="detail-grid">
              <div>
                <h4 className="detail-h">
                  Proposed: {KIND_LABEL[selected.intervention.kind] ?? selected.intervention.kind}
                </h4>
                <p className="detail-p">{selected.intervention.reason}</p>

                {selected.intervention.refundAmount !== null ? (
                  <dl>
                    <div className="kv">
                      <dt>Refund amount</dt>
                      <dd>${selected.intervention.refundAmount.toFixed(2)}</dd>
                    </div>
                    <div className="kv">
                      <dt>Approval</dt>
                      <dd>{selected.intervention.status === "AUTO_APPROVED" ? "within policy ceiling" : "needs a human"}</dd>
                    </div>
                  </dl>
                ) : null}

                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-primary"
                    disabled={pending || selected.intervention.status === "EXECUTED"}
                    onClick={() =>
                      startTransition(async () => {
                        await approveInterventionAction(selected.intervention!.id);
                        setSelected(null);
                      })
                    }
                  >
                    <Icon as={selected.intervention.status === "EXECUTED" ? Check : Send} />
                    {selected.intervention.status === "EXECUTED" ? "Executed" : "Approve & send"}
                  </button>
                  <button
                    className="btn"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await dismissWatchAction(selected.id);
                        setSelected(null);
                      })
                    }
                  >
                    <Icon as={X} />
                    Dismiss
                  </button>
                </div>
              </div>

              {selected.intervention.message ? (
                <div>
                  <h4 className="detail-h h-icon"><Icon as={Mail} size={14} />Drafted message</h4>
                  <pre className="detail-pre">{selected.intervention.message}</pre>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="detail-p">No intervention proposed yet.</p>
          )}
        </Drawer>
      ) : (
        <p className="page-sub" style={{ marginTop: 12 }}>
          Select a row to see why it was flagged and what the agent proposes to do about it.
        </p>
      )}
    </>
  );
}
