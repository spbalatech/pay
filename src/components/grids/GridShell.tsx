"use client";

import { useEffect, useMemo, useState } from "react";
import { AgGridReact, type AgGridReactProps } from "ag-grid-react";
import type { ColDef, GridOptions } from "ag-grid-community";
import { useResolvedTheme } from "../ThemeToggle";

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import "ag-grid-enterprise";
import { LicenseManager } from "ag-grid-enterprise";

// Enterprise runs unlicensed in development with a watermark. Row grouping,
// master/detail, the status bar and the aggregation footers below are all
// Enterprise features and are what these queues are actually built on.
const key = process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY;
if (key) LicenseManager.setLicenseKey(key);

export const defaultColDef: ColDef = {
  sortable: true,
  filter: true,
  resizable: true,
};

/** Matches the layout's own phone breakpoint in globals.css. */
const PHONE_QUERY = "(max-width: 760px)";
const PHONE_HEADER = { suppressHeaderMenuButton: true, suppressHeaderFilterButton: true } as const;

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    setPhone(mq.matches);
    const on = (e: MediaQueryListEvent) => setPhone(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

export function GridShell<T>({
  rowData,
  columnDefs,
  height = 560,
  phoneColumns,
  autoGroupColumnDef,
  ...rest
}: {
  rowData: T[];
  columnDefs: ColDef<T>[];
  height?: number;
  /**
   * Columns (by colId or field) to keep on a phone, besides the group column.
   * A phone fits two or three columns, so each queue names the ones that carry
   * the decision (amount, risk, status) and the rest stay one tap away in the
   * row's detail panel. On a phone the grid also grows to fit its rows, so the
   * page scrolls instead of the grid trapping the thumb.
   */
  phoneColumns?: string[];
} & Omit<AgGridReactProps<T>, "rowData" | "columnDefs">) {
  const theme = useResolvedTheme();
  const phone = useIsPhone() && !!phoneColumns;

  const cols = useMemo<ColDef<T>[]>(() => {
    if (!phone || !phoneColumns) return columnDefs;
    return columnDefs.map((c) => {
      if (c.rowGroup) return c;
      const keep = phoneColumns.includes(c.colId ?? String(c.field));
      // Header menu/filter icons would eat most of a 100px heading on a phone.
      return keep ? { ...c, ...PHONE_HEADER, hide: false, width: undefined, minWidth: 72, flex: 1 } : { ...c, hide: true };
    });
  }, [columnDefs, phoneColumns, phone]);

  // When the grouped column draws plain text (no badge renderer), a phone puts
  // the count inside the name, so a wrapped name ends "...described (7)"
  // instead of leaving "(7)" floating beside a three-line block.
  const plainGroupText = !columnDefs.some((c) => c.rowGroup && c.cellRenderer);

  const groupCol = useMemo(
    () =>
      phone && autoGroupColumnDef
        ? {
            ...autoGroupColumnDef,
            ...PHONE_HEADER,
            minWidth: 120,
            flex: 1.6,
            // Group names ("Significantly not as described") wrap rather than truncate.
            wrapText: true,
            autoHeight: true,
            ...(plainGroupText
              ? {
                  cellRendererParams: {
                    ...autoGroupColumnDef.cellRendererParams,
                    suppressCount: true,
                    innerRenderer: (p: { node: { group?: boolean; allChildrenCount?: number | null }; value: unknown; valueFormatted?: string | null }) => {
                      const text = String(p.valueFormatted ?? p.value ?? "");
                      return p.node.group ? `${text} (${p.node.allChildrenCount ?? 0})` : text;
                    },
                  },
                }
              : {}),
          }
        : autoGroupColumnDef,
    [phone, autoGroupColumnDef, plainGroupText],
  );

  const options: GridOptions<T> = useMemo(
    () => ({
      defaultColDef,
      animateRows: true,
      suppressAggFuncInHeader: true,
      groupDefaultExpanded: 1,
      rowGroupPanelShow: "always",
      // The merchant's own aggregate: total exposure sitting in this queue.
      grandTotalRow: "bottom",
      statusBar: {
        statusPanels: [
          { statusPanel: "agTotalAndFilteredRowCountComponent", align: "left" },
          { statusPanel: "agAggregationComponent", align: "right" },
        ],
      },
    }),
    [],
  );

  return (
    <div
      className={theme === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"}
      style={{ height: phone ? undefined : height, width: "100%" }}
    >
      <AgGridReact<T>
        // Remount when the layout flips (e.g. a rotated tablet) so no column
        // state hidden or resized for one layout leaks into the other.
        key={phone ? "phone" : "wide"}
        rowData={rowData}
        columnDefs={cols}
        autoGroupColumnDef={groupCol}
        domLayout={phone ? "autoHeight" : "normal"}
        {...options}
        {...rest}
      />
    </div>
  );
}

/* ----------------------------------------------------------- formatters */

export const moneyFmt = (p: { value: unknown }) =>
  p.value === null || p.value === undefined
    ? ""
    : `$${Number(p.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const dateFmt = (p: { value: unknown }) =>
  p.value ? new Date(String(p.value)).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

export const pctFmt = (p: { value: unknown }) =>
  p.value === null || p.value === undefined ? "" : `${Math.round(Number(p.value) * 100)}%`;

/** Reason codes are long and SHOUTY; the grid reads better in sentence case. */
export const humanCode = (code: string) =>
  code
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
