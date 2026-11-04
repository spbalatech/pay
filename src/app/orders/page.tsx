import { db } from "@/lib/db";
import { OrderGrid, type OrderRow } from "@/components/grids/OrderGrid";
import { Icon, NAV_ICON } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const orders = await db.order.findMany({
    include: { risk: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const activeRules = await db.rule.findMany({ where: { status: "ACTIVE" }, select: { id: true, plainEnglish: true } });
  const ruleText = new Map(activeRules.map((r) => [r.id, r.plainEnglish]));

  // Prisma Decimal and Date do not cross the server/client boundary, so rows
  // are flattened to plain JSON here rather than in the grid.
  const rows: OrderRow[] = orders.map((o) => ({
    id: o.id,
    paypalOrderId: o.paypalOrderId,
    payerEmail: o.payerEmail,
    amount: Number(o.amount),
    createdAt: o.createdAt.toISOString(),
    tier: o.risk?.tier ?? null,
    score: o.risk?.score ?? null,
    recommendation: o.risk?.recommendation ?? null,
    narrative: o.risk?.narrative ?? null,
    signals: (o.risk?.signals as OrderRow["signals"]) ?? [],
    predictedReasonCodes: (o.risk?.predictedReasonCodes as string[]) ?? [],
    shippingLine1: o.shippingLine1,
    multiUnit: o.shippingIsMultiUnit,
    source: o.source,
    matchedRules: ((o.risk?.matchedRuleIds as string[]) ?? []).map((id) => ruleText.get(id) ?? id),
  }));

  const held = rows.filter((r) => r.tier === "HOLD").length;

  return (
    <>
      <div className="page-head">
        <h1 className="page-title"><Icon as={NAV_ICON["/orders"]} size={22} className="title-icon" />Order risk</h1>
        <p className="page-sub">
          Sentinel scores every order before it ships. Scores are computed from weighted signals, not
          written by a language model — select any row to see exactly which signals fired and what
          each one contributed. {held} order{held === 1 ? "" : "s"} currently held.
        </p>
      </div>
      <OrderGrid rows={rows} />
    </>
  );
}
