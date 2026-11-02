# Aegis

**A closed-loop chargeback defense agent for PayPal merchants. It prevents disputes before they're filed, defends the ones that land, and turns every outcome into a prevention rule — so the same loss doesn't happen twice.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com).

---

## The problem

Merchants fight chargebacks one at a time and learn nothing from them. Evidence gets assembled by hand, under a deadline, by whoever has time — so cases are lost by default, not on the merits. And the usual answer, a fraud score at checkout, misses most of the damage: the majority of chargebacks aren't stolen cards. They're a parcel that stopped moving, a subscription the buyer forgot, a duplicate charge, an unrecognised statement descriptor. A fraud engine is blind to all of it.

Aegis is merchant-side and lifecycle-wide. It watches what happens *after* the payment, where most disputes are actually born.

## The loop

```
         ┌──────────────── LEARNER ◄─────────────────┐
         │        (outcome → prevention rule)        │
         ▼                                           │
    SENTINEL   ──────►   INTERCEPTOR   ──────►   ADVOCATE
  order risk,          pre-dispute               dispute
  pre-fulfillment      deflection                defense
   [PREVENT]            [PREVENT]                [DEFEND]
```

| Agent | Runs on | Does |
|---|---|---|
| **Sentinel** | new orders, pre-fulfillment | Scores dispute risk from payer history, amount outliers, address geometry and velocity. Recommends ship / verify / hold, citing the signals that fired. Enforces merchant-approved prevention rules. |
| **Interceptor** | the post-payment lifecycle | Detects dispute *precursors* — stalled tracking, missed promise dates, dormant subscription renewals, duplicate charges, silent high-value deliveries — and intervenes inside the window where the buyer is still talking to the merchant rather than their bank. |
| **Advocate** | filed disputes | Reconstructs the order's timeline from PayPal's own records, checks the evidence that matters for that reason code, computes whether fighting is worth it **in dollars**, and drafts an evidence-cited rebuttal. Accepting is a valid answer and often the correct one. |
| **Learner** | resolved outcomes | Finds the shapes that keep costing this merchant money and proposes a prevention rule in plain English for a human to approve. Approved rules are enforced by Sentinel. Also recalibrates the win-rate priors from observed results. |

### Why the scores are not written by a language model

Risk scores and expected values are computed in plain arithmetic from facts the system can point at ([`src/agents/signals.ts`](src/agents/signals.ts), [`src/agents/ev.ts`](src/agents/ev.ts)). The model's jobs are the ones language is actually good at: explaining which signals fired, drafting buyer outreach, writing rebuttals, and proposing rules. It never invents a number.

That split is deliberate. A merchant who asks "why did you hold my order?" gets a list of weighted signals, not a vibe, and the same inputs produce the same score on every run.

The expected-value model is explicit and auditable:

```
EV(fight)  = P(win) × 0 + (1 − P(win)) × −(claim + dispute fee) − staff cost
EV(accept) = −claim − handling
```

Win-rate priors per reason code are **documented starting estimates, not measured truths** ([`WIN_RATE_PRIORS`](src/agents/ev.ts)). The Learner replaces them with this merchant's own observed rates once there are at least 5 resolved cases for a reason code.

### The rule language is closed on purpose

The Learner can only compose predicates that already exist in [`src/agents/rules.ts`](src/agents/rules.ts), and every proposal must cite at least three real disputes it would have prevented. Proposals citing anything else are discarded before they reach a human. An approved rule cannot do something the merchant never sanctioned.

### Autonomy limits belong to the merchant

Set in `.env`, enforced in code:

| Setting | Default | Meaning |
|---|---|---|
| `AEGIS_AUTO_ACCEPT_CEILING_USD` | 35 | Auto-accept a dispute at or below this claim when EV says accept |
| `AEGIS_AUTO_REFUND_CEILING_USD` | 25 | Interceptor may refund preemptively up to this amount without approval |
| `AEGIS_HOLD_THRESHOLD` | 70 | Sentinel holds orders at or above this risk score |

A rebuttal always needs a human: it goes out in the merchant's name.

**Auto-accept ships disabled.** PayPal's integration guidance is explicit that a dispute claim should never be accepted automatically without review, so `AEGIS_AUTO_ACCEPT_CEILING_USD` defaults to `0` and a merchant has to opt in. With it off the Advocate still does all of the work — evidence, expected value, a recommendation, a drafted rebuttal — and a human presses the button. That is the intended shape: the agent removes the 40 minutes of assembly, not the decision. Before any `accept-claim` call the agent re-reads the dispute and checks `allowed_response_options`, because which actions are legal changes with the lifecycle stage.

## PayPal integration

| Area | Endpoints |
|---|---|
| Orders | `POST /v2/checkout/orders`, `GET /v2/checkout/orders/{id}` |
| Payments | `POST /v2/payments/captures/{id}/refund`, `GET /v2/payments/refunds/{id}` |
| Disputes | `GET /v1/customer/disputes`, `GET /v1/customer/disputes/{id}`, `POST /v1/customer/disputes/{id}/accept-claim` |
| Transaction search | `GET /v1/reporting/transactions` |
| Shipment tracking | `POST /v1/shipping/trackers-batch`, `GET`/`PUT /v1/shipping/trackers/{id}` |
| Invoicing | `POST /v2/invoicing/invoices`, `POST .../send`, `GET /v2/invoicing/invoices` |
| Catalog | `POST /v1/catalogs/products` |
| Webhooks | `POST /v1/notifications/verify-webhook-signature`, `GET`/`POST`/`DELETE /v1/notifications/webhooks`, `POST /v1/notifications/simulate-event` |
| Subscriptions | `POST /v1/billing/plans`, `GET`/`POST /v1/billing/subscriptions/{id}` |

All calls go through one client with token caching, idempotency keys on writes, and backoff on 429/5xx: [`src/lib/paypal/client.ts`](src/lib/paypal/client.ts).

### Two transports

Aegis reaches PayPal through its own REST client **or** through PayPal's official MCP
server (`@paypal/mcp`), selected by `AEGIS_PAYPAL_TRANSPORT=rest|mcp`. The MCP server
is launched over stdio and handed the token the REST client already caches.

```bash
npm run mcp:check    # connect, list the 28 tools, make real sandbox calls
```

Five operations route either way — `list_disputes`, `get_dispute`, `create_refund`,
`create_invoice`, `list_transactions` ([`src/lib/paypal/transport.ts`](src/lib/paypal/transport.ts)).
REST stays the default because it reaches further: transaction search, webhook
registration and signature verification, and tracker updates have no MCP tool, so the
transport routes what the MCP server exposes and leaves the rest on REST rather than
implying equal coverage.

Note that the MCP tool schemas are **not** the REST bodies — `create_invoice` flattens
`detail.currency_code` to the top level. Read the schemas from `tools/list`.

## Webhooks

`POST /api/webhooks/paypal` is how a production dispute reaches Aegis. It follows PayPal's integration guidance exactly:

- **Signature verified before anything is trusted.** An unverified endpoint accepts a POST from anyone, and this one creates disputes and can trigger refunds. Verification uses the **raw request body** — re-serializing the JSON changes the bytes the signature covers.
- **200 returned inside PayPal's 30-second window**, with processing done after. Ingesting a dispute means a PayPal fetch plus a model call; doing that inline guarantees a timeout and a duplicate delivery.
- **Idempotent.** PayPal retries for up to three days until it sees a 200, so the same event *will* arrive twice. Every delivery is recorded by its event id and a replay returns `200 duplicate` without re-running anything.
- **Explicit event subscriptions**, not a wildcard.

Unverified events are stored for inspection and never acted on. Verified behaviour, tested:

| Request | Response |
|---|---|
| Missing any of the five `PAYPAL-*` headers | `400` |
| Headers present, signature invalid | `401`, stored with `verified=false`, not processed |
| Same event id twice | `200 duplicate`, no reprocessing |
| Genuine `CUSTOMER.DISPUTE.CREATED` | `200 accepted`, dispute matched to its order by capture id, assessed by the Advocate, and any open watch on that order marked `ESCALATED_TO_DISPUTE` |

```bash
npm run webhook -- register https://<your-tunnel>/api/webhooks/paypal
npm run webhook -- list          # then put the id in PAYPAL_WEBHOOK_ID
npm run webhook -- simulate CUSTOMER.DISPUTE.CREATED
curl localhost:3000/api/webhooks/paypal   # liveness + event counts
```

PayPal must reach the URL from the public internet, so use a tunnel (ngrok, cloudflared) locally. Note that `simulate-event` produces events that **can never pass real signature verification** — acting on one locally requires setting `AEGIS_WEBHOOK_ALLOW_UNVERIFIED=true`, which the handler warns about loudly and which must never be set in production.

## Running it

### Requirements
- Node 18+
- Docker (for Postgres), or any Postgres 14+
- A PayPal sandbox app: https://developer.paypal.com/dashboard/applications/sandbox
- An Anthropic API key

```bash
git clone <this repo> && cd aegis
npm install
cp .env.example .env     # then fill in the values below
docker compose up -d     # Postgres on :55439
npx prisma migrate deploy
npm run seed             # creates a 90-day merchant history
npm run agents:run       # one full pass of the loop
npm run dev              # console at http://localhost:3000
```

Only `DATABASE_URL` is required to start. For the model, use **either** an Anthropic key **or** a local Ollama — see *AI tools used* below:

```
DATABASE_URL=postgresql://aegis:aegis@localhost:55439/aegis
PAYPAL_CLIENT_ID=          # optional — sandbox app credentials
PAYPAL_CLIENT_SECRET=      # optional
AEGIS_AI_PROVIDER=auto     # auto | anthropic | ollama | none
ANTHROPIC_API_KEY=         # optional, for the hosted path
OLLAMA_MODEL=llama3.1:8b   # optional, for the local path
```

### Running without credentials

PayPal sandbox approval can take days and phone verification fails outright in
some countries, so the app treats missing credentials as a supported state
rather than a crash. `npm run seed -- --offline` seeds a complete 90-day
history without calling PayPal, and the console names what is switched off.

| Missing | What still works | What stops |
|---|---|---|
| PayPal credentials | Everything in the console; all four agents; the full offline seeder | Live sandbox writes — real orders, invoices, refunds, accept-claim, tracking |
| No model provider | Sentinel, Interceptor and Advocate in full — their scores and expected values are arithmetic, not model output | The Learner proposes no rules; narratives and drafted messages fall back to plain summaries |
| Both | Risk scoring, precursor detection, EV decisions, the whole UI | As above |

That the first three agents keep working without a model is not a fallback —
it is the architecture. Only the parts that are genuinely language work depend
on one.

## About the demo data — please read

The PayPal sandbox cannot originate two things, and Aegis does not pretend otherwise.

**What is real.** Catalog products, subscription plans, invoices (created and sent), and orders are created through the live sandbox REST API and read back by id. Every *action* the agents take — refunds, accept-claim, shipment tracking — runs against the live sandbox.

**What is not.** (1) Payment capture needs either buyer approval in a browser or Advanced Card Payments enabled on the sandbox business account; without it an order is real and fetchable by id but stays `CREATED`, which the row records as `LIVE_UNCAPTURED` rather than claiming a capture that did not happen. (2) Inbound buyer disputes cannot be filed against a sandbox merchant at all, so the seeded disputes are fixtures.

Seeded fixtures are written straight to the database and marked `SIMULATED`. A **real** dispute arrives through [`/api/webhooks/paypal`](src/app/api/webhooks/paypal/route.ts) and is marked `LIVE_SANDBOX` — that path is implemented, signature-verified and tested, not a stub.

Every row carries a `source` column of `LIVE_SANDBOX` or `SIMULATED`, the console badges simulated rows, and the seeder prints the split on every run. The seeding logic and this reasoning are documented in [`scripts/seed.ts`](scripts/seed.ts).

The seeder deliberately plants one recurring loss shape — high-value orders to multi-unit addresses shipped without signature confirmation — so the Learner has a genuine pattern to find instead of noise.

## Layout

```
prisma/schema.prisma      data model; `source` on every externally-derived row
src/lib/paypal/           REST client + typed API surface
src/lib/ai/               provider layer: Anthropic and local Ollama behind one interface
src/agents/signals.ts     deterministic risk signals (no model)
src/agents/ev.ts          expected-value engine + evidence checklists (no model)
src/agents/rules.ts       closed predicate language for prevention rules
src/agents/sentinel.ts    pre-fulfillment risk
src/agents/interceptor.ts pre-dispute deflection
src/agents/advocate.ts    dispute defense
src/agents/learner.ts     outcome → rule
src/agents/metrics.ts     the numbers the console leads with
src/app/api/webhooks/     PayPal webhook receiver (verify, 200-fast, idempotent)
src/agents/ingest.ts      webhook event -> domain handlers
scripts/seed.ts           90-day history seeder
scripts/webhook.ts        register / list / simulate / delete subscriptions
scripts/paypal-check.ts   exercise every PayPal endpoint Aegis uses
scripts/ai-check.ts       which model provider is live
scripts/run-agents.ts     one pass of the full loop
```

## AI tools used

Aegis runs against **either a hosted Claude model or a local model, interchangeably**. Set `AEGIS_AI_PROVIDER`; `npm run ai:check` reports what is configured and does a round trip.

| Provider | Setting | Notes |
|---|---|---|
| **Anthropic** | `anthropic` | `claude-opus-5` for reasoning and drafting, `claude-haiku-5-5` for high-volume explanation passes. Structured output uses a **forced tool call**, so a malformed response fails loudly instead of being parsed out of prose. |
| **Ollama (local)** | `ollama` | Any instruct model. Structured output uses Ollama's `format` parameter, which **constrains decoding to the JSON Schema** rather than asking politely for JSON, so small models stay on-schema. No API key, no network. |
| auto | `auto` (default) | Prefers Anthropic when a key is set, falls back to a reachable local Ollama. |

Both implement one interface ([`src/lib/ai/types.ts`](src/lib/ai/types.ts)); the agents never know which is in use.

**Verified on a local 4B model.** The Learner — the hardest job, since it must emit a schema-valid rule citing at least three real disputes — proposes the correct prevention rule running entirely offline on `qwen3-vl:4b-instruct`. Smaller models tend to return an empty proposal list rather than a wrong one, which is the safe failure.

Only two jobs use a model at all: drafting (narratives, buyer outreach, rebuttals) and rule proposal. Every score and every expected value is arithmetic.

## License

MIT — see [LICENSE](LICENSE).
