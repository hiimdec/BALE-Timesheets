# Maintenance notes

Parked work with a known trigger date or event. Each item states its trigger, the exact change, and why it is parked rather than done.

## Launch day (App Store approval of 5.1)

The live pages keep their beta framing until the App Store version is approved. On approval day, apply the following swaps. The ruled set is the four beta-era phrases; the TestFlight CTA rows below them are flagged for review at the same time since the links themselves will want to point at the App Store listing.

| File | Where | Current | Replacement |
|---|---|---|---|
| welcome.html | line ~7, `<meta name="description">` | "On the web, and now on iPhone via TestFlight. Free during beta." | "On the web and on iPhone. Free." |
| welcome.html | line ~11, `og:description` | "On the web, and now on iPhone via TestFlight. Free during beta." | "On the web and on iPhone. Free." |
| welcome.html | line ~772, hero | `<span class="beta-tag">Beta</span>` | Remove the span (or replace with nothing — the version pill next to it stands alone) |
| privacy.html | line ~234, "Who this policy is from" | "available on the web and as an iPhone app (now in open beta on TestFlight)" | "available on the web and as an iPhone app on the App Store" (drop the TestFlight link) |

Also review on the same day (not part of the ruled four):

| File | Where | Current | Suggested |
|---|---|---|---|
| welcome.html | line ~804 | "Get the iOS beta · TestFlight" CTA | "Get it on the App Store" linking to the listing |
| welcome.html | line ~812 | platform pill "iOS beta · TestFlight" | "iPhone · App Store" |
| welcome.html | line ~892 | "Join the iOS beta on TestFlight" | "Download on the App Store" |
| privacy.html | "On iPhone (TestFlight & the App Store)" section | Beta paragraph is conditionally worded and stays accurate | No change required; re-read for tone once beta ends |

## 1 September 2026 — marketing rate labels

welcome.html and how-it-works.html footers carry static "APA Sept 2025" markers. These are accurate until 31 August 2026; from 1 September the operative card is Sept 2026 (the app's own footers are version-aware and handle themselves). Update the two static page footers on or shortly before 1 September 2026.

## iOS 27 cycle — delete the requestConfirmation fallback

`TimeMachineAppShortcuts.swift` (the "log my times" Siri intent) uses the replacement API `requestConfirmation(actionName:dialog:)` on iOS 18+; the deprecated `requestConfirmation(result:)` call survives only as the `#available(iOS 18.0, *)` else-branch serving the intent's iOS 17 floor. Adjudicated 2026-07-05: do not migrate early — the two-tap confirm flow is device-verified. When the intent's availability floor rises to iOS 18 (planned for the iOS 27 maintenance cycle), delete the else-branch. The migration is a deletion, not a rewrite.

## Next Live Activity release — discard-on-midnight event loss

Found during the 2026-07-09 Live Activity Wrap-button investigation; parked because the fix lives entirely in the LA ingest path and can only be verified on device.

`ingest()` (index.html ~24739) drains pending Live Activity events and, per event, calls `applied.add(ev.id)` **before** the stale-date guard `if (ev.date !== today) continue;` (lines ~24747–24748). That order is deliberate for idempotency (the comment reads "mark seen once, today or stale — never reprocessed"), but it means a genuine event that crosses midnight before it drains is *lost*, not deferred. A Wrap (or lunch / set-times) tapped on the Live Activity late at night, whose immediate `drainRequest` background apply did not land — app not foregrounded, or iOS did not grant the intent its background window — sits in the native pending queue until the next foreground drain. If that drain happens after midnight, `todayISO()` has advanced, `ev.date !== today` is true, the event is discarded as stale **and** its id is already in `appliedEventIds`, so it is never reprocessed. The time the user entered on the card is silently gone; they must re-enter it by hand.

**Fix direction (not a spec):** the apply functions already target `ev.date` (`applyWrapNow(next, ev.date, ev.at)` writes to the event's own day), so a stale-but-recent event *can* be applied to the correct past day rather than dropped. The today-only guard exists to stop genuinely old queued events from clobbering current data on a cold launch, so the fix must bound the window (e.g. accept `ev.date === yesterday` while that day's shoot is still un-wrapped) rather than remove the guard outright, and must keep the `applied.add` idempotency intact — mark-as-applied must not outrun a still-applicable event. Verify on device across a real midnight rollover. Because this repairs a data-loss path, it is propose-first under the pay/stored-data rule.
