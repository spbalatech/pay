import { db } from "@/lib/db";
import { AuditGrid, type AuditRow } from "@/components/grids/AuditGrid";
import { Icon, NAV_ICON } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const logs = await db.auditLog.findMany({ orderBy: { at: "desc" }, take: 1000 });

  const rows: AuditRow[] = logs.map((l) => ({
    id: l.id,
    actor: l.actor,
    action: l.action,
    targetType: l.targetType,
    targetId: l.targetId,
    at: l.at.toISOString(),
    payload: JSON.stringify(l.payload),
  }));

  return (
    <>
      <div className="page-head">
        <h1 className="page-title"><Icon as={NAV_ICON["/audit"]} size={22} className="title-icon" />Audit log</h1>
        <p className="page-sub">
          Every agent decision and every human override, in order. Grouped by actor so you can see
          what the agents did on their own and what a person signed off. This is the record a
          merchant needs when a customer asks why something happened.
        </p>
      </div>
      <AuditGrid rows={rows} />
    </>
  );
}
