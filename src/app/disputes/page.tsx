import { db } from "@/lib/db";
import { DisputeGrid, type DisputeRow } from "@/components/grids/DisputeGrid";
import { Icon, NAV_ICON } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function DisputesPage() {
  const disputes = await db.dispute.findMany({
    include: { assessment: true, order: true },
    orderBy: [{ status: "asc" }, { responseDueAt: "asc" }],
    take: 500,
  });

  const rows: DisputeRow[] = disputes.map((d) => ({
    id: d.id,
    paypalDisputeId: d.paypalDisputeId,
    reasonCode: d.reasonCode,
    amount: Number(d.amount),
    status: d.status,
    buyerNote: d.buyerNote,
    filedAt: d.filedAt.toISOString(),
    responseDueAt: d.responseDueAt?.toISOString() ?? null,
    source: d.source,
    paypalOrderId: d.order?.paypalOrderId ?? null,
    payerEmail: d.order?.payerEmail ?? null,
    pWin: d.assessment?.pWin ?? null,
    evFight: d.assessment ? Number(d.assessment.evFight) : null,
    evAccept: d.assessment ? Number(d.assessment.evAccept) : null,
    evidenceStrength: d.assessment?.evidenceStrength ?? null,
    recommendation: d.assessment?.recommendation ?? null,
    decision: d.assessment?.decision ?? null,
    decisionStatus: d.assessment?.decisionStatus ?? null,
    executedAt: d.assessment?.executedAt?.toISOString() ?? null,
    outcome: d.assessment?.outcome ?? null,
    rebuttalDraft: d.assessment?.rebuttalDraft ?? null,
    evidence: (d.assessment?.evidence as DisputeRow["evidence"]) ?? [],
    timeline: (d.assessment?.timeline as DisputeRow["timeline"]) ?? [],
  }));

  const isOpen = (r: DisputeRow) => r.status !== "RESOLVED" && r.status !== "CLOSED";
  // Open cases first: they are the ones with a deadline, and the first row a
  // visitor clicks should be one with a full case file.
  rows.sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)));
  const open = rows.filter(isOpen);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title"><Icon as={NAV_ICON["/disputes"]} size={22} className="title-icon" />Disputes</h1>
        <p className="page-sub">
          Advocate reconstructs each order&rsquo;s timeline from PayPal&rsquo;s own records, checks the
          evidence that matters for that reason code, and decides in dollars whether fighting is
          worth it. Accepting is a real answer: on a small claim, winning can still cost more than
          the claim. {open.length} open.
        </p>
      </div>
      <DisputeGrid rows={rows} />
    </>
  );
}
