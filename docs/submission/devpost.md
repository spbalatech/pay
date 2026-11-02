# Devpost submission — copy/paste

Field-by-field. Numbers are from a real run; re-check them against
`npm run agents:run` if you re-seed before submitting.

---

## Project name

```
Aegis
```

## Tagline / elevator pitch

```
Merchants fight chargebacks one at a time and learn nothing from them. Aegis is an
AI agent that prevents disputes before they're filed, defends the ones that land on
expected value rather than instinct, and turns every outcome into a prevention rule
it writes itself — so the same loss doesn't happen twice.
```

---

## Project story

### The problem

Chargebacks leak money from small merchants in three separate ways, and only one of
them is fraud.

**Cases are lost by default.** You have ten days to respond. The evidence lives in
four places — the order, the transaction, the shipment tracking, the email thread —
and assembling it takes about forty minutes. For a business where disputes are
someone's fourth priority, that often doesn't happen, and the case closes against the
merchant on silence rather than on the merits.

**Winnable cases aren't always worth winning.** A $68 claim costs the same forty
minutes as a $680 one. Nobody does that arithmetic, so merchants either fight
everything or nothing.

**The same loss repeats.** You lose five "item not received" claims on apartment
deliveries with no signature confirmation, change nothing, and lose the sixth. Nobody
is looking across cases.

PayPal's own risk engine doesn't address any of this. It scores *fraud* at
authorization, and it's good at that. But most chargebacks aren't stolen cards —
they're a parcel that stopped moving, a subscription someone forgot, a duplicate
charge, an unrecognised statement descriptor. A score at checkout is blind to all of
it. A merchant watching the lifecycle is not.

### What Aegis does

Four agents around one loop.

**Sentinel** scores every order before fulfillment — payer history, amount outliers,
address geometry, velocity — and recommends ship, verify, or hold, citing the signals
that fired and what each contributed.

**Interceptor** is the part a fraud engine cannot be. It watches the *post-payment*
lifecycle for dispute precursors: tracking that hasn't moved in five days, a missed
delivery promise, a subscription that renewed after 134 days of silence, a duplicate
charge. Each has a window where the buyer is annoyed at the merchant and hasn't yet
called their bank. Intervening inside that window is the cheapest dispute prevention
available. The agent drafts the message; small refunds under a merchant-set ceiling
it issues itself; anything larger waits for a human.

**Advocate** reconstructs each filed dispute's timeline from PayPal's own records,
checks the evidence that actually matters for that reason code, and answers the real
question — not "can I win?" but "is winning worth what it costs?":

```
EV(fight)  = P(win) x 0 + (1 - P(win)) x -(claim + dispute fee) - staff cost
EV(accept) = -claim - handling
```

On a $536 claim with 85% evidence it recommends fighting and drafts an
evidence-cited rebuttal. On a $68 claim with 25% evidence it recommends accepting,
because fighting costs $94 and accepting costs $70. Accepting is a real answer.

**Learner** closes the loop. It reads resolved outcomes, finds the shapes that keep
costing this merchant money, and proposes a prevention rule in plain English:

> "If the order amount is over $150 and the shipping address is multi-unit, require a
> signature on delivery." — derived from 3 real disputes, projected to avoid 3 per
> quarter and retain $1,571.

Approve it and Sentinel enforces it on every future order. That arrow — outcome back
to prevention — is the product. Everything else is a feature.

### Results from the seeded merchant

| | |
|---|---|
| Deflected before any dispute was filed | **$2,984** across 8 interventions |
| Retained by defending | **$899**, 7 contested at a 43% win rate |
| Prevention advantage | **3.3x** cheaper than fighting |
| Disputes the agent said *don't fight* | **6 of 12** — roughly four hours of pointless work avoided |
| Orders held pre-fulfillment | 7 of 49 |

### How we built it

**The scores are not written by a language model.** Risk scores and expected values
are plain arithmetic over facts the system can point at (`src/agents/signals.ts`,
`src/agents/ev.ts`). The model's jobs are the ones language is good at: explaining
which signals fired, drafting buyer outreach, writing rebuttals, proposing rules. It
never invents a number.

That split is the whole design. A merchant who asks "why did you hold my order?" gets
a list of weighted signals, not a vibe, and the same inputs produce the same score on
every run. It also means three of the four agents run with no model at all.

**The win-rate priors are labelled as estimates, not facts.** `WIN_RATE_PRIORS` are
documented starting guesses; after five resolved cases for a reason code, the
merchant's own observed rate replaces the prior. The console shows which is in use.

**The Learner can only write rules it is allowed to write.** It composes conditions
from a fixed predicate set, and every proposal must cite at least three real disputes
it would have prevented. Proposals citing anything else are discarded before a human
sees them. An approved rule cannot do something the merchant never sanctioned.

**Model provider is pluggable.** Anthropic's Claude or a local model via Ollama, same
interface, chosen by one environment variable. We verified the full loop end to end
on a local 4B model with no API key and no network — including the Learner, the
hardest job, which must emit a schema-valid rule citing real disputes.

### Challenges

**The sandbox can't originate the two things the product is about.** Inbound buyer
disputes can't be filed against a sandbox merchant at all, and payment capture needs
browser approval or Advanced Card Payments, which isn't available in our account's
country. Rather than blur that, every row carries its provenance:
`LIVE_SANDBOX`, `LIVE_UNCAPTURED` (the order genuinely exists at PayPal and is
fetchable by id, but the capture id is local) and `SIMULATED`. The console badges
them and the seeder prints the split on every run. Every *action* an agent takes runs
against the live sandbox; a refund against a simulated order records as skipped
rather than being faked.

**Running the integration found real bugs.** `POST /v2/invoicing/invoices` returns a
link object, not the invoice, so reading `.id` off it yielded `undefined` and every
invoice silently failed to send. Transaction search 403s until enabled on the app,
which we now surface as a named error instead of a bare 403.

**The webhook receiver had two security bugs we found and fixed.** A boolean
environment flag used `z.coerce.boolean()`, which is `Boolean(value)` — so the string
`"false"` evaluated to `true`, and the documented `cp .env.example .env` setup would
have silently *disabled* signature verification on an endpoint that creates disputes.
Separately, the dedupe row was written before the verification result was acted on:
an unverified POST carrying a real event id would persist that id, and the genuine
delivery would then receive `200 duplicate`, PayPal would stop retrying, and the real
dispute would vanish. Nothing is persisted now until the signature is accepted.

**PayPal's own guidance contradicted our behaviour, and PayPal won.** Its
best-practices reference says never to accept a dispute claim automatically without
review. We auto-accepted anything under $35. Auto-accept now defaults to off; the
Advocate still assembles the evidence, computes the expected value and drafts the
rebuttal, and a human presses the button. The agent removes the forty minutes of
assembly, not the decision.

### What we learned

That the interesting part of an "AI agent" is the governance, not the autonomy.
Autonomy ceilings, a closed rule language, citation requirements, a provenance column
and an audit trail grouped by actor are what make the thing usable by someone whose
money it is spending.

### What's next

Submitting the drafted rebuttal through `provide-evidence` (multipart, not JSON) so
the Advocate files the defense rather than handing over a letter; reading
`allowed_response_options` to offer `make-offer` and `send-message` at the stages
where they're legal; and pre-chargeback alerts, where there are 20 hours to refund
and avoid the fee entirely.

---

## Built with

```
typescript, next.js, react, node.js, postgres, prisma, paypal-rest-api,
paypal-webhooks, claude, anthropic, ollama, llama, ag-grid, bryntum, zod, docker
```

## How each tool was used

**PayPal Developer Platform** — ten API families, all in sandbox:

| Area | Endpoints |
|---|---|
| Orders | `POST`/`GET /v2/checkout/orders` |
| Payments | `POST /v2/payments/captures/{id}/refund` · `GET /v2/payments/refunds/{id}` |
| Disputes | `GET /v1/customer/disputes` · `GET /{id}` · `POST /{id}/accept-claim` |
| Reporting | `GET /v1/reporting/transactions` |
| Shipment tracking | `POST /v1/shipping/trackers-batch` · `GET`/`PUT /v1/shipping/trackers/{id}` |
| Invoicing | `POST /v2/invoicing/invoices` · `POST /{id}/send` · `GET /v2/invoicing/invoices` |
| Catalog | `POST /v1/catalogs/products` |
| Subscriptions | `POST /v1/billing/plans` · `/subscriptions/{id}/cancel` · `/suspend` |
| Webhooks | `POST /v1/notifications/verify-webhook-signature` · `/webhooks` · `/simulate-event` |

One client handles token caching, a `PayPal-Request-Id` on every write, backoff on
429 and 5xx, and errors that carry `debug_id` and the issue code.

**Claude (Anthropic)** — `claude-opus-5` for evidence synthesis, rebuttal drafting
and rule proposal; `claude-haiku-5-5` for high-volume risk narratives. Structured
output uses a forced tool call, so a malformed response fails loudly instead of being
parsed out of prose.

**Ollama (local Llama)** — the same two jobs, entirely offline. Structured output
uses Ollama's `format` parameter, which constrains decoding to the JSON Schema rather
than asking politely for JSON, so small models stay on-schema. Both providers sit
behind one interface; the agents never know which is in use.

**PayPal AI Toolkit** — used as a *development* tool, not a runtime dependency.
Installed as a Claude Code plugin; `/paypal:doctor` audited the integration and found
both webhook security bugs described above, and its `paypal-best-practices` reference
is what flagged our auto-accept behaviour as contrary to PayPal's guidance. Two
commits exist because of it. The app itself ships no PayPal SDK — it talks to the
REST API through its own client.

**PayPal's MCP server (`@paypal/mcp`)** — a selectable transport, not a decoration.
Aegis reaches PayPal either through its own REST client or through PayPal's official
MCP server, chosen by `AEGIS_PAYPAL_TRANSPORT`. Both external dependencies in the
system are swappable the same way: the model is Claude or a local Llama, the PayPal
transport is REST or MCP.

The server is launched over stdio and handed the bearer token the REST client already
caches, rather than minting a second one. `npm run mcp:check` connects, lists the 28
tools, and makes real sandbox calls — `list_disputes` and `create_invoice` both
return live results, and the same invoice is created either way.

Two things we learned doing it, both worth knowing if you try this:

- **The MCP tool schemas are not the REST bodies.** `create_invoice` flattens
  `detail.currency_code` to the top level, so posting a REST payload fails validation.
  Take the schemas from `tools/list`, not from the REST reference.
- **The hosted endpoint was unreachable for us.** `mcp.sandbox.paypal.com` returned
  404 on `/mcp`, `/http` and `/sse` throughout the build, so the local stdio server is
  what we integrated against. Same official package, same tools.

REST remains the default because it reaches further: transaction search, webhook
registration and signature verification, and shipment tracker updates have no MCP
tool at all. The transport routes the five operations PayPal's MCP server actually
exposes and leaves the rest on REST, rather than pretending the coverage is equal.

**AG Grid Enterprise** — the three operator queues. Row grouping by the unit each
queue is actually worked in (risk tier, precursor type, dispute reason code, audit
actor), sum aggregation with a grand-total row for queue exposure, master detail for
evidence panels, and a status bar.

**Bryntum Scheduler** — dispute response deadlines against fulfillment promise dates.

**Next.js 14 / React 18 / TypeScript / Postgres / Prisma / Zod / Docker** — one
deploy serves the API and the console; the schema carries provenance and the audit
trail; the environment is parsed at boot, where a malformed security flag stops the
process rather than failing open.

---

## Try it

- **Repo:** `<github url>` — MIT licensed, license file visible in About
- **Setup:** `npm install && docker compose up -d && npx prisma migrate deploy && npm run seed && npm run agents:run && npm run dev`
- **No credentials needed to evaluate:** `npm run seed -- --offline` builds the full
  90-day history without calling PayPal, and three of the four agents still run to
  completion
- **Docs:** `docs/overview.html` — run instructions, demo walkthrough, architecture
  and flow diagrams
- **Diagnostics:** `npm run paypal:check` exercises every PayPal endpoint;
  `npm run ai:check` reports the live model provider
