"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { ColDef } from "ag-grid-community";
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
      { field: "paypalOrderId", headerName: "Order", width: 185, cellStyle: { fontFamily: "var(--mono)", fontSize: "11.5px" } },
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
      { field: "recommendation", headerName: "Action", width: 115, cellRenderer: RecommendationBadge },
      { field: "createdAt", headerName: "Placed", width: 105, valueFormatter: dateFmt },
      { field: "source", headerName: "", width: 100, cellRenderer: SourceBadge, filter: false, sortable: false },
    ],
    [],
  );

  const onOverride = useCallback((orderId: string, rec: "SHIP" | "HOLD") => {
    startTransition(async () => {
      await overrideOrderAction(orderId, rec);
    });
  }, []);

  return (
    <>
      <GridShell<OrderRow>
        rowData={rows}
        columnDefs={columnDefs}
        height={520}
        getRowId={(p) => p.data.id}
        onRowClicked={(e) => setSelected(e.data ?? null)}
        getRowClass={(p) =>
          p.data?.tier === "HOLD" ? "row-hold" : p.data?.tier === "REVIEW" ? "row-review" : ""
        }
        autoGroupColumnDef={{ headerName: "Risk tier", minWidth: 190, cellRendererParams: { suppressCount: false } }}
      />

      {selected ? (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 className="card-title">
            {selected.paypalOrderId} · ${selected.amount.toFixed(2)} · {selected.payerEmail}
          </h3>

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
                  <dt>Multi-unit</dt>
                  <dd>{selected.multiUnit ? "yes" : "no"}</dd>
                </div>
              </dl>

              <h4 className="detail-h" style={{ marginTop: 12 }}>
                Likely reason codes
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

              <div className="btn-row" style={{ marginTop: 14 }}>
                <button className="btn" disabled={pending} onClick={() => onOverride(selected.id, "SHIP")}>
                  Override: ship anyway
                </button>
                <button className="btn btn-danger" disabled={pending} onClick={() => onOverride(selected.id, "HOLD")}>
                  Hold
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="page-sub" style={{ marginTop: 12 }}>
          Select a row to see the signals behind its score.
        </p>
      )}
    </>
  );
}
