# Aegis: update log

Every update to Aegis, newest first. Each entry gives **the problem** it solves and **what it adds**, in plain English. A new entry is added with every update. The "what we built during the hackathon" section of the Devpost text can be taken from here (the hackathon opened 1 Oct 2026; all work below is after that).

Repo: `spbalatech/pay`. Branches: `main` (Balaji's build), `ui-polish` (Yoghesh's redesign, waiting to be merged), `live-disputes` (Yoghesh's live PayPal loop and OpenRouter, built on `ui-polish`; merge after it).

## Who built what

### Balaji: the foundation (2–3 Nov, branch `main`)
Balaji built the product itself: the idea, the engine and the PayPal and AI plumbing.

| Area | What Balaji built |
|---|---|
| The idea | Aegis: four agents in one loop that prevent, defend and learn from chargebacks |
| The agents | Sentinel (order risk), Interceptor (early warning signs), Advocate (evidence and fight-or-accept in dollars), Learner (losses become rules) |
| The core design rule | Scores and dollar verdicts are arithmetic; the AI only writes words |
| PayPal | Connection to orders, payments, refunds, disputes, transactions, tracking, invoices, products, subscriptions; notification receiver with signature checks; dispute sync; PayPal MCP server as an option |
| AI | Claude or a local model behind one switch; Learner fixes for small models |
| Safety | Auto-accept off by default, two security holes fixed, once-only keys on payment actions |
| Console | First version of the five tables (order risk, watchlist, disputes, rulebook, audit log) |
| Data | Database with real-versus-demo labels on every record, 90-day demo history |
| Writing | Devpost text, video script, overview page with diagrams |

### Yoghesh: updates on top (5 Nov onward, branches `ui-polish`, `live-disputes`)
Yoghesh made it something judges can open, read and believe.

| Area | What Yoghesh added |
|---|---|
| Access for judges | One-click hosting on Render with demo data loaded on first start |
| Experience | Dispute case-file side panel, story-first overview with "Run the agents" and a "What Aegis just did" feed, plain-English wording |
| Look and feel | Logo, icons everywhere, dark-mode tables, readable text, keyboard focus |
| Phones | Tables and menu that work on a phone |
| Fixes | Mismatched dispute counts, details showing off screen, "Undefined" text, misaligned rows |
| Real PayPal | US sandbox shop, the first real payment and first real buyer dispute, proof that the "sandbox can't create disputes" limit was wrong |
| AI options | OpenRouter (DeepSeek V4 Flash) as a cheap third AI option; letters and Learner rules tested with it |
| Live dispute loop | Real shop orders with real tracking; Fight files the defence at PayPal (tested on a real $236 case); won/lost results feed the Learner; clear refusals; sandbox case controls *(built 5 Nov; a real won/lost result not yet received)* |

Details of each update follow, newest first. Each heading names who built it.

---

## 5 Nov: AI assistant guide no longer contradicts itself (Yoghesh, `live-disputes`)

**Problem:** `CLAUDE.md` said in one place that the sandbox can create buyer disputes (true, proven 5 Nov) and in another that seeded disputes exist because it can't. An AI assistant reading it could act on the wrong one.

**What it adds:** one consistent rule: seeded disputes are demo data labelled `SIMULATED`, real sandbox cases are `LIVE_SANDBOX`, and the labels must be kept. Also drops a folder-listing line an assistant can see for itself. Wording only; no code changed.

---

## 5 Nov: Project guide for AI assistants brought up to date (Yoghesh, `live-disputes`)

**Problem:** `CLAUDE.md` (the guide an AI coding assistant reads first) still described the code before today: no live disputes, no OpenRouter, no update log, and it listed `npm run sync` and `lint` as if they worked.

**What it adds:** the `npm run live` commands and the live-dispute flow with its sandbox gotchas (US shop needed, chargeback stage, links instead of allowed options, the 9-hour token quirk); the three AI options and the empty-reply fix; the update-log rule; honest notes that `npm run sync` is broken and lint is not set up; the Render handoff now names the PayPal and AI keys to set and the merge order.

---

## 5 Nov: OpenRouter as a third AI option (Yoghesh, `live-disputes`)

**Problem:** Aegis could only use Claude (paid, no key yet) or a local model (needs a strong laptop). Without either, the response letters and the Learner, which is the moment the loop closes, stayed switched off, so they couldn't be tested cheaply.

**What it adds**
- **OpenRouter** as a third option alongside Claude and the local model, chosen by one setting. The default model is **DeepSeek V4 Flash** (about $0.09 in / $0.18 out per million tokens, a fraction of a cent per full agent run).
- On "auto", Aegis picks Claude if its key is set, then OpenRouter, then a local model.
- Rule proposals are checked against the required format, with one retry that tells the model what was wrong.
- `npm run ai:check` lists OpenRouter, and the example settings file documents it.

**Tested 5 Nov with a real OpenRouter key**
- `ai:check`: OpenRouter was selected automatically and answered.
- Full agent run:
  - **7 response letters drafted.**
  - **The Learner proposed its first rule:** "If billing and shipping countries differ, hold the order for manual review". It cites 5 of 6 matching past losses and projects 5 disputes avoided and about $1,992 saved. It shows in the Rulebook as awaiting approval.
- The letter for the real $236 case was skipped on the first run (most likely a one-off OpenRouter failure; Aegis skips a letter rather than failing) and came through on the retry, citing the real tracking number, delivery time and order.

**Live AI test through the app, and two fixes (5 Nov, after the first commit)**
- **Approved the AI's rule in the Rulebook** ("billing and shipping countries differ → hold"); it moved to Active.
- **Enforcement proven:** a new demo order (billing in Britain, shipping to the US) was **held by Sentinel because of the approved rule**. DeepSeek wrote the explanation, including what to check.
- **"Look for new patterns" clicked live** (about 20 s): the Learner found a second pattern, "apartment address → require a signature" (6 losses, about $2,512 projected).
- **Problem found: some AI letters came back empty** (4 of 7 open cases). Cause: some of OpenRouter's upstream hosts run DeepSeek in "thinking" mode and spend the whole word budget on hidden reasoning (finish "length"). **Fix:**
  - thinking is switched off for these short writing jobs
  - an empty reply now counts as a failure and is retried once, instead of being saved as a blank letter

  After the fix, 6 of 6 open cases worth fighting have letters, and repeated Learner runs gave no empty replies.
- **Problem found: the Learner proposed the same rule twice.** It only *asked* the AI not to repeat existing rules. **Fix:** a hard check in code, so a proposal with the same condition as an existing rule is rejected whatever its wording or action. Verified: repeat runs are rejected with "duplicates an existing rule". The duplicate and a near-duplicate from testing were marked rejected (kept, not deleted).
- **Polish idea, not done:** the rule card's "Why" text shows a raw field name (`countryMismatch=true`), which is the AI's own wording.

**Note:** Claude is still the better choice for the recorded demo and hosted version (the Devpost text and video script describe Claude). Switching is one setting. Balaji's default Claude model name, `claude-opus-5`, should be checked before relying on it.

---

## 5 Nov: Real disputes, end to end (Yoghesh, `live-disputes`)

**Problem**
- Pressing **Fight** only records the decision inside Aegis; nothing is sent to PayPal. (Accept does reach PayPal.)
- A payment the buyer disputes isn't linked to an Aegis order, so Aegis has no shipment or tracking to use as evidence.
- When Aegis checks PayPal itself (rather than waiting for PayPal's notifications), it doesn't pick up whether a case was won or lost, so the Learner can't learn from it.
- Every dispute in the demo is made-up data, which judges will notice.

- Also found while building:
  - PayPal labels reasons differently from Aegis (`MERCHANDISE_OR_SERVICE_NOT_RECEIVED` versus `ITEM_NOT_RECEIVED`), so real cases would have been counted apart from the demo history.
  - Pressing Fight on a case PayPal refused crashed the screen instead of saying why.

**What it adds (built 5 Nov)**
1. **A real shop order command** (`npm run live -- order`): creates a $236 headphones order at PayPal and prints a link. The test buyer approves it, then Aegis takes the payment, saves the order, and registers a real USPS tracking number (marked delivered) with PayPal.
2. **Fight sends the defence to PayPal**: the tracking as proof of delivery plus the AI-drafted letter. Aegis first reads what PayPal allows and what evidence it is asking for. If Aegis doesn't hold that evidence, it says so and sends nothing.
3. **Results come back**: Aegis's regular PayPal check now records won/lost (before, only PayPal's notifications did), so the Learner sees real losses.
4. **Sandbox case controls**: `npm run live -- status | escalate | settle <case>` to read a case, move it to a claim, and settle it in the buyer's or shop's favour.
5. **PayPal's reason names are translated** into Aegis's own, so real cases pool with the history.
6. **Case-file screen**:
   - A fought live case shows "Evidence sent to PayPal on [date]", and the status column says "with PayPal".
   - If PayPal refuses, the panel shows PayPal's reason instead of crashing.

**Tested**
- PayPal **accepted the evidence upload** (tracking as proof of delivery) on the real case PP-R-KZE-10196562.
- Pressing Fight when PayPal wants evidence Aegis doesn't hold: **refused with a clear message, nothing sent, case not marked fought**.
- In the browser, Fight on a case PayPal won't take shows PayPal's reason in the panel.
- The real case came into Aegis through the agent run and was assessed. Recommendation: **accept**, which is correct, because that payment had no order or tracking behind it.
- Type-check passes.

**Full run with a real order: done 5 Nov**
1. `npm run live -- order` created a $236 headphones order. The buyer approved it after the 15-minute wait had ended, so a **resume option** was added (`npm run live -- order <orderId>`). The payment was collected (`2G3044812C886693D`), saved in Aegis, and a USPS tracker marked delivered was registered at PayPal.
2. The buyer opened case **PP-R-BVX-10196584** ("hasn't reached me"). **PayPal moved it straight to the chargeback stage**, probably because the India buyer pays by linked card. So there was no inquiry and no escalate step.
3. The agent run brought it into Aegis, **matched it to the order**, and recommended **Fight**: 85% evidence strength (tracking, carrier delivery, delivered before filing, shipped to the order address), a 62% chance to win, an expected cost of $114.56 to fight versus $238 to refund.
4. At the chargeback stage PayPal takes **"supporting info"** (notes) instead of typed evidence, so Fight was taught to use that channel.
5. Fight pressed **in the app's screen**:
   - PayPal's record now holds the shop's response with the tracking number and delivery time.
   - The case file shows "Fought at PayPal, evidence sent to PayPal on Nov 5", and the status column says "with PayPal".

**Not yet tested**
- **Settling a case / the result coming back.** PayPal offers its test "settle" tool only on some cases. It didn't on either of today's cases, so PayPal will decide them itself, and `npm run agents:run` picks up the result. The code that records won/lost is written and type-checked, but no real result has arrived yet.
- **The AI letter and the Learner** need an AI key in `.env` (`ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY` since the OpenRouter update below). Without one, Fight sends a plain evidence summary, and the screen says so.

**Status:** committed and pushed on branch `live-disputes` (on top of `ui-polish`). About 12 files changed plus the new `scripts/live-dispute.ts`. Fight works on both inquiry cases (typed evidence) and chargeback cases (supporting info). Changes touch Balaji's agent code (Advocate, sync, webhook handler) and PayPal connection code.

**Known issue, not from this work:** the existing `npm run sync` shortcut is broken (it can't find its function). `npm run agents:run` does the same sync and works.

---

## 5 Nov: PayPal sandbox set up, real dispute proven possible (Yoghesh, no code changes)

**Problem**
- The Devpost text says PayPal's sandbox can't create buyer disputes. PayPal's own docs say it can.
- The first test shop account (India) couldn't receive US dollars: payments failed with "UNSUPPORTED_PAYEE_CURRENCY".
- Card payments without a browser were unavailable ("not in India").

**What it adds**
- A **US test shop** and a new app, "Aegis US", whose keys are in the local `.env` (not in the repo). All 9 PayPal features Aegis uses pass the check.
- **Card payments now work**, so demo orders can be real paid PayPal records instead of "uncaptured" ones.
- **First real payment:** the test buyer paid a $420 invoice (transaction `4SL99099B71331639`).
- **First real dispute:** the buyer opened case `PP-R-KZE-10196562` ("item not received", $420). Aegis's keys can read it, and PayPal lets the shop send evidence, message the buyer, make an offer or accept.
- Found a PayPal quirk: after you switch on a feature for an app, PayPal keeps reusing an old login without the new permission for up to 9 hours. Forcing a fresh login fixes it.

---

## 5 Nov: Icons across the console (Yoghesh, `ui-polish`)

**Problem:** agents, statuses and warning signs looked different on each page, and some status badges used abstract shapes. The watchlist printed "Undefined" on group and total rows.

**What it adds:** one shared set of icons, so each agent, status and action looks the same everywhere: menu, activity feed, case file, buttons and badges. Each icon sits beside a word. The "Undefined" text is fixed.

---

## 5 Nov: Tables readable on a phone (Yoghesh, `ui-polish`)

**Problem**
- On a phone the tables were too wide and trapped scrolling.
- Group rows were misaligned, with the count sitting below the name.
- Wording like "precursor" and "seed prior" meant nothing to a shop owner.
- The Rulebook said "No proposals" when the real reason was that no AI was connected.

**What it adds**
- On phones each table shows only amount, risk and status, and the page scrolls normally.
- Group rows are aligned.
- Plainer words throughout.
- The Rulebook says when no AI model is connected.

---

## 5 Nov: Hosted demo, case-file panel, story-first overview (Yoghesh, `ui-polish`)

**Problem**
- Judges had to install Docker and Postgres to see anything.
- The dispute view was a table plus a detail card far below it.
- The overview opened with numbers, not the story.

**What it adds**
- **One-click hosting on Render:** creates the database, loads demo data on first start, and gives a public link.
- **Dispute case file in a side panel:**
  - the buyer's words
  - a plain-English verdict in dollars
  - the timeline
  - the evidence, with missing items named
  - the response letter
  - Fight / Accept buttons

  Orders and the watchlist use the same panel.
- **Overview leads with the headline number:**
  - a "Run the agents" button
  - a "What Aegis just did" feed
  - setup notes collapsed into "About this demo"
- Plain labels such as "win chance" and "cost if fought", a risk "Why" mini-chart, a logo, larger text, a visible keyboard focus outline, and a phone menu.

---

## 5 Nov: Dashboard polish (Yoghesh, `ui-polish`)

**Problem**
- The "Open disputes" number on the overview (21) disagreed with the sidebar (12).
- Clicking a row showed its details off screen.
- Tables ignored the dark theme.
- The group column was blank on normal rows.

**What it adds**
- Both counts use the same rule.
- Clicking a row scrolls to its details.
- Tables follow the app's colours.
- Order and dispute numbers fill the blank column.
- Setup notices fold into one line.

---

## 3 Nov: Submission points at the public repo (Balaji)

**Problem:** the Devpost "Try it" link was a placeholder.
**What it adds:** the link now points to `github.com/spbalatech/pay`.

---

## 2 Nov: Honest pitch, dispute sync, PayPal payment history as evidence (Balaji)

**Problem**
- The pitch claimed things the app didn't do yet:
  - a Bryntum timeline that was never built
  - "watching" PayPal's dispute list, when nothing actually checked it
  - pulling the buyer's PayPal payment history, when it only used Aegis's own records
- A dispute whose PayPal notification never arrived was invisible, with its response deadline running.

**What it adds**
- The Bryntum claim is removed.
- **Dispute sync:** at the start of every agent run, Aegis asks PayPal for its disputes and brings in any new ones.
- Two evidence checks now read the buyer's real PayPal payment history:
  - "this buyer has paid us before without complaint" (the strongest answer to "I didn't authorise this")
  - "how many payments match this amount" (settles duplicate-charge claims)
- If PayPal's Transaction Search is switched off, those checks are marked "unavailable" instead of failing.

---

## 2 Nov: PayPal MCP server as an option (Balaji)

**Problem:** Aegis only talked to PayPal one way (its own REST connection).

**What it adds**
- Aegis can also reach PayPal through PayPal's official MCP server, either run locally or PayPal's hosted one, chosen by one setting. The AI provider is swappable in the same way.
- Findings from doing it:
  - MCP requests use different formats from REST.
  - The hosted server reads data fine but its writes fail, and it reports those failures in an unusual way, which Aegis now catches.
  - REST stays the default because it covers more features.

---

## 2 Nov: Devpost text, video script, overview page (Balaji)

**Problem:** there was nothing written for judges.

**What it adds**
- `docs/submission/devpost.md`: every form field, ready to paste.
- `docs/submission/video-script.md`: a timed script of about 2:40.
- `docs/overview.html`: how to run it, what to click, and three diagrams. Its rendering bugs are fixed.
- The PayPal check now also tests whether card payments are available.

---

## 2 Nov: Webhook receiver, and security fixes (Balaji)

**Problem**
- There was no way for PayPal to tell Aegis "a new dispute was filed".
- Aegis accepted disputes under $35 automatically, which goes against PayPal's guidance never to accept without review.
- A PayPal review tool (`/paypal:doctor`) found two security holes:
  - a setting meant to be "off" was actually read as "on", which switched off the check that a notification really came from PayPal
  - a forged message could make Aegis ignore a real dispute

**What it adds**
- **PayPal notification receiver:**
  - checks that each message really came from PayPal
  - replies within PayPal's 30-second limit
  - ignores repeats
- **Auto-accept is off by default:** a human presses the button. Before any accept, Aegis re-reads the case and confirms PayPal allows it.
- Both security holes are fixed.
- Every PayPal action that could be repeated by accident now carries a "do this only once" key, so a network retry can't refund twice.

---

## 2 Nov: Works without keys; swappable AI (Balaji)

**Problem**
- Without PayPal keys the app crashed. Sandbox approval can take days, and phone verification fails in some countries.
- Only one AI provider was supported.
- On small AI models the Learner silently proposed no rules.
- Two PayPal bugs: invoices never sent, and Transaction Search failed with an unexplained error.

**What it adds**
- **Runs without keys:** only the database is required. The app says what is switched off. Three of the four agents work with no AI at all, because their scores are plain arithmetic.
- **Swappable AI:** Claude, or a local model with no internet. Verified end to end on a small local model.
- **Learner fixed:** disputes are labelled D1, D2… so the AI cites them accurately, and rule savings are calculated, not guessed by the AI.
- **Both PayPal bugs fixed**, and an honest new label, "created but not paid", for orders that exist at PayPal but haven't been paid.

---

## 2 Nov: The first build (Balaji)

**Problem:** small online shops lose money to chargebacks in three ways:
- cases are lost by missing the deadline
- small cases are fought when fighting costs more than it saves
- the same kind of loss keeps repeating

PayPal's fraud scoring at checkout doesn't cover any of these.

**What it adds**
- **Four agents in one loop:**
  - **Sentinel** scores each order's risk before it ships.
  - **Interceptor** spots early warning signs after payment and acts before the buyer complains.
  - **Advocate** gathers evidence for a dispute and works out in dollars whether fighting is worth it.
  - **Learner** turns repeated losses into prevention rules that a human approves.
- **The AI never decides numbers:** scores and dollar verdicts are arithmetic; the AI only writes words.
- PayPal connection: orders, payments, refunds, disputes, transactions, tracking, invoices, products, subscriptions.
- A database that marks every record as real (sandbox) or made-up (demo).
- 90 days of demo history.
- **The console:** five tables (order risk, watchlist, disputes, rulebook, audit log) with grouping and totals. One bug was found and fixed: approved early fixes were never actually carried out.
