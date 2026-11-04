"use client";

import { useEffect, useMemo, useRef } from "react";
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

export function GridShell<T>({
  rowData,
  columnDefs,
  height = 560,
  ...rest
}: {
  rowData: T[];
  columnDefs: ColDef<T>[];
  height?: number;
} & Omit<AgGridReactProps<T>, "rowData" | "columnDefs">) {
  const theme = useResolvedTheme();

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
      style={{ height, width: "100%" }}
    >
      <AgGridReact<T> rowData={rowData} columnDefs={columnDefs} {...options} {...rest} />
    </div>
  );
}

/**
 * The detail card renders below a tall grid, so a row click would otherwise
 * change nothing on screen. Bring the card into view whenever the selection
 * changes.
 */
export function useRevealOnSelect(selected: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [selected]);
  return ref;
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
