import { db } from "@/lib/db";
import { WatchGrid, type WatchRow } from "@/components/grids/WatchGrid";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const watches = await db.watch.findMany({
    include: {
      order: true,
      interventions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: [{ status: "asc" }, { severity: "desc" }],
    take: 500,
  });

  const rows: WatchRow[] = watches.map((w) => {
    const i = w.interventions[0];
    const payload = (i?.payload ?? {}) as { reason?: string; message?: string | null; refundAmount?: number };

    return {
      id: w.id,
      precursor: w.precursor,
      severity: w.severity,
      predictedReasonCode: w.predictedReasonCode,
      amountAtRisk: Number(w.amountAtRisk),
      rationale: w.rationale,
      status: w.status,
      openedAt: w.openedAt.toISOString(),
      orderId: w.orderId,
      paypalOrderId: w.order.paypalOrderId,
      payerEmail: w.order.payerEmail,
      source: w.order.source,
      intervention: i
        ? {
            id: i.id,
            kind: i.kind,
            status: i.status,
            reason: payload.reason ?? "",
            message: payload.message ?? null,
            refundAmount: payload.refundAmount ?? null,
          }
        : null,
    };
  });

  const open = rows.filter((r) => r.status === "OPEN");
  const atRisk = open.reduce((s, r) => s + r.amountAtRisk, 0);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Watchlist</h1>
        <p className="page-sub">
          Disputes that have not been filed yet. Interceptor watches the post-payment lifecycle for
          precursors — a parcel that stopped moving, a missed promise date, a subscription renewed
          after months of silence, a duplicate charge — and intervenes while the buyer is still
          talking to you rather than their bank. {open.length} open, ${atRisk.toFixed(2)} at risk.
        </p>
      </div>
      <WatchGrid rows={rows} />
    </>
  );
}
