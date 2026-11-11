# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Aegis (package name `aegis`, repo `spbalatech/pay`): a Next.js 14 (App Router) + Prisma/Postgres app for the PayPal AI Hackathon. A closed loop of four agents defends PayPal merchants against chargebacks: **Sentinel** (pre-fulfillment order risk) → **Interceptor** (post-payment dispute precursors) → **Advocate** (filed-dispute defense) → **Learner** (lost outcomes → proposed prevention rules, which Sentinel then enforces). README.md is detailed and accurate; read it for the PayPal endpoint list, webhook contract and demo-data caveats.

## Commands

```bash
docker compose up -d            # Postgres on localhost:55439 (user/pass/db: aegis)
npx prisma migrate deploy       # apply migrations
npm run seed -- --offline       # 90-day demo history without PayPal credentials (drop --offline to hit the sandbox)
npm run agents:run              # one full pass: sync → sentinel → interceptor → advocate → learner
npm run dev                     # console at http://localhost:3000

npm run typecheck               # tsc --noEmit
npm run lint                    # next lint
npm run build                   # NOTE: also runs prisma generate + migrate deploy

npm run ai:check                # which model provider is live + a round trip
npm run paypal:check            # exercise every PayPal endpoint Aegis uses
npm run mcp:check               # PayPal MCP transport (AEGIS_PAYPAL_MCP_MODE=remote for hosted)
npm run sync                    # reconcile disputes with PayPal only (BROKEN: "syncDisputes is not a function"; agents:run does the same sync)
npm run webhook -- register|list|simulate|delete ...

npm run live -- order [orderId] # real sandbox order: buyer approves in browser -> captured, saved LIVE_SANDBOX, USPS tracker; orderId resumes a late approval
npm run live -- status|escalate|settle <disputeId> [buyer|seller]   # read a live case / inquiry -> claim / sandbox adjudicate
```

There is no test suite; verification is `typecheck`, the `*:check` scripts, and `agents:run` against seeded data. `npm run lint` is not set up (it opens an interactive ESLint prompt). Scripts run via `tsx` and load `.env` through `dotenv/config`. Postgres needs Docker Desktop running first.

## Live disputes in the sandbox

The sandbox *can* originate buyer disputes: a sandbox personal account opens a case at sandbox.paypal.com on a payment it made (`npm run live -- order` makes one). Flow: order -> buyer opens case -> `agents:run` (sync ingests, matches the order by capture id, Advocate assesses) -> [inquiry only: `escalate` before responding] -> Fight in the console -> `settle` if PayPal shows an `adjudicate` link -> `agents:run` records the outcome.

- The sandbox business account must be **US** (an India one fails with `UNSUPPORTED_PAYEE_CURRENCY`); the India test buyer pays by linked card and its cases go straight to **CHARGEBACK** stage.
- Legal actions come from the dispute's HATEOAS `links` (`provide_evidence`, `provide_supporting_info`, `escalate`, `adjudicate`, ...), not `allowed_response_options` (absent in sandbox). `submitDefence` in `advocate.ts` answers the evidence types PayPal requests (`REQUESTED_FROM_SELLER`), uses `provide-supporting-info` at chargeback stage, and throws (nothing sent, decision not executed) when it can't comply. Both endpoints are multipart (`form` option in `client.ts`).
- PayPal's reason names are normalised (`normalizeReason` in `ev.ts`, e.g. `MERCHANDISE_OR_SERVICE_NOT_RECEIVED` -> `ITEM_NOT_RECEIVED`) so live cases pool with history.
- Outcomes are recorded by `recordDisputeOutcome` (`ingest.ts`), shared by the webhook path and the sync.
- After enabling a feature on a PayPal app, the client-credentials token keeps its old scopes for up to 9 h; terminate it (`POST /v1/oauth2/token/terminate`) to get a fresh one.

## Update log

Every update gets an entry in `docs/UPDATE-LOG.md`: the problem it solves, what it adds, what was and was not tested, and who built it (Balaji: foundation on `main`; Yoghesh: updates on top). Commit it with the change. The repo is public: no keys in it.

## Architecture

- **Scores are arithmetic, never model output.** `src/agents/signals.ts` (weighted risk signals) and `src/agents/ev.ts` (expected value of fight vs. accept, per-reason-code win-rate priors, evidence checklists) are deterministic. The model only writes language: explanations, buyer outreach, rebuttals, and Learner rule proposals. Keep it that way: don't let an LLM produce a score, EV or decision.
- **Closed rule language.** `src/agents/rules.ts` defines the only predicates a prevention rule may use. The Learner must cite ≥3 real disputes per proposal; anything else is discarded before a human sees it. Rules need human approval before Sentinel enforces them.
- **Agents** live in `src/agents/*.ts`, each exporting a `run*` function plus execute/approve functions. Every agent upserts, so passes are re-runnable. Entry points: `scripts/run-agents.ts` (CLI), `src/app/actions.ts` (server actions for the UI; human actions are attributed as `human:operator`), and `src/agents/ingest.ts` (webhook events → domain handlers). `src/agents/sync.ts` reconciles disputes from PayPal.
- **Audit log is the source of truth for "what happened".** `src/lib/activity.ts` builds the console's activity feed from `AuditLog`; agent actions must be recorded there.
- **Graceful degradation is a design requirement.** `src/lib/env.ts` (zod) makes all credentials optional; only `DATABASE_URL` is required. Missing PayPal creds disable live writes; missing model disables only the Learner and drafted text (Sentinel/Interceptor/Advocate still work fully). Empty `.env` values are treated as unset.
- **AI provider layer** `src/lib/ai/`: one interface (`types.ts`), Anthropic, OpenRouter and Ollama implementations, selected in `index.ts` by `AEGIS_AI_PROVIDER` (`auto|anthropic|openrouter|ollama|none`, 30s cached; `auto` = Anthropic, then OpenRouter, then Ollama). Structured output uses a forced tool call (Anthropic), a `json_schema` response with `require_parameters` (OpenRouter), or JSON-schema-constrained `format` (Ollama). OpenRouter defaults to `deepseek/deepseek-v4-flash` with `reasoning: { enabled: false }`: some upstreams otherwise spend `max_tokens` on hidden reasoning and return empty text, which is treated as an error and retried once. The default Claude model id `claude-opus-5` is unverified; check it before relying on Anthropic. Import from `@/lib/ai`; `claude.ts` is a deprecated re-export.
- **Learner duplicates** are rejected in code: a proposal whose condition matches an ACTIVE/PROPOSED rule (canonicalised) is dropped, whatever its wording or action.
- **PayPal layer** `src/lib/paypal/`: `client.ts` (token cache, idempotency keys on writes, backoff on 429/5xx), `api.ts` (typed endpoints), `transport.ts` routes five operations through either REST or PayPal's MCP server (`mcp.ts`) per `AEGIS_PAYPAL_TRANSPORT`; everything else stays on REST. MCP tool schemas differ from REST bodies (e.g. `create_invoice` flattens currency), and the hosted MCP server reports write failures as `{"ok":false}` in a 200 body, not via `isError`.
- **Webhook receiver** `src/app/api/webhooks/paypal/route.ts` + `src/lib/paypal/webhooks.ts`: verifies the signature on the **raw body** before trusting anything, returns 200 fast and processes after, dedupes by event id (`WebhookEvent`). `AEGIS_WEBHOOK_ALLOW_UNVERIFIED` accepts only the literal strings `true`/`false` (anything else fails boot); don't change that to `z.coerce.boolean()`.
- **Data provenance.** Every externally-derived row has a `source` of `LIVE_SANDBOX` or `SIMULATED` (`prisma/schema.prisma`); the UI badges simulated rows. Seeded disputes are demo fixtures (`SIMULATED`); real sandbox cases are `LIVE_SANDBOX`. Preserve this labeling.

## Safety defaults (enforced in code, keep them)

- `AEGIS_AUTO_ACCEPT_CEILING_USD` defaults to `0` (off) per PayPal guidance; before any `accept-claim` the dispute is re-read and `allowed_response_options` checked.
- Rebuttals always require a human. `AEGIS_AUTO_REFUND_CEILING_USD` (25) and `AEGIS_HOLD_THRESHOLD` (70) bound autonomy.

## Deployment

`render.yaml` is a one-click Render blueprint; on start it runs `migrate deploy`, then `scripts/demo-boot.ts` (seeds + one agent pass only when the DB is empty), then `next start`. Render deploys from `main`.

The `Dockerfile` does the same in one container (UI and API on port 3000, Postgres separate via `DATABASE_URL`) for Coolify or any Docker host; the README lists its variables. Its health check calls `GET /api/webhooks/paypal`.
