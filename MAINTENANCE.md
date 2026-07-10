# Maintenance notes

Parked work with a known trigger date or event. Each item states its trigger, the exact change, and why it is parked rather than done.

## Launch day (App Store approval of 5.2.1)

**Status: the copy swaps are DONE — staged on the `launch/website-go-live` branch (2026-07-10), which merges on launch day alongside the two held code branches.** All beta/TestFlight framing across welcome.html, how-it-works.html, privacy.html and the articles pages was replaced with App Store framing (the ruled four from the earlier version of this section, plus every remnant a fresh scan found). The one deliberate survivor: privacy.html's "if you're ever running a beta build through TestFlight" paragraph, which is conditionally worded and stays accurate for any future beta build.

Remaining manual actions ON launch day, before/at merge of `launch/website-go-live`:

| Action | Where | Detail |
|---|---|---|
| Paste the real App Store URL | all site pages | Find-and-replace the placeholder `https://apps.apple.com/gb/app/timemachine/id0000000000` (14 links; `grep -rn "id0000000000"` finds them, plus two `TODO(launch)` comments) |
| Set the privacy effective date | privacy.html | Currently "Effective 10 July 2026" (staging date, marked with a `TODO(launch)` comment) — set to the actual launch date |
| Decide the draft article | articles.html + articles/how-apa-overtime-works.html | The stub is honestly labelled "Coming soon"/"Draft" — finish it, hide it, or ship it as-is (editorial call, not launch-blocking) |

## 1 September 2026 — marketing rate labels

welcome.html and how-it-works.html footers carry static "APA Sept 2025" markers. These are accurate until 31 August 2026; from 1 September the operative card is Sept 2026 (the app's own footers are version-aware and handle themselves). Update the two static page footers on or shortly before 1 September 2026.

## iOS 27 cycle — delete the requestConfirmation fallback

`TimeMachineAppShortcuts.swift` (the "log my times" Siri intent) uses the replacement API `requestConfirmation(actionName:dialog:)` on iOS 18+; the deprecated `requestConfirmation(result:)` call survives only as the `#available(iOS 18.0, *)` else-branch serving the intent's iOS 17 floor. Adjudicated 2026-07-05: do not migrate early — the two-tap confirm flow is device-verified. When the intent's availability floor rises to iOS 18 (planned for the iOS 27 maintenance cycle), delete the else-branch. The migration is a deletion, not a rewrite.
