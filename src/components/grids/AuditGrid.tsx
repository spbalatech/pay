"use client";

import { useMemo } from "react";
import type { ColDef } from "ag-grid-community";
import { GridShell, humanCode } from "./GridShell";

export type AuditRow = {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  at: string;
  payload: string;
};

export function AuditGrid({ rows }: { rows: AuditRow[] }) {
  const columnDefs = useMemo<ColDef<AuditRow>[]>(
    () => [
      { field: "actor", headerName: "Actor", width: 165, rowGroup: true, hide: true },
      {
        field: "at",
        headerName: "When",
        width: 170,
        valueFormatter: (p) =>
          p.value ? new Date(String(p.value)).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "",
        sort: "desc",
      },
      { field: "targetType", headerName: "Target", width: 120 },
      { field: "payload", headerName: "Detail", flex: 1, minWidth: 320, cellStyle: { fontFamily: "var(--mono)", fontSize: "11px" } },
    ],
    [],
  );

  return (
    <GridShell<AuditRow>
      rowData={rows}
      columnDefs={columnDefs}
      height={620}
      phoneColumns={["at"]}
      getRowId={(p) => p.data.id}
      // Leaf rows show their action in the group column, which was otherwise
      // blank under each actor heading, the same way the other queues show ids.
      autoGroupColumnDef={{
        headerName: "Actor / action",
        field: "action",
        minWidth: 240,
        valueFormatter: (p) => (p.value ? humanCode(String(p.value)) : ""),
      }}
    />
  );
}
