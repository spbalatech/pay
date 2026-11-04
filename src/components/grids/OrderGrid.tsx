"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { ColDef } from "ag-grid-community";
import { Drawer } from "../Drawer";
import { GridShell, moneyFmt, dateFmt } from "./GridShell";
import { TierBadge, RecommendationBadge, SourceBadge, ScoreCell } from "./cells";
import { overrideOrderAction } from "@/app/actions";

export type OrderRow = {
  id: string;
  paypalOrderId: string;
  payerEmail: string;
  amount: number;
  createdAt: string;
  tier: string | null;
  score: number | null;
  recommendation: string | null;
  narrative: string | null;
  signals: Array<{ code: string; weight: number; detail: string }>;
  predictedReasonCodes: string[];
  shippingLine1: string | null;
  multiUnit: boolean;
  source: string;
  matchedRules: string[];
};

export function OrderGrid({ rows }: { rows: OrderRow[] }) {
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const close = useCallback(() => setSelected(null), []);
  const [pending, startTransition] = useTransition();

  const columnDefs = useMemo<ColDef<OrderRow>[]>(
    () => [
      {
        field: "tier",
        headerName: "Tier",
        width: 118,
        cellRenderer: TierBadge,
        // Grouping by tier is how an operator actually works this queue:
        // clear the holds first, then the reviews.
        rowGroup: true,
        hide: true,
      },
      { field: "payerEmail", headerName: "Payer", minWidth: 190, flex: 1 },
      {
        field: "amount",
        headerName: "Amount",
        width: 125,
        type: "numericColumn",
        valueFormatter: moneyFmt,
        aggFunc: "sum",
      },
      { field: "score", headerName: "Risk", width: 130, cellRenderer: ScoreCell },
      {
        // AG Grid sparkline: one bar per signal that fired, red pushes risk up,
        // green pulls it down. Shows *why* a score is high without opening the row.
        headerName: "Why",
        colId: "signalMix",
        width: 120,
        filter: false,
        sortable: false,
        valueGetter: (p) => (p.data?.signals ?? []).map((s) => s.weight).sort((a, b) => b - a),
        cellRenderer: "agSparklineCellRenderer",
        cellRendererParams: {
          sparklineOptions: {
            type: "column",
            paddingInner: 0.3,
            padding: { top: 6, bottom: 6 },
            axis: { strokeWidth: 0 },
            formatter: (params: { yValue: number }) => ({ fill: params.yValue > 0 ? "#d03b3b" : "#0ca30c" }),
          },
        },
        headerTooltip: "Each bar is a risk signal that fired; red raises the score, green lowers it.",
      },
      { field: "recommendation", headerName: "Action", width: 115, cellRenderer: RecommendationBadge },
      { field: "createdAt", headerName: "Placed", width: 105, valueFormatter: dateFmt },
      { field: "source", headerName: "", width: 100, cellRenderer: SourceBadge, filter: false, sortable: false },
    ],
    [],
  );

  const onOverride = useCallback((orderId: string, rec: "SHIP" | "HOLD") => {
    startTransition(async () => {
      await overrideOrderAction(orderId, rec);
      // The panel holds a copy of the row; close it so stale buttons never show.
      setSelected(null);
    });
  }, []);

  return (
    <>
      <GridShell<OrderRow>
        rowData={rows}
        columnDefs={columnDefs}
        height={520}
        phoneColumns={["amount", "score"]}
        getRowId={(p) => p.data.id}
        onRowClicked={(e) => setSelected(e.data ?? null)}
        getRowClass={(p) =>
          p.data?.tier === "HOLD" ? "row-hold" : p.data?.tier === "REVIEW" ? "row-review" : ""
        }
        autoGroupColumnDef={{
          // Leaf rows put the order id in the group column instead of leaving it blank.
          headerName: "Tier / order",
          field: "paypalOrderId",
          minWidth: 210,
          cellRendererParams: { suppressCount: false },
          cellClass: (p: { node: { group?: boolean } }) => (p.node.group ? "" : "cell-id"),
        }}
      />

      {selected ? (
        <Drawer open onClose={close} title={<>{selected.paypalOrderId} · ${selected.amount.toFixed(2)} · {selected.payerEmail}</>}>

          <p className="detail-p">{selected.narrative ?? "No narrative generated."}</p>

          <div className="detail-grid">
            <div>
              <h4 className="detail-h">Signals that fired</h4>
              <ul className="checklist">
                {selected.signals.length === 0 ? (
                  <li style={{ color: "var(--ink-muted)" }}>None — baseline risk only.</li>
                ) : (
                  selected.signals
                    .slice()
                    .sort((a, b) => b.weight - a.weight)
                    .map((s) => (
                      <li key={s.code}>
                        <span
                          className={s.weight > 0 ? "check-no" : "check-yes"}
                          style={{ fontVariantNumeric: "tabular-nums", minWidth: 34 }}
                        >
                          {s.weight > 0 ? `+${s.weight}` : s.weight}
                        </span>
                        <span>{s.detail}</span>
                      </li>
                    ))
                )}
              </ul>
            </div>

            <div>
              <h4 className="detail-h">Shipping</h4>
              <dl>
                <div className="kv">
                  <dt>Address</dt>
                  <dd>{selected.shippingLine1 ?? "—"}</dd>
                </div>
                <div className="kv">
                  <dt>Shared building (flat, unit)</dt>
                  <dd>{selected.multiUnit ? "yes" : "no"}</dd>
                </div>
              </dl>

              <h4 className="detail-h" style={{ marginTop: 12 }}>
                If disputed, likely as
              </h4>
              <p className="detail-p" style={{ margin: 0 }}>
                {selected.predictedReasonCodes.length
                  ? selected.predictedReasonCodes.join(", ").toLowerCase().replace(/_/g, " ")
                  : "none indicated"}
              </p>

              {selected.matchedRules.length > 0 ? (
                <>
                  <h4 className="detail-h" style={{ marginTop: 12 }}>
                    Prevention rules matched
                  </h4>
                  <ul className="checklist">
                    {selected.matchedRules.map((r) => (
                      <li key={r}>
                        <span className="check-yes">▸</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {/* Offer only the action that changes something: no "Hold" on an order already held. */}
              <div className="btn-row" style={{ marginTop: 14 }}>
                {selected.recommendation !== "SHIP" ? (
                  <button className="btn" disabled={pending} onClick={() => onOverride(selected.id, "SHIP")}>
                    {selected.recommendation === "HOLD" ? "Release: ship anyway" : "Approve: ship it"}
                  </button>
                ) : null}
                {selected.recommendation !== "HOLD" ? (
                  <button className="btn btn-danger" disabled={pending} onClick={() => onOverride(selected.id, "HOLD")}>
                    Hold this order
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </Drawer>
      ) : (
        <p className="page-sub" style={{ marginTop: 12 }}>
          Select a row to see the signals behind its score.
        </p>
      )}
    </>
  );
}
