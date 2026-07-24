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

## Next Live Activity release — discard-on-midnight event loss

Found during the 2026-07-09 Live Activity Wrap-button investigation; parked because the fix lives entirely in the LA ingest path and can only be verified on device.

`ingest()` (index.html ~24739) drains pending Live Activity events and, per event, calls `applied.add(ev.id)` **before** the stale-date guard `if (ev.date !== today) continue;` (lines ~24747–24748). That order is deliberate for idempotency (the comment reads "mark seen once, today or stale — never reprocessed"), but it means a genuine event that crosses midnight before it drains is *lost*, not deferred. A Wrap (or lunch / set-times) tapped on the Live Activity late at night, whose immediate `drainRequest` background apply did not land — app not foregrounded, or iOS did not grant the intent its background window — sits in the native pending queue until the next foreground drain. If that drain happens after midnight, `todayISO()` has advanced, `ev.date !== today` is true, the event is discarded as stale **and** its id is already in `appliedEventIds`, so it is never reprocessed. The time the user entered on the card is silently gone; they must re-enter it by hand.

**Fix direction (not a spec):** the apply functions already target `ev.date` (`applyWrapNow(next, ev.date, ev.at)` writes to the event's own day), so a stale-but-recent event *can* be applied to the correct past day rather than dropped. The today-only guard exists to stop genuinely old queued events from clobbering current data on a cold launch, so the fix must bound the window (e.g. accept `ev.date === yesterday` while that day's shoot is still un-wrapped) rather than remove the guard outright, and must keep the `applied.add` idempotency intact — mark-as-applied must not outrun a still-applicable event. Verify on device across a real midnight rollover. Because this repairs a data-loss path, it is propose-first under the pay/stored-data rule.
