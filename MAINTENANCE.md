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
