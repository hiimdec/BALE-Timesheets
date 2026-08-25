# Maintenance notes

Parked work with a known trigger date or event. Each item states its trigger, the exact change, and why it is parked rather than done.

## Launch day (App Store approval of 5.3.0) — DONE 24 July 2026

**The app is live on the App Store.** For future reference:

- **App Store URL (country-neutral, use this form everywhere):** `https://apps.apple.com/app/id6775970098`
- **App Store ID:** `6775970098`
- Never use country-coded forms (`/gb/`, `/us/`) in links - the neutral URL redirects to the visitor's own storefront.

Executed on the day: `launch/website-go-live` merged to main (clean, pre-reconciled); the App Store nav CTA extended to all ten article pages; every placeholder link (26 grep lines: 23 links across 14 pages plus TODO comments) replaced with the neutral URL - zero remain; privacy.html effective date set to 24 July 2026 and its version line to v5.3.0. The one deliberate TestFlight survivor stays: privacy's conditionally worded "if you're ever running a beta build through TestFlight" paragraph, accurate for any future beta.

## 1 September 2026 — marketing rate labels

welcome.html and how-it-works.html footers carry static "APA Sept 2025" markers. These are accurate until 31 August 2026; from 1 September the operative card is Sept 2026 (the app's own footers are version-aware and handle themselves). Update the two static page footers on or shortly before 1 September 2026.

## iOS 27 cycle — delete the requestConfirmation fallback

`TimeMachineAppShortcuts.swift` (the "log my times" Siri intent) uses the replacement API `requestConfirmation(actionName:dialog:)` on iOS 18+; the deprecated `requestConfirmation(result:)` call survives only as the `#available(iOS 18.0, *)` else-branch serving the intent's iOS 17 floor. Adjudicated 2026-07-05: do not migrate early — the two-tap confirm flow is device-verified. When the intent's availability floor rises to iOS 18 (planned for the iOS 27 maintenance cycle), delete the else-branch. The migration is a deletion, not a rewrite.

## Next multi-crew release — Best Boy days lack the wrapped flag

**Trigger:** any release touching the Best Boy wrap flow or Stats aggregation.
**Change:** set a wrapped/finished flag on multi-crew days when their day is done, then let the Stats wrapped-today bypass read it, so Best Boy days count the same day like solo days do.
**Why parked:** the 5.3.0 wrapped-today bypass (Stats counts a day dated today once `day.wrapped === true`) is deliberately narrow - only the solo flows (card wrap, WrapNow, a passed solo wrap-time edit) set `day.wrapped`. Multi-crew days keep the old day-after behaviour: correct totals, just counted a day later. Known inconsistency, accepted to keep the aggregation change small and safe.

## Any timezone-touching release — todayISO() is the UTC date

**Trigger:** the next change that touches todayISO() or day-matching logic.
**Change:** decide whether todayISO() (`new Date().toISOString().slice(0, 10)`) should become the LOCAL calendar date app-wide. During BST it is one hour behind the local date, so anything keyed on it rolls over at 1am local, not midnight - including the Live Activity reconcile sweep's today-day matching (a card can linger up to an hour past local midnight before the sweep sees the day as stale).
**Why parked:** the 5.3.0 Stats aggregation deliberately normalised to the local date INSIDE its two sites only (the StatsScreen reducer and aggregateMonthly pass 3) and left todayISO() alone - changing the app-wide "today" mid-release would drag the Live Activity sweep and voice-intent day matching into a money-adjacent change. Fix properly in an LA-touching release.

## Open question — the dayDefaults backfill-and-collapse migration (promote-from-single-override path)

**Trigger:** Derrick's relaunch experiment on a throwaway fixture, or the next change touching migrateProduction / dayDefaults.
**Change:** none yet — this is a documented open question, deliberately NOT touched by the 2026-07-30 fuchsia-highlight fix (that fix is display-feed only).
**Why parked:** migrateProduction (the every-load hydration transform, index.html ~3922) backfills a missing dayDefaults[date] from the most-common EXPLICIT value in that date's crew records, then collapses record values equal to the backfilled default to undefined. Code-reading says a date created and individually edited in the SAME session (no date-level record yet) would, at the next launch, have the lone member's override promoted into the date's dept default and stripped from their record — resolveDay's cascade would then apply the promoted value to every lean crew member on that date (pay-adjacent). This path is VERIFIED IN CODE but has NEVER been observed on device data, and real-world use shows none of its predicted symptoms (VAR chips evaporating after relaunch, department times drifting). Decisive test, Derrick's call, throwaway fixture ONLY (it permanently rewrites the production's day data): build a day + one member override in one session, force-quit, relaunch — if the member's VAR chip survives and the un-edited member's breakdown is unchanged, the path is inert in practice and the code reading is missing something; if the VAR vanishes and the un-edited member gains the promoted time, it is real and needs its own propose-first cycle.

**Trigger:** any Live Activity release, or the first real-day diagnostics showing the hole being hit.
**Change:** none currently possible without a server; recorded so nobody "discovers" it. Possible narrowing once real-day data exists: pre-emptive staleDate rotation (rejected for 5.3.0 because it fires only on foreground sweeps, which cannot close the hole).
**Why parked:** ActivityKit gives ONE staleDate slot. The card's staleDate is min(semantic wake, lifetime cap) — usually the lunch-end wake or the ~7h45m cap that drives the truthful EXPIRED branch. A day where lunch is logged and the user never foregrounds or touches the card between lunch-end and wrap spends the slot on the lunch wake, so the cap wake never fires and the card can husk at the iOS ~8h limit without rendering EXPIRED. Every serverless re-mint mechanism is foreground-triggered, so this is a platform limit, not deferred work. The restart-on-foreground sweep self-heals it at the next app open.

## After the 2026.11 submission — persist the September rate notice's seen-state

**Trigger:** the next release that already carries a schema change, or the first report of the notice repeating after a relaunch.
**Change:** move the future-card announcement's seen-state from the session ref (`announcedCardsRef`, keyed `openId:effectiveFrom`) onto the production record, so an announcement survives a cold start.
**Why parked:** ruled Phase 15. The session Set fixes the real complaint — the notice fired on every crossing of the boundary, without limit — and one announcement per production per card is now the behaviour within a session. Persisting it is a stored-key change (and every persisted key joins the storage adapter's KEYS warm list in the same commit), which is not worth a migration immediately before a submission for a dialog rather than for money. A repeat after a cold start is a minor annoyance, and the whole mechanism goes quiet permanently once today is past 1 September 2026.

## Long form settings — the full-page rebuild

**Trigger:** the next release that touches long form Job settings, or when the sheet's content grows past the 90vh cap again.
**Change:** rebuild Job settings as a full page in APA's `ProductionSettingsSheet` shape — `min-h-screen`, its own header, and `Disclosure` grouping — rather than a bottom sheet.
**Why parked:** ruled Phase 15. The bug (the sheet was 1515px in an 812px viewport with no cap and no scroll region, so its top 703px was unreachable) is fixed with `DayEditModal`'s cap-and-scroll pattern, and moving invoicing to the week view took the content from 1417px to 851px. The full-page shape is the better long-term answer because the disclosure grouping is what makes APA's comparable settings readable, but it is a rewrite of the whole surface rather than a fix, and it is not a bug.

## Ruling needed — hourly Bectu card rates cannot fill the wizard's rate field

**Trigger:** propose-first, after the 2026.11 submission. Needs a ruling before any code.
**Change:** decide the multiplier that turns an hourly Bectu card rate into a day rate, then extend `lfRoleRefFill` (index.html, beside `lfRoleRefLine`) to return `{ value, unit: 'h' }` cases so the reference becomes tappable for them too.
**The question, stated:** which number does an hourly rate multiply by — the agreement class's contracted hours (10 for standard, 10+1 for the additional-hour departments, 9 for rigging electricians), or something else the deal memo implies? It produces a money figure, so it is propose-first.
**Why parked:** Phase 15 made the card reference tappable for `d` (fills the daily rate as published) and `w` (switches "my deal is weekly" on and fills the weekly field, so the wizard's own visible ÷5 does the conversion). Hourly entries are left as a plain, untappable reference because there is no hourly field and any conversion invents a number. Non-numeric entries (NEG, N/A, "not often in this band", the MMP referral) carry no figure and were never fillable.
**Which departments this covers.** Counted from the registry: **109 roles carry an hourly figure**, against 74 daily and 6 weekly — so the unfilled case is the majority of the card, not a corner. The hourly departments are Camera, Sound, Grip, Costume, Hair & Make-up, Locations, Editorial, Production and Transport (Unit Driver). Art Department, Assistant Directors, Construction, Props, Lighting/Electrical and Intimacy Coordinator are `d` or `w` and are already fillable.

## Canary — "Late lunch earned" is where an S4 lapse would show first

**Trigger:** any change to the Stats aggregation loop, to `agreementOf`, or to the long form engine's penalty lines. Also read this before diagnosing a strange figure on that card.
**Change:** none. This is a diagnostic note, recorded so the next person reaches for it instead of re-deriving it.
**Why it is worth writing down.** Sweep gate S4 (`if (agreementOf(p) !== 'apa') continue;`, the first statement in the loop that builds `enrichedDays`) keeps long form days out of Stats entirely. If it ever lapses, the **late lunch card is the figure that would show it first, and it would show it as a wrong number rather than as a crash**:

- APA's late-first-break penalty is a hard-coded flat `amount: 10` (§6.2). Two of them are exactly £20, so that card is normally a multiple of ten and a non-round figure is immediately legible as wrong.
- Long form emits a line labelled **`'Late lunch'`** whose amount is `bound.rate * (delay / 60)` — rate-based, not flat, and at the overtime rate where the clause applies it. Its label lowercases to a "late" prefix.
- So a long form day reaching the loop would add a rate-based amount to a figure that is otherwise always a multiple of ten.

Phase 16 investigated exactly this shape — LATE LUNCHES 2 against LATE LUNCH EARNED £19.42 — and **it was not a leak**: S4 was intact, and the 58p came from Phase 14's invoiced pro-rata scaling plus a loose label-prefix match (fixed, `isLateFirstBreakLine`, pinned ST1). The hypothesis was right about the shape and wrong about the cause. Next time: check S4 and the pin first (LF32 asserts S4 by its own comment anchor and counts both same-shaped lines), then the scaling, then arithmetic.

## Home screen — the hero cards render BELOW In Progress, and the comment says otherwise

**Trigger:** any change to the home screen's ordering, or the next time someone reads that comment and believes it.
**Change:** none taken. Ruled Phase 16: not a pre-submission change.
**The disagreement, recorded because the next person will hit it.** `ProductionsScreen` renders the In Progress group first, then the long form today card (S1b), then the APA hero (`currentShoot`). The APA hero's own comment reads `{/* Current shoot pinned at top */}` — **it is not pinned at top**, it renders after the In Progress block. The code and its comment have disagreed since the In Progress group was introduced, and the comment is the one that will be believed.
**Why it was left.** The long form today card added in Phase 16 sits in exactly the same slot, so the two hero cards are consistent with each other. Moving them above In Progress changes where the APA hero sits too, which is a layout judgement on a shipped surface rather than a bug fix. Device-verified in Phase 16: the card renders correctly, just lower than the comment claims.
**If it is taken:** move both hero slots together, or the two agreements diverge — and fix the comment either way, since a comment that survives the move would be wrong in the opposite direction.

## Known gap — the flat penalty lines carry no rate, so their working cannot be shown

**Trigger:** any release that surfaces per-line arithmetic on a money surface, or any
change to how `rate: null` is read.

**The gap.** Most engine lines carry `rate` and `qty`, so their working is already in the
data: Mileage is `rate: 0.5, qty: 146`, Travel Time is `rate: bhr, qty: chargeableTravel`.
One family is different. These carry `rate: null, qty: 1` while their `amount` is a real
product:

| Line | amount | detail |
|---|---|---|
| `Missed 1st Break (night)` | `breakPenaltyRate` | `1h × 2× BHR` |
| `Missed 2nd Break` / `Late 2nd Break (treated as missed)` | `breakPenaltyRate * 0.5` | `30m × BHR` |
| `Curtailed 2nd Break` | `(curtailedBy / 60) * breakPenaltyRate` | `Nm × BHR` |
| `Missed CWD Break (9h)` and `(12.5h)` | `breakPenaltyRate * 0.5` | `30m × BHR` |

The multiplier and the rate both exist as locals in `calculateDay` at push time; neither
reaches the line. The `detail` names the basis in words but carries no number. Note the
inconsistency this creates: **Curtailed 1st Break exposes `rate` and `qty`; Curtailed 2nd
Break does not**, despite being the same shape of penalty.

Distinct from the genuinely flat lines — `Late 1st Break` (£10) and `Missed Meal Allowance`
(£7.50) — which have no arithmetic at all. Those are correct as they stand and are not part
of this gap.

**Why parked, and it is not laziness.** Two routes exist at the display layer and both are
worse than doing nothing:

1. Parse the multiplier out of the `detail` string and divide the amount by it. That is
   reconstruction from prose, and a copy edit to the detail silently breaks the arithmetic.
2. Re-derive `breakPenaltyRate` from `meta.bhr` plus the night flag in `meta.dayLabel`.
   That re-implements an engine rule outside the engine — the duplicated-gate shape this
   project has now been bitten by five times, most recently in the ownership fix.

Putting the rate on the line is the correct fix, and it **is an engine change** even though
no amount moves. It also reaches two surfaces beyond the day card: `const isFixed =
item.rate === null` is load-bearing in **both** the invoice print renderer and the
accounting export builder. A non-null rate would start rendering Qty and Rate columns for
penalty lines on invoices. That is money-surface display and needs a ruling, not a patch.

**The change, when it is taken:** give each line in the table its real `rate` and the
matching fractional `qty` so `rate × qty` reproduces the existing amount exactly, then
replace the two `isFixed` reads with an explicit flag (e.g. `displayFlat`, which the night
split already uses) so the invoice and export keep their current rendering by intent rather
than by the absence of a rate. Pin that the amounts are byte-identical across the change.

## Design gap — no invoice-level discount concept

**Trigger:** any work on per-line attribution, or the next time a reported figure and an invoice disagree.
**Change:** none yet. This is the design problem underneath Phase 17.
**The gap.** The app has no invoice-level discount field. `discountedQty` is a per-LINE quantity override. Every reduction — "10% off the whole job", "the recce was actually £125", "drop the mileage" — is expressed the same way, sets the same `linesEdited: true`, and produces the same lower net. **Two users wanting opposite semantics leave identical data**, so intent is never recorded, because the UI never asks. That is why Phase 17 stopped trying to infer it: billed money is now read at invoice granularity and nowhere finer.
**The specific cause is closed; the ambiguity is not.** The founder's own case was the invoice editor being used as a *rate* editor — a recce corrected from the APA rate down to £125 because custom day rates did not exist yet. Phase 9 filled that gap from the other side, so nobody needs to do that again. But nothing stops the next person expressing a genuine whole-invoice discount as a line edit, or a rate correction as one, and the stored data will not tell them apart.

## `dates` is computed and dropped in buildInvoiceLineItems

**Trigger:** if per-line attribution is ever built.
**Change:** one line. `buildInvoiceLineItems` (index.html, the `return [...map.values()].map(...)` at the end) builds `e.dates` — the exact set of dates feeding each aggregated line — uses it to write the human-readable `detail` string, and then **discards it**. The returned item is `{ id, label, detail, qty, rate, amount, discountedQty, isExpense }`. Keeping `dates` would make per-line attribution a record rather than an inference.
**Why parked:** it cannot retrofit. Invoices already sent are frozen, so historical attribution would still have to be inferred by rebuilding the aggregation from the frozen `dayBreakdown` (which does store every day's full line list, so the mapping IS reconstructible — keyed `${label.split(" (")[0]}|${rate}`). Named failure modes for that inference: a renamed label breaks the key; an added line matches nothing (correctly whole-invoice); expense lines key on label *and* detail, both editable. And per-line attribution still needs the discount-concept gap above resolved before intent stops being guessed.

## Derived day links — the two failure modes no guard catches

**Trigger:** any work on partial invoicing, on editing a sent invoice's date range, or the next time a reported figure and an invoice disagree on a job whose invoice names no days.
**Change:** none. These are the accepted costs of the read-time derivation ruled in `CALC_DECISIONS.md` → *Stats money — unlinked invoices, read-time day derivation*. They are recorded here because **neither is detectable at runtime**: both present as a quietly wrong figure on a screen that looks fine.

**Why they exist at all.** Guards 1 and 3 of that ruling are exact — an invoice either carries a `dayBreakdown` or it does not, and another sent invoice either claims a day or it does not. **Guard 2 is a heuristic.** `shootDateStart`/`shootDateEnd` describe the *shoot*; they are not a record of what was *billed*. Everything below follows from that one gap.

**1. Partial invoice, over-attribution.** An invoice whose range spans the whole shoot but which billed only some of those days. Guard 2 resolves the range to every day inside it, so the invoice's net is treated as covering days it never paid for.
- **Direction:** the job **over-reports** — those days stop computing and contribute nothing of their own, while the invoice's net covers all of them. If the unbilled days are worth more than nothing, the job reads low; if the invoice was the larger figure, it reads high. Either way the *attribution* is wrong even when the total happens to look plausible.
- **Silent because:** the derivation succeeds. Every guard passes. There is no error state and no marker.
- **What would make it detectable:** a record of *what was billed*, not *when the shoot ran* — either the `dates` set that `buildInvoiceLineItems` already computes and discards (see the section above), or an explicit "this invoice covers these days" control on the invoice editor. Until one exists, the app cannot tell a whole-shoot invoice from a partial one.
- **Not a risk on the founder's data today:** all ten unlinked invoices' ranges resolve to exactly all of the user's days on their production. Pinned by `DL2`, which asserts what the app *does* with a wider-than-billed range rather than claiming it handles it.

**2. A day added inside the range after the invoice was sent.** The new day falls within `shootDateStart`–`shootDateEnd`, so the derivation treats it as covered by an invoice minted before it existed.
- **Direction:** the job **under-reports** by that day's value. The day computes nothing (it looks covered) and the invoice's net does not include it (it was sent first).
- **Silent because:** nothing compares the invoice's mint date against the day's. Adding a day is an ordinary edit with no invoice-facing consequence.
- **What would make it detectable:** comparing `day.createdAt` (added Phase 18, `feb3ecd`) against the invoice's `createdAt`/`dateSent` and refusing to derive over a day that postdates the claim. **Deliberately not built:** `createdAt` is backfilled for every day that predates the field, so the comparison would be unreliable on exactly the historical data this derivation exists to serve. It becomes viable once the backfilled generation ages out.

**Both err in the direction the ruling prefers on the data that exists** — under-claiming rather than mis-attributing — but neither is *guaranteed* to. That is the honest limit of deriving a day link from a date range.

## Marketing copy pass — soften the Greggs/Leatherman trademark usage

**Trigger:** next marketing/copy pass, or any trademark complaint (then immediately).
**Change:** soften third-party brand names used as price comparators. Locations: the stats "worth" comparators in index.html (~line 1848: "Greggs sausage rolls" £1.30, "Leathermans" £100, with emoji), the how-it-works.html line "how many Greggs that's worth" (~line 1875), and the references in DESIGN_v2.md and BRAND.md's voice examples. Generic alternatives ("sausage rolls", "multitools") keep the joke without naming the brands.
**Why parked:** the usage is nominative and jokey, low risk, and the voice guidance (BRAND.md) leans on the Greggs gag as a house-humour example — softening it is a copy decision worth taking deliberately, not in passing.

## Next Live Activity release — every LA lookup is date-scoped: a night shoot loses its card at midnight, unrecoverably

**Trigger:** any release touching the reconcile sweep, the LA descriptor/controller, or overnight day handling.

**The finding** (first recorded here as a passive miss during the wrap-prompt work; re-walked concretely at develop 3f2ddef and found worse). Every Live Activity lookup resolves its day record by `d.date === todayISO()` - the sweep's `qualifies` lookup, the husk-dismissal exemption, the start branch's wrap-prompt gates, and `liveActivityDescriptor` itself (which the in-app controller also mints from). For a solo night shoot dated Tuesday - 17:00 call, 04:00 wrap, `wrapNextDay` - all of them go blind at midnight while the shift is still running:

- **Active kill, midnight until the card dies (~01:00).** Any sweep trigger (foreground, visibilitychange, the 1s change-sweep) finds the card live in `byPid`, looks for a Wednesday-dated record, finds none, fails `qualifies`, and runs the "day deleted / date moved" cleanup against a mid-shift card: `endForProduction(pid, immediate)`, no linger. A second kill path needs no sweep at all: the day-page controller recomputes its descriptor on a 60s tick, the descriptor nulls at midnight, and the disqualification branch ends an owned card within a minute - so a user sitting on the day page at 00:00 watches the card die.
- **No re-mint, and no recovery by any user action.** After iOS ends the card (~8h lifetime cap), the husk branch dismisses it (the Wednesday lookup voids the send-off exemption) and the start branch cannot re-mint: the descriptor's own Wednesday lookup returns null. The controller, the Settings toggle's change-sweep, and the "Still on set?" prompt's Still-on-set answer all mint through the same null descriptor - including the last of those, whose code comment ("the stamp making these gates pass on the next sweep" is what mints) promises exactly the recovery that cannot happen. Lock screen empty for the back half of every night shift; the day sheet is all that remains.
- **Wrong-day mint on consecutive night blocks.** When a Wednesday-dated day EXISTS (a Mon-Fri night block), the descriptor resolves it at 03:00 and the start branch mints tomorrow's card mid-shift: call anchor 17:00 that evening (a future epoch), Wednesday's base-day total, while Tuesday's shift is still running.
- **Wrapped send-off linger dismissed early.** A day wrapped just before midnight has its linger husk swept on the first trigger after 00:00 - the Wednesday lookup voids the wrapped exemption, so the send-off is cut short. Cosmetic, same root.
- **Sibling gap found in the same walk (prompt side, fix proposed with this slice):** a NON-overnight day whose card chain runs past midnight leaves `wrapPromptDue`'s scope forever (its yesterday branch requires the wrap moment to have crossed midnight), so a day card-suppressed at every sweep until after 00:00 is never asked at all.

The wrap prompt otherwise deliberately does NOT inherit the blindness - `wrapPromptDue` accepts yesterday's record when its wrap moment crossed midnight, so the 05:00 overnight ask still lands and pay capture degrades gracefully. Card coverage does not.

**Fix direction (one slice, not four):** resolve the record by wrap moment everywhere, through ONE shared resolver (sibling of `wrapPromptDue`, reusing `resolvedWrapMomentMs`/`wrapPromptThresholdMs`, `nowMs` injected so it pins at synthetic midnights): yesterday's record wins while it is still running, else today's. Riding along or the fix is incomplete: the descriptor's epoch anchoring (`hhmmToEpochToday` at call/lunch/end, the wrapCurve next-day comparison, the `dayDefaults[today]` overlays) must follow the record's own date, and the controller's start key must embed the record date, not `todayISO()`. The discard-on-midnight ingest fix below must reuse the same resolver's notion of "yesterday's record still running" so the two paths cannot disagree.

**Status (25 August 2026): the resolver slice is BUILT on develop** - `1a199af` (laShiftRecord + the prompt's CARD_LIFETIME_MS suppression grace), `14eb9e6` (the sweep's three lookups; the kill and the early linger dismissal close here), `a0bc751` (the descriptor + controller key; overnight re-mint and the Still-on-set restart close here). Pins NR1-NR14 + WP16-17, all negative-tested; TT7a/TT8b/TT10a moved WITH the ruling. **The stillOnSetAt bound is max(threshold, callMs + 16h) by RULING (25 Aug 2026)** - the founder confirmed the deviation from the literal "extended to": an answer meaning "keep going" must never shorten coverage. Do not "correct" it to a literal replace; NR4's fourth conjunct pins the max. Ownership and epochs are proven at synthetic midnights in the harness; the CARD across a real midnight is device-verify-pending (test plan in the session record).

**Observation from the verify planning (prompt reach, consecutive blocks):** the prompt's live-card suppression is per PRODUCTION (WP11, ruled). On a consecutive-nights block, the morning-after foreground mints TOMORROW's card (existing pre-call behaviour) and that card then suppresses the ask for yesterday's still-unclosed day - so on back-to-back nights the overnight ask can be shadowed by the next shift's card. Not data loss (midnight already counted the day; the record just stays unwrapped/unasked until opened by hand). Candidate fix when the prompt next gets a slice: scope the suppression to the card whose dayDate matches the day being asked about, which the descriptor's dayDate field (a0bc751) now makes expressible.

**Ingest sub-piece RULED and BUILT (25 Aug 2026):** `laEventTarget` closes both event holes - the midnight discard below AND the second finding from the same walk (native intents stamp `ev.date` as UTC-today at PRESS time, so a post-midnight press was dated the new day and misrouted). Acceptance and apply target both ride the resolver; see the entry below for the built state.

**Why the remainder stays parked:** the ingest piece writes to stored days (propose-first under the pay/stored-data rule), and the card's midnight behaviour can only be finally verified on device. The full failure mode ships in the LIVE 5.4.0 build (the plugin, the qualifies-end branch, and husk dismissal are all on origin/main), so 2026.11 inherited rather than introduced it.

## Next Live Activity release — discard-on-midnight event loss — FIXED by ruling (25 August 2026), device verify pending

**Status:** RULED and BUILT with the night-resolver slice. `laEventTarget(productions, ev, nowMs)` (module scope, beside `laShiftRecord`) is the pure acceptance predicate: an event applies iff its production currently has an OWNING record per the resolver AND the event is dated within a day of it (the event-to-record identity check), and it applies TO the owning record's date - so a press queued before midnight that drains after lands on the still-running yesterday record, and a press stamped after midnight (`ev.date` is UTC-today at press time, the second hole) reroutes to the owner instead of the wrong day. `applied.add`-first idempotency unchanged; same four apply functions, no new write shapes; outside the window an event writes NOTHING (NI1, the corruption boundary, negative-tested hardest as ruled); `ingest.applyLate (rerouted|late drain)` diagnostics added. Pins NI1-NI4; TT5a/TT6b/TT6c/TT11b/TT13b moved WITH the ruling (dispatch dates are now the owner's). Remaining: the on-device midnight verify (walk plan in the session record). The paragraphs below are the original finding, kept as the record of what the bug was.

Found during the 2026-07-09 Live Activity Wrap-button investigation; parked because the fix lives entirely in the LA ingest path and can only be verified on device.

`ingest()` (index.html ~24739) drains pending Live Activity events and, per event, calls `applied.add(ev.id)` **before** the stale-date guard `if (ev.date !== today) continue;` (lines ~24747–24748). That order is deliberate for idempotency (the comment reads "mark seen once, today or stale — never reprocessed"), but it means a genuine event that crosses midnight before it drains is *lost*, not deferred. A Wrap (or lunch / set-times) tapped on the Live Activity late at night, whose immediate `drainRequest` background apply did not land — app not foregrounded, or iOS did not grant the intent its background window — sits in the native pending queue until the next foreground drain. If that drain happens after midnight, `todayISO()` has advanced, `ev.date !== today` is true, the event is discarded as stale **and** its id is already in `appliedEventIds`, so it is never reprocessed. The time the user entered on the card is silently gone; they must re-enter it by hand.

**Fix direction (not a spec):** the apply functions already target `ev.date` (`applyWrapNow(next, ev.date, ev.at)` writes to the event's own day), so a stale-but-recent event *can* be applied to the correct past day rather than dropped. The today-only guard exists to stop genuinely old queued events from clobbering current data on a cold launch, so the fix must bound the window (e.g. accept `ev.date === yesterday` while that day's shoot is still un-wrapped) rather than remove the guard outright, and must keep the `applied.add` idempotency intact — mark-as-applied must not outrun a still-applicable event. Verify on device across a real midnight rollover. Because this repairs a data-loss path, it is propose-first under the pay/stored-data rule.

## Crew editors — noOT is not copied by the CrewManager editor or the solo job-settings editor — FIXED Phase 8 (12 August 2026)

Both editors now track the flag exactly as QuickAddCrewSheet's edit branch does: set when the card row carries it, deleted when the role is re-picked away. Kept here as the record of what the bug was and how it is now held shut.

**What it was.** The card marks Director and Producer `noOT: true` (otCoef 0), and the calc reads `crew.noOT ? 0 : (Number(crew.otCoef) || 1)` — so the stored 0 alone cannot carry the rule: it falls through `|| 1` to **1.0x**. Two of the four crew-record writers carried the flag (the Best Boy commit, QuickAddCrewSheet); the CrewManager editor and the solo job-settings editor did not. A Director or Producer selected through either accrued weekday overtime at 1T that the card says they never get — an OVER-claim, the direction that puts a wrong figure on an invoice.

**What holds it shut now.** `NOOT1-4` (calc-boundary) pin the money: the same day and the same stored coefficient bill £1,009.05 with the flag and £1,201.25 without — £192.20 of phantom OT — and NOOT4 records that the two agree inside the basic day, which is why the bug hid. `S1-noOT` (construction-assertions) pins that all three editors carry the flag identically on selecting Director and all three delete it on re-picking away. `RW2`'s writers table now lists both patterns.

**Not repaired retroactively:** records already saved with the flag missing keep their stored shape until the role is re-picked, per the standing rule that preference and card changes are not applied backwards. A Director whose day already billed phantom OT on a sent invoice stays as invoiced (invoices are frozen); a draft re-derives on the next edit that re-picks the role.

## Any rate-card change — both cards must carry identical role-name sets

**Trigger:** adding, renaming or removing a role on any card in `RATE_CARDS` (so: every September uplift, and any mid-year correction).

Both cards carry the same 66 role names today (verified Phase 8: the Sept 2026 card is a BDR-only uplift of Sept 2025, same rows). Every role `<Select>` in the app is bound to `DEPARTMENTS`, which is `RATE_CARDS[0].departments` — the BASE card — while the *values* come from `roleDefaultsFor(production)`, which resolves the card by the production's start date. So a role can be **listed** from card 0 but **looked up** on a later card.

While the sets are identical that never bites, and it makes several `?? fallback` branches provably unreachable:

- `applyRoleOtProfile`'s `fallbackCoef` — three surfaces pass three different answers (the graded Phase 6 fallback, keep-existing, a flat 1.5)
- `stepUpPatch`'s `fallbackCoef` — likewise
- `autoOtCoef`'s card-less path, and the `d.bdr ?? …` rate fallbacks in every role picker

**Add a role to one card and not the other, and all of those become reachable at once** — on the same edit, with three different answers, none of them reviewed. The 2025 card is the one that matters most here: it is `RATE_CARDS[0]`, so it defines the pickable list for *every* production regardless of date.

**What to do:** when changing role names on any card, change them on all cards in the same commit, or make the picker resolve its list from the production's own card rather than the base card. If neither is possible, the three fallbacks stop being dead code and need adjudicating before the change lands — they were deliberately left per-surface (Phase 8) precisely because they were unreachable.

## Grid mode's tab bar can render un-tappable right after the view-mode switch (native)

**Found:** Phase 13 device pass (iPhone 17 Pro sim), pre-existing, transient.

Immediately after switching a Best Boy production from Mobile to Grid ·
Spreadsheet in production settings, the grid landed on the Setup content with
NO visible area tab bar (Setup / Timesheets / Export / Invoices) — taps where
it should sit did nothing, so the grid looked unreachable past Setup. After
leaving the production and relaunching, the tab bar rendered normally and the
whole grid (Timesheets, the day editor, the Phase 13 day-rate route including
its `bb-day-rates-sheet` back level) worked on the phone, verified end to end.
So this is a transient render state around the mode switch, not a permanent
layout clash — worth a look next time someone is in that header code (likely
the sticky bar's first render against the native chrome inset), not urgent.
One related observation from the same pass: on iOS the left-EDGE swipe is not
wired to the back-level stack anywhere in the app — the chrome chevron is the
back affordance and pops one level correctly, stacked sheets included.

## The mobile BB day editor (CMDV) has no day-rate route

**Found:** Phase 13, while walking the approved route.

The founder-approved Phase 13 route lives on the two DayEntryForm surfaces
(solo header, grid day editor) plus production settings. The phone's Best Boy
day editor is a THIRD surface — the crew-member day view reached from the
mobile ticker — with its own DAY TYPE row and none of the route. So on the
phone, a Best Boy pricing a recce day still has no path from the day to the
Day rates control. Extending the same two-state affordance to CMDV's DAY TYPE
row is a natural follow-up but is a new surface the founder has not ruled on;
propose before building. (The plumbing exists: the sheet already takes
initialOpen + routedDayType.)

## Pattern: an error boundary can hide a fully broken surface from every gate

**Found:** Phase 13 — the grid crew editor crash (`cardRoles` out of scope)
shipped past 1,356 storage assertions and seven phases of device passes.

The mechanics, worth recording separately from the fix: the audit sandbox
stubs React, so component bodies never execute — a ReferenceError inside a
render exists for every gate only as source text, and source-shape pins can
only catch the shapes someone thought to pin. At runtime the RootErrorBoundary
catches the throw, logs to console, and shows "Something went wrong on this
screen" with a Go back button. That is correct product behaviour and also
means: a surface can be entirely broken while the gate stays green and the
app looks fine from every OTHER surface. The failure only becomes visible
when a person renders that exact surface — and device passes walk the
surfaces the phase touched, not all of them. The grid crew editor was on
nobody's walk for seven phases.

Standing mitigation until a render audit exists: when a phase's device pass
is in an area, open every editor that area can reach, not just the one the
phase changed.

## Raw day-record gates — the remaining sites (Phase 13 sweep, parked)

**Context:** solo AND Best Boy mobile write paths thin day records — dayType
(and times) can live in `dayDefaults` and cascade back through `resolveDay`.
Phase 13 fixed the solo header chip, the Day rates disclosure gate, and made
all three day-rate routes read resolved types. A sweep of every remaining
`.dayType` read (86 sites) found the rest are resolved, explicit-by-
construction (LF days, wire days, invoice snapshots, cancellation columns,
form buffers), or raw BY DESIGN (override/variance detection reads rawness
deliberately). Three sites remain in the same class as the fixed bugs — all
display/behaviour gates, none money — parked for a ruling, not fixed:

- `CrewMemberDayView` — `isTravelDay = dayRecord.dayType === 'Travel Day'`
  gates the travel-day chip behaviour on the RAW record; a BB day whose
  Travel Day type cascades from dept defaults gets non-travel chip handling
  while the header says TRAVEL DAY.
- `CrewMemberDayView` — `canRemove={dayRecord.dayType !== 'Day off'}` on the
  raw record; a defaults-driven Day off is removable when an explicit one is
  not.
- `DayBreakdownView` — the crew-on-date filter tests `d.dayType !== 'Rest
  Day'` raw, so a defaults-driven Rest Day still lists the crew member on
  that date.

The fix in each case is the same one already ruled correct twice: resolve
first. **Ruled (founder, 2026-08-17): approved, parked until after the
2026.11 submission.** Land all three as a SINGLE item, one commit, with one
device walk covering CrewMemberDayView and DayBreakdownView.

## Boundary breadcrumb — approved, after the 2026.11 submission

**Ruled (founder, 2026-08-17).** `componentDidCatch` writes a
`bigals_last_render_error` record (message, component stack, APP_VERSION,
date) through the storage adapter; Settings → Help & data surfaces it as a
"Last screen error" row. Deliberately NOT before submission: it adds a
persisted `bigals_*` key, which means the adapter's KEYS warm list in the
same commit (the T1 rule) — a schema change, not a slip-in. One commit when
picked up.

## Render-smoke audit stage — the next phase, once 2026.11 is away

**Ruled (founder, 2026-08-17): this is the one they want.** Scope it as its
own proposal when picked up. The argument, in the founder's words: a whole
surface was broken for seven phases while every gate stayed green, because
nothing in the suite renders anything — everything built so far tests
calculation and record construction, which is why both money bugs were
caught and this wasn't. Sketch to start the proposal from: an `audit:render`
stage loading the bundle with real react-dom in jsdom against a seeded
fixture, mounting the app, opening each editor surface once (solo day, grid
crew editor, grid day editor, CMDV, settings sheet, LF day editor), failing
on any RootErrorBoundary trip. react/react-dom/jsdom as devDependencies
only — the shipped app stays on the CDN.
