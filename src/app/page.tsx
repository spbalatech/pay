import Link from "next/link";
import { dashboardMetrics } from "@/agents/metrics";
import { Hero, Tile, SegmentedBar, money, pct } from "@/components/Tiles";
import { RunLoopButton } from "@/components/RunLoopButton";
import { db } from "@/lib/db";
import { capabilities } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const caps = capabilities();
  let m: Awaited<ReturnType<typeof dashboardMetrics>> | null = null;
  let simulatedShare: { total: number; simulated: number } | null = null;

  try {
    m = await dashboardMetrics();
    const [total, simulated] = await Promise.all([
      db.order.count(),
      db.order.count({ where: { source: "SIMULATED" } }),
    ]);
    simulatedShare = { total, simulated };
  } catch (err) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">Setup needed</h1>
          <p className="page-sub">
            The database is not reachable yet. Start Postgres and apply the schema, then reload:
          </p>
        </div>
        <pre className="detail-pre">{`docker compose up -d
npx prisma migrate deploy
npm run seed
npm run agents:run`}</pre>
        <p className="tile-note" style={{ marginTop: 10 }}>{String(err).slice(0, 220)}</p>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Overview</h1>
        <p className="page-sub">
          Aegis prevents disputes before they are filed, defends the ones that land, and turns every
          outcome into a prevention rule. Prevention and defense are counted side by side, because a
          dispute that never happened is the cheapest one.
        </p>
      </div>

      {caps.missing.length > 0 ? (
        <div className="notice">
          <span aria-hidden>⚙</span>
          <span>
            Running without {caps.missing.join(" and ")}. The console, the seeder and
            {caps.ai ? " " : " three of "} the four agents work regardless
            {caps.ai ? "" : " — only the Learner needs a model to propose rules"}. Add the
            values to <code>.env</code> and restart to switch the rest on.
          </span>
        </div>
      ) : null}

      {simulatedShare && simulatedShare.simulated > 0 ? (
        <div className="notice">
          <span aria-hidden>ℹ</span>
          <span>
            {simulatedShare.simulated} of {simulatedShare.total} orders and all disputes are{" "}
            <strong>fixtures</strong> — the PayPal sandbox cannot originate inbound disputes or
            capture a payment without a browser. Every agent <em>action</em> runs against the live
            sandbox API. Simulated rows are badged throughout.
          </span>
        </div>
      ) : null}

      <Hero
        label="Total value protected"
        value={money(m.totalValueProtected)}
        note={`${m.disputesDeflected} dispute${m.disputesDeflected === 1 ? "" : "s"} deflected before filing · ${m.disputesContested} contested`}
      />

      <div className="card">
        <h3 className="card-title">Where the protection came from</h3>
        <SegmentedBar
          parts={[
            { name: "Deflected before filing", value: m.valueDeflected, color: "var(--prevent)" },
            { name: "Retained by defense", value: m.valueRetainedByDefence, color: "var(--defend)" },
          ]}
        />
      </div>

      <div className="tiles">
        <Tile label="Orders assessed" value={m.orders} note={`${m.ordersHeld} held pre-fulfillment`} />
        <Tile
          label="Deflection rate"
          value={pct(m.deflectionRate)}
          note={`${m.watchesOpened} watches opened, ${m.escalatedToDispute} escalated`}
        />
        <Tile
          label="Dispute win rate"
          value={pct(m.winRate)}
          note={`${m.disputesContested} contested, ${m.disputesAccepted} accepted on EV`}
        />
        <Tile label="Open disputes" value={m.disputes} note="across all reason codes" />
        <Tile
          label="Prevention rules"
          value={m.activeRules}
          note={m.proposedRules > 0 ? `${m.proposedRules} awaiting approval` : "none pending"}
        />
      </div>

      <div className="card">
        <h3 className="card-title">The loop</h3>
        <div className="loop">
          <Link href="/orders" className="loop-step">
            <div className="loop-name">SENTINEL</div>
            <div className="loop-phase">prevent · pre-fulfillment</div>
            <div className="loop-stat">{m.ordersHeld}</div>
            <div className="loop-desc">orders held before shipping</div>
          </Link>
          <Link href="/watchlist" className="loop-step">
            <div className="loop-name">INTERCEPTOR</div>
            <div className="loop-phase">prevent · pre-dispute</div>
            <div className="loop-stat">{m.watchesOpened}</div>
            <div className="loop-desc">precursors caught in the deflection window</div>
          </Link>
          <Link href="/disputes" className="loop-step">
            <div className="loop-name">ADVOCATE</div>
            <div className="loop-phase">defend</div>
            <div className="loop-stat">{m.disputes}</div>
            <div className="loop-desc">disputes triaged on expected value</div>
          </Link>
          <Link href="/rulebook" className="loop-step">
            <div className="loop-name">LEARNER</div>
            <div className="loop-phase">learn</div>
            <div className="loop-stat">{m.activeRules + m.proposedRules}</div>
            <div className="loop-desc">rules written from real outcomes</div>
          </Link>
        </div>
        <div style={{ marginTop: 14 }}>
          <RunLoopButton />
        </div>
      </div>
    </>
  );
}
