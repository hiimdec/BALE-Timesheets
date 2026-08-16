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

## Marketing copy pass — soften the Greggs/Leatherman trademark usage

**Trigger:** next marketing/copy pass, or any trademark complaint (then immediately).
**Change:** soften third-party brand names used as price comparators. Locations: the stats "worth" comparators in index.html (~line 1848: "Greggs sausage rolls" £1.30, "Leathermans" £100, with emoji), the how-it-works.html line "how many Greggs that's worth" (~line 1875), and the references in DESIGN_v2.md and BRAND.md's voice examples. Generic alternatives ("sausage rolls", "multitools") keep the joke without naming the brands.
**Why parked:** the usage is nominative and jokey, low risk, and the voice guidance (BRAND.md) leans on the Greggs gag as a house-humour example — softening it is a copy decision worth taking deliberately, not in passing.

## Next Live Activity release — discard-on-midnight event loss

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
