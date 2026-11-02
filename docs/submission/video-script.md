# Demo video — shot script

**Hard limit 3:00.** Judges are not required to watch past it, and Best Demo Delivery
is a $5,000 prize on its own. Target **2:45** so you have slack.

Narration below is ~370 words ≈ 2:40 at a normal speaking pace. Read it slightly
slower than feels natural on camera.

## Before you record

1. `npm run seed && npm run agents:run` — fresh data, rules proposed, nothing approved yet
2. **Leave the two rules in PROPOSED.** Approving one on camera is the climax
3. Browser at 1280x800, zoom 110%, light mode, bookmarks bar hidden
4. Have all six tabs pre-loaded so nothing spins
5. `npm run paypal:check` in a terminal you can cut to — it is live proof
6. No music you do not own. No third-party logos beyond PayPal's own

---

## 0:00–0:18 · The problem

> *Screen: `/disputes`, grouped by reason code, deadline column visible.*

"A small merchant gets a chargeback. They have ten days to respond. The evidence is
spread across the order, the transaction, the shipment tracking and an email thread,
and putting it together takes about forty minutes."

"So it doesn't get done. The case closes against them on silence, not on the merits.
And when it happens again next month, nothing has changed."

## 0:18–0:32 · The positioning line

> *Screen: hold on `/watchlist`. Do not click yet.*

"PayPal's risk engine catches stolen cards, and it's good at it. But most chargebacks
aren't stolen cards. They're a parcel that stopped moving, a subscription someone
forgot, a duplicate charge."

"Aegis is the merchant's side of that. It prevents, it defends, and it learns."

## 0:32–1:05 · Prevent

> *Screen: `/orders`. Click a HOLD row so the detail panel opens.*

"Sentinel scores every order before it ships. Not a model's opinion — weighted
signals you can read. Billing in the US, shipping to a reshipping address, first-time
payer. Hold, and here's exactly why."

> *Screen: `/watchlist`. Click the STALLED_TRACKING row.*

"Then Interceptor watches what happens after the payment. This parcel hasn't moved in
nine days. No dispute exists yet — the buyer is still annoyed at the merchant rather
than their bank, and that window is the cheapest dispute prevention there is."

"It's already drafted the message. Small refunds under the merchant's own ceiling it
issues itself. Anything bigger waits for a person."

## 1:05–1:50 · Defend

> *Screen: `/disputes`. Click the $536 ITEM_NOT_RECEIVED row.*

"When one does land, Advocate rebuilds the timeline from PayPal's own records and
answers the question that actually matters — not can I win, but is winning worth what
it costs."

"Evidence 85%, probability of winning 62%. Fighting is worth minus $227, accepting
minus $538. Fight — and here's the rebuttal, citing the tracking number and the
delivery timestamp."

> *Screen: scroll to the $68 row.*

"This one it says accept. Fighting costs $94, accepting costs $70. Winning would cost
more than losing. Six of these twelve it tells you not to fight."

## 1:50–2:25 · Learn — the climax

> *Screen: `/rulebook`.*

"And then the part that makes it a loop. Aegis read its own resolved losses and wrote
this."

> *Read the rule aloud, slowly.*

"'If the order amount is over $150 and the shipping address is multi-unit, require a
signature on delivery.' Three real disputes cited. $1,571 a quarter."

> *Click Approve & enforce. Switch to `/orders`. Re-run the pass.*

"I approve it — and Sentinel enforces it on every future order. The same loss stops
happening."

## 2:25–2:42 · Proof and numbers

> *Screen: `/` overview.*

"$2,984 deflected before anything was filed. $899 retained by defending.
Prevention is running about three times cheaper than defense."

> *Cut to terminal: `npm run paypal:check`.*

"Ten PayPal API families, live in sandbox."

## 2:42–2:55 · Close

> *Screen: `/audit`.*

"Every decision and every human override, on the record. Scores are arithmetic, not
model output. The model drafts and proposes; it never invents a number."

"Next.js, Postgres, and Claude — or a local Llama, with no API key at all. Repo's in
the description."

---

## Lines worth keeping if you cut for time

Cut in this order: the `/audit` beat, the terminal cut, the $68 accept example.
**Never cut the rulebook beat** — it is the whole differentiator.

## Three things judges will check, so show them

1. **It actually runs** — real data moving, not a mockup
2. **The rule was written by the agent**, not typed by you. Say "Aegis wrote this"
3. **A human is in the loop** — the Approve click is doing real work

## Do not say

- "Revolutionary", "game-changing", "leveraging"
- Anything implying the seeded disputes are real inbound PayPal disputes. If provenance
  comes up, one line: "Sandbox can't file buyer disputes, so the history is seeded and
  labelled; every action runs live." Honesty here reads as competence.
