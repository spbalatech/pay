import Link from "next/link";
import { dashboardMetrics } from "@/agents/metrics";
import { Hero, Tile, SegmentedBar, money, pct } from "@/components/Tiles";
import { RunLoopButton } from "@/components/RunLoopButton";
import { db } from "@/lib/db";
import { capabilities } from "@/lib/env";
import { aiStatus } from "@/lib/ai";
import { recentActivity, type ActivityItem } from "@/lib/activity";
import { Icon, AGENT_ICON, NAV_ICON } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const caps = capabilities();
  const ai = await aiStatus();
  let m: Awaited<ReturnType<typeof dashboardMetrics>> | null = null;
  let simulatedShare: { total: number; simulated: number } | null = null;
  let activity: ActivityItem[] = [];

  try {
    m = await dashboardMetrics();
    const [total, simulated] = await Promise.all([
      db.order.count(),
      db.order.count({ where: { source: "SIMULATED" } }),
    ]);
    simulatedShare = { total, simulated };
    activity = await recentActivity(6);
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

  const demo = simulatedShare !== null && simulatedShare.simulated > 0;

  return (
    <>
      <div className="page-head page-head-row">
        <div>
          <h1 className="page-title">
            <Icon as={NAV_ICON["/"]} size={22} className="title-icon" />
            Overview
            {demo ? (
              <span className="chip" title="Orders and disputes are demo data; agent actions are real. See About this demo below.">
                Demo data
              </span>
            ) : null}
          </h1>
          <p className="page-sub">
            Aegis stops chargebacks before they are filed, fights the ones worth fighting, and turns
            every outcome into a rule so the same loss does not happen twice.
          </p>
        </div>
        <RunLoopButton />
      </div>

      <Hero
        label="Money protected from chargebacks"
        value={money(m.totalValueProtected)}
        note={`${m.disputesDeflected} dispute${m.disputesDeflected === 1 ? "" : "s"} stopped before filing · ${m.disputesContested} fought`}
      />

      <div className="split">
        <div>
          <div className="card">
            <h3 className="card-title">Where the protection came from</h3>
            <SegmentedBar
              parts={[
                { name: "Stopped before filing", value: m.valueDeflected, color: "var(--prevent)" },
                { name: "Won back by fighting", value: m.valueRetainedByDefence, color: "var(--defend)" },
              ]}
            />
          </div>

          <div className="tiles tiles-2">
            <Tile label="Orders checked" value={m.orders} note={`${m.ordersHeld} held before shipping`} />
            <Tile
              label="Disputes prevented"
              value={pct(m.deflectionRate)}
              note={`of ${m.watchesOpened} early warnings · ${m.escalatedToDispute} became disputes`}
            />
            <Tile
              label="Disputes won"
              value={pct(m.winRate)}
              note={`${m.disputesContested} fought · ${m.disputesAccepted} accepted as cheaper`}
            />
            <Tile label="Open disputes" value={m.openDisputes} note={`${m.disputes} filed in total`} />
          </div>
        </div>

        <div className="card feed-card">
          <h3 className="card-title">What Aegis just did</h3>
          {activity.length === 0 ? (
            <p className="detail-p muted">Nothing yet. Press “Run the agents” to start.</p>
          ) : (
            <ul className="feed">
              {activity.map((a) => (
                <li key={a.id}>
                  <Link href={a.href} className="feed-item">
                    <span className={`feed-agent feed-${a.phase}`}>
                      <Icon as={AGENT_ICON[a.agent] ?? AGENT_ICON.You} size={14} />
                      {a.agent}
                    </span>
                    <span className="feed-text">{a.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/audit" className="feed-more">
            Full audit log →
          </Link>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">How the loop works</h3>
        <div className="loop">
          <Link href="/orders" className="loop-step">
            <div className="loop-name"><Icon as={AGENT_ICON.Sentinel} />Sentinel</div>
            <div className="loop-phase">prevent · before shipping</div>
            <div className="loop-stat">{m.ordersHeld}</div>
            <div className="loop-desc">risky orders held before they ship</div>
          </Link>
          <span className="loop-arrow" aria-hidden>→</span>
          <Link href="/watchlist" className="loop-step">
            <div className="loop-name"><Icon as={AGENT_ICON.Interceptor} />Interceptor</div>
            <div className="loop-phase">prevent · after payment</div>
            <div className="loop-stat">{m.watchesOpened}</div>
            <div className="loop-desc">early warnings caught while the buyer still talks to you</div>
          </Link>
          <span className="loop-arrow" aria-hidden>→</span>
          <Link href="/disputes" className="loop-step">
            <div className="loop-name"><Icon as={AGENT_ICON.Advocate} />Advocate</div>
            <div className="loop-phase">defend</div>
            <div className="loop-stat">{m.disputes}</div>
            <div className="loop-desc">disputes judged on what fighting would cost</div>
          </Link>
          <span className="loop-arrow" aria-hidden>→</span>
          <Link href="/rulebook" className="loop-step">
            <div className="loop-name"><Icon as={AGENT_ICON.Learner} />Learner</div>
            <div className="loop-phase">learn</div>
            <div className="loop-stat">{m.activeRules}</div>
            <div className="loop-desc">
              prevention rules in force{m.proposedRules > 0 ? ` · ${m.proposedRules} awaiting your approval` : ""}
            </div>
          </Link>
        </div>
      </div>

      <details className="notice notice-fold">
        <summary>
          <span aria-hidden>{caps.paypal && ai.available ? "✓" : "ℹ"}</span>
          <span>
            <strong>About this demo</strong> ·{" "}
            {[
              caps.paypal ? "PayPal sandbox connected" : "PayPal sandbox keys not set",
              ai.available ? `AI model: ${ai.provider}` : "AI model not connected",
            ].join(" · ")}
          </span>
          <span className="notice-more">Details</span>
        </summary>
        <div className="notice-body">
          {demo ? (
            <p>
              {simulatedShare!.simulated} of {simulatedShare!.total} orders and all disputes are{" "}
              <strong>demo data</strong> — the PayPal sandbox cannot create inbound disputes or capture
              a payment without a browser. Every agent <em>action</em> runs against the real sandbox
              API. Demo rows are badged throughout.
            </p>
          ) : null}
          {!caps.paypal ? (
            <p>Without PayPal sandbox keys, live writes are off — everything else runs on demo data.</p>
          ) : null}
          {ai.available ? (
            <p>
              AI model: <strong>{ai.provider}</strong> ({ai.reasoning}).
            </p>
          ) : (
            <p>
              No AI model connected: {ai.hint} Scores and dollar verdicts never use AI — they are
              plain arithmetic, so they work regardless. AI writes the response letters and proposes
              new rules.
            </p>
          )}
        </div>
      </details>
    </>
  );
}
