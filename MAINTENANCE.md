# Maintenance notes

Parked work with a known trigger date or event. Each item states its trigger, the exact change, and why it is parked rather than done.

## Analytics A–E: BUILT 2026-09-01 (the STOP is lifted once these are on the device)

All four landed the same day they were proposed; the descriptions below are
kept as the record of why each existed:

- **A. trackEvent reports success on any HTTP status.** `fetch` resolves on
  4xx/5xx; the wrapper returns true after `await send()` regardless, and
  `trackOnce` then writes the marker permanently. Hitting the 20,000/month
  quota (debug events count) or shipping a bad key silently destroys every
  milestone crossed that month, for every user, for ever. Every existing
  pin's transport resolves silently, which is why this was invisible.
- **B. shoot_N counts productions.length unfiltered.** A standalone invoice is
  a production record; imported shares count too. AN13 asserts the inflated
  behaviour and cannot go red.
- **C. The Settings native copy says Aptabase "stores nothing on your phone"**
  and the analytics header comment says nothing is stored on the device;
  both false since the marker. AN21 pins the wrong sentence in.
- **E. The retention windows (7–29 / 30–89) miss the normal freelance shape**:
  install for a five-day job, nothing for four weeks. Calendar buckets
  ("active in week 2", "active in month 2") are proposed instead.

## Release-time verifications owed (2026.12) — what each looks like if wrong

- **D — BuildInfo on a release device.** If `BuildInfo.kind()` throws or the
  method is misnamed, fail-toward-debug sends EVERY real user to the debug
  bucket: the release dashboard stays empty while debug fills. Only the first
  App Store event proves it. Check the release bucket on launch day.
- **F — Netlify has never run `npm run build`.** The live command was
  `build-web.js` alone; the 2026-09-01 change adds `build.js`, which needs
  esbuild (its Linux binary is an optional dep in the lockfile, so it should
  resolve under `--ignore-scripts`) and the tailwindcss CLI, both
  devDependencies. Untested differences from the local proof: NODE_VERSION 20
  vs local 22; whether Netlify installs devDependencies for this site; and
  `/app` WITHOUT a trailing slash — the app's asset paths are relative, the
  local server auto-redirected, Netlify's behaviour is unverified. If wrong:
  the deploy fails (visible) or `/app` serves a blank page with 404s for
  `/assets/app.js` (silent — check the browser network tab on first deploy).
  The netlify.toml comment claiming "the web build uses no npm packages" was
  false and has been corrected.
- **G — the marker across a real restore.** Proven by fixture only; the one
  device test was a false negative (stale build, old backup).
  `@capacitor/preferences` is `UserDefaults.standard`, which iOS device
  backups include, so a new-phone migration should carry it with no app-level
  restore. If wrong: every new phone re-fires every milestone.
- **H — the ungating on a 15 Pro.** A simulator has no model, so it cannot show
  three full-page previews rendered for hallucinated fields on Comet, nor the
  share-extension entry from Mail/WhatsApp. Walk both on the 15 Pro.

## Call-sheet round of 2026-09-02 — the OCR fallback, four shape fixes, and what the expectations run said

**The first real measurement.** The founder's `expected.txt` (all 20 blocks
checked) scored the reader at 100/120 fields, 7 sheets fully correct. Job
ref 20/20, emails 17-19/20; the misses were title (5) and company (7), and
five of those twelve were sheets whose text layer has nothing to find.

**The OCR fallback** (Priority 1): trigger = layer present AND company or
postcode missing; pages = page 1 + invoicing pages; fill only company and
postcode, never emails, never replace. ~210 ms/page on a Mac at 1600px,
1-3 pages per triggering sheet (six sheets trigger); Vision is iOS 13+,
on-device. **The ceiling is the lexicon, not the OCR**: Vision reads
"THETWO", "TILL DAWN AGENCY" and "The Visuals Team" today; the rules refuse
the first two. Read the OCR cache before swapping the engine.

**The shape fixes** (Priority 2): Amahla's digit-glued word; Teepee's joined
header row; Forever Living's two-line masthead; the labelled cell without a
suffix, OCR text only, with the label-prefix and damaged-postcode rejections
(on the layer it captured "SUSSEX BN NR", "BARNES", "CLIENT AUDIBLE").

**Rulings.** Dove: the NARROW rule - a CLIENT masthead winner yields to a
PRODUCT line within three lines below it; the blanket form broke Nike.
Everlast: an agency is NEVER the payee; it stays an honest miss. Bank of
America: **whoever the invoicing block names** - page 6 says "COMPANY
ADDRESS: Knucklehead, 28 Cowper Street, …", so the block names one of the
header's two companies, the founder's file already matches it, and the fix
is one payee anchor ("COMPANY ADDRESS:" inside a block), ranked above the
label path as the payee branch always was. No other sheet carries a
two-company production-company label (the other `x`/`&`/`/` hits are single
names), so this fixes one sheet and needs no user fallback. Had the block
been silent, the header value "KNUCKLEHEAD x EPOCH" would show as a
VERIFIED two-name company, not as unverified - there is no corpus sheet
with that shape, so nothing was built for it.

**Harness**: title and company comparisons are case-folded (two remaining
"misses" were the founder's own capitalisation), and "(none" is accepted
as none.

## Call-sheet rulings landed 2026-09-01 — what changed across the corpus

- **Cleaning is not sourcing.** `cleanTitle` / `cleanRef` apply to whatever
  wins, model or pattern; `resolveField` (a verified model value is never
  displaced) is untouched. Across 20 sheets: zero pattern titles change, one
  reference changes (Square `1001` → `1001 25`, the deleted numeric-pair
  collapse). The three device model values clean correctly.
- **Title precedence: `title:` outranks `production title:`, `production:`
  and `client:`.** Ruled as four changes; measured as FIVE — the fifth was
  M&S (‘THE WALK’ ‘GIFTING’ ‘HOSTING’). **OVERRULED: M&S keeps "MARKS &
  SPENCER".** Everlast was two plausible job names; M&S is a job name against
  three film titles in quote marks, which on an invoice reads like a pasted
  shot list. A GUARD is proposed (not yet built): a `title:` value loses to
  the next label when it is a LIST of quoted strings (two or more). Measured
  across all 20: M&S reverts, and no other sheet moves - Square, Brother,
  McDonald's and Everlast still change; Comet's single quoted title is not a
  list and survives. A "mostly quoted" share and a 28-character ceiling also
  separate the set cleanly; the list rule is preferred because it names the
  actual shape rather than a threshold. Until the guard lands the corpus
  TITLE-PIN for M&S asserts the overruled value.
- **The Comet masthead fix** needed two rules, not one: a field-label line is
  skipped, an ADDRESS line is skipped (skipping only the label promoted its
  wrapped continuation "ESSEX, SS7 2RF"), and a fully QUOTED page-1 line wins
  over position. `client` is deliberately NOT a skipped label: on Dove,
  "CLIENT DOVE" is the title-at-best and skipping it regressed the sheet.
- **The Comet bound**: 12 seconds and three pages (page 1 + the two densest)
  when no page mentions invoicing; unchanged when one does. Patterns still
  run on every page.
- **DFS address — not a fault, recorded, nothing built.** Select-on-sheet
  renders the page and OCRs it; a tap returns the OCR LINE, and on DFS the
  address is printed inside a sentence. That render-and-OCR path is also why
  InRehearsal's manual selection worked where the harvest could not.
- **The nine masthead fixtures now assert on PDFKit** (harvest corpus mode,
  `TITLE-PIN` lines, 15 sheets), alongside the sanitised logic fixtures.

## Legwork rollup (2026.12) — what was built, what the first prune execution surfaced, and one thing never to propose

**Built 2026-09-02, founder-ruled.** `userPrefs.legworkRollup` is the
never-pruned summary that survives a new phone: per year, counted days,
total steps, the best day with its date, and the LOWEST NONZERO day (under
the 100-step floor that is "the day you barely moved" - a real figure; a
denied read, a genuine zero and a phone left in the van all write 0 and are
indistinguishable, so zero is never a lowest). Shoot days only, fed solely
from cache entries the block counts. It rides inside `userPrefs` like
`analyticsSent` and `firstRunAt` - no new key, no migration, in the backup.

**Fold at the prune, never on write.** The cache's write site re-runs on
every Stats visit for any unsettled day; folding there counts a day once
per visit. The fold is hooked at the CAP prune only (`onPruned`, one call
site), never the orphan prune (a deleted day is not a day worked), and
`throughWindowEnd` refuses anything at or below it.

**What running the cap prune for the first time surfaced** (it had been
regex-pinned only; LR2 executes it with 401 days through the real sweep):
the prune works exactly as written, and it CHURNS. A day beyond the cap
still exists, so each Stats visit refetches it from HealthKit and prunes it
again as the oldest - **one HealthKit call per visit per day beyond the
cap, for ever**. The rollup makes this harmless to the numbers (LR2b: no
double count), and it is bounded by (live shoot days − 400), which no user
is near. **FIXED the same day, founder-ruled** ("the alternative is a note
somebody reads in two years when a user's Stats screen has gone slow"): one
line in the sweep - a day whose windowEnd is at or below the rollup marker
is never fetched, because it is already counted - with the marker threaded
in from the Stats call site. LR2c now asserts ZERO second-visit calls for
the aged day and reddens by name if the skip is removed; LR2d pins that the
marker actually reaches the sweep, because a skip that is never fed still
churns.

**The restore finding, sharpened.** The August note said every restore
drops the step history. `importBackup` neither carries nor wipes
`bigals_health_steps`: a same-phone restore keeps whatever the cache holds;
a NEW phone starts empty. The rollup is the answer to the second case.

**NEVER PROPOSE "your biggest walking day ever" from HealthKit.** The whole-
year figure is one `HKStatisticsQuery` cumulative SUM (built: "You walked X
this year, Y of them on shoot days"). A statistics query returns a sum, not
a max; a per-day maximum is a per-day loop - **365 HealthKit calls** - and
anyone proposing it for Wrapped will rediscover that cost. The rollup's
best day is the shoot-day best, which is a different question and is free.

**The permission prompt is two mechanics because iOS shows the Health sheet
once.** The first-time ask is the existing opt-in card on Stats (status
`shouldRequest`). The declined explainer is the has-days-but-all-zeros state,
now with the `app-settings:` deep link the sentence only used to promise.
The app cannot tell granted from denied - `querySteps` returns 0 for both -
so the explainer is honest copy, not a detected state. Both live on Stats,
where the data appears; nothing in front of anything.

## The announcement decks (2026-09-02) — one chassis, two copy rounds, do not confuse them

**The tutorial stamps the what's-new edition on dismissal - RECONSIDERED
2026-09-02 AND KEPT.** `dismissIntro` writes `seenWhatsNewVersion` as well as
`seenTutorialVersion`, so a user who has just seen the tutorial never sees
that edition's what's-new deck. This surfaced when the founder's device
showed the tutorial and not the deck; it is not an oversight. The reason
(ruled in August, reaffirmed): a new user does not need telling what changed
since a version they never had. The consequence, now handled: there was no
route back to the deck, so **Settings → Tutorial & what's new → "Show what's
new again"** clears the what's-new edition only (the tutorial button clears
its own only; neither may clear both - pinned). That button is also how the
founder reviews the release copy on a device before submitting it.

**The deck's device round (2026-09-03), four fixes built.** The founder's
first device pass on the announcement deck found: a half-height sheet with a
dead area beneath; a glow with a visible disc edge; sizes that came back
medium when large was asked for; and the tutorial's footer on a deck that is
not the tutorial. Built as ruled: (1) `Sheet` gained an opt-in `fullHeight`
prop, default off, passed by the `AnnouncementDeck` chassis alone - the
opt-in card squares its top, fills the wrapper as a column and pads by the
top safe inset; a non-opt-in sheet's DOM is byte-identical to before (the
variant is folded into the existing conditional slots). Both decks are
full height, because they share the chassis. (2) The glow is a closest-side
radial gradient in the accent's bright shade that is fully transparent by
72% of its own radius - no blur filter, so no edge to see. (3) Tile 104,
icon 46, headline 31, kicker 11, supporting line 15. (4) The what's-new deck
carries no footer; the tutorial keeps its own. Pins FH1-FH5; DK2 retargeted
to the `fullHeight` call. Twelve mutations, each on a named clause.

**OPEN - the what's-new deck fires over a fresh install's onboarding.**
Found while capturing the deck on the web build with empty storage: with
`onboardingComplete` false, `introDue` is false, so `whatsNewDue` is TRUE
and the deck mounts on top of "Step 1 of 3". A brand-new user is told what
changed before they have seen anything. Proposed one-line fix, NOT built
(gating is a founder ruling): `whatsNewDue` requires
`userPrefs.onboardingComplete` as its first clause. Completing onboarding
then makes the tutorial due, and dismissing the tutorial stamps the
what's-new edition, so the new user never sees the deck - which is the
kept ruling above.

**OPEN - poppy collapses the three hero accents.** On the default theme the
three heroes are sky, green and amber: distinct tiles (`--tm-tile-*`),
inks and glows. On poppy all three tile tokens resolve to the plum family
(sky-950 and card-2), so only the ink and glow differ - pale pink, pale
green, pale amber on the same plum tile. Two options put to the founder:
poppy gets three tints of its own (the plum ground mixed with each accent
at about 15%: roughly `75 57 59` for green and `83 53 54` for amber), or a
single-accent deck is correct for a themed app and the variety lives in
the ink alone. Awaiting the ruling; the palette is unchanged.

**OPEN - hero icons read thin at 46px.** The icon set is 36 outline
components on one base with a `strokeWidth` prop (default 2); none passes
its own weight and only `ICalc` carries a fill (its key dots). Options put
to the founder: a heavier stroke for hero use only (`strokeWidth={2.5}` at
the hero call, nothing to draw); a duotone treatment on the base (the same
paths filled at low alpha under the stroke, nothing to draw but each hero
icon needs a look, since an open path fills as if closed); or filled
variants drawn by hand (three now, one per future hero). No icon library.
Awaiting the ruling.


Both pop-ups now render through `AnnouncementDeck`: a sheet with a grabber,
a heading with the version in mono, a swipeable full-height page track, bar
dots, and ONE way out (the button, "Got it" on the last page). The old
what's-new was `InfoModal` prose; the tutorial had Skip, two arrows and the
button - three exits.

- **What's new (2026.12): the COPY IS PLACEHOLDER.** The three-hero mapping
  of the nine 2026.11 highlights is a starting point; the real copy is
  written after the device walk, when we know what shipped. One ruling
  already made and pinned: the dayDefaults promotion fix is described as a
  general bug fix and is NEVER named - nobody was affected, and naming it
  would alarm people about something that did not happen to them.
- **The tutorial: its six cards and their illustrations are UNTOUCHED.** It
  adopted the chassis only (lost Skip and the arrows). **Its copy is its
  own round in 2026.14** - not this one, and not the what's-new rewrite.
- The tile shades (`tm-tile-sky/green/amber`) are the BRAND.md exception;
  under the poppy theme they resolve to existing poppy tokens (sky-950 and
  card-2) rather than invented colours, so the "do not adjust" palette pin
  is untouched.

## Analytics — the SDK's own isDebug detection is INVERTED here. Never adopt it.

`@aptabase/web` decides `isDebug` automatically, and its last resort is:

```js
defaultIsDebug = location.hostname === 'localhost';
```

Capacitor iOS serves the app from `capacitor://localhost`. Confirmed in
`node_modules/@capacitor/ios/Capacitor/Capacitor/CAPInstanceDescriptor.swift:5`
(`public static let hostname = "localhost"`), and our `capacitor.config.json`
has no `server` block, so the default applies.

So `location.hostname === 'localhost'` is **true on every install, App Store
included**. Had we wired the SDK, every real user would have been stamped
debug, every event would have landed in the `_DEBUG` bucket, and the release
dashboard would have been permanently empty — with nothing failing and nothing
to see. It is not merely absent in this setup; it is backwards.

This is why `BuildInfoPlugin` exists. Native `#if DEBUG` (plus the TestFlight
receipt check) is the only source of truth, asked once at startup and cached.
`audit:native` clause AN17 asserts `location.hostname` appears nowhere in the
source, precisely so a future "let's just use the SDK" cannot land quietly.

**Do not replace the native seam with the SDK's detection.** If the SDK is ever
adopted for other reasons, pass `isDebug` explicitly from the native answer.

## Analytics — retention is CALENDAR BUCKETS now (founder-ruled 2026-09-01), and one thing WILL look like a fault

`retained_7` means **active in week 2**: the app was opened on any of days 7
to 13 after first run. `retained_30` means **active in month 2**: opened on
any of days 30 to 59. Each is "came back in a defined later period", the
ordinary D7/D30 cohort shape, so the two numbers can be read side by side.
They are still independent periods, not a funnel.

**The case someone will query in three months.** A gaffer installs on day one
of a five-day job, logs all five days, and then has no work for four weeks.
They open the app again on day 35. They fire `retained_30` and they never
fire `retained_7`. That is not a fault. They were not active in week 2, and
the number says so. Week-2 retention will read LOW for freelance crew whose
work comes in short jobs with gaps between them - that is the shape of the
trade, and the metric is measuring it honestly rather than pretending a
day-35 return was a day-7 one. The earlier 7–29 / 30–89 windows tried to
paper over exactly this and mis-stated it instead. If week 2 needs to mean
something else for this audience, the fix is a different definition, not a
wider window.

## SUPERSEDED (2026-09-01) — the 7–29 / 30–89 windows and why they were wrong

`retained_7` and `retained_30` are anchored on `userPrefs.firstRunAt` and each
is a **bounded window**, not an open-ended threshold:

- `retained_7` fires on an app open **7 to 29 days** after first run
- `retained_30` fires on an app open **30 to 89 days** after first run

Three things about this will look like bugs on the dashboard and are not.

**1. They are independent windows, not a funnel. `retained_30` can exceed
`retained_7`.** Someone who installs, disappears for 40 days and comes back
fires the second without ever firing the first. Do not "fix" this by making
retained_30 require retained_7 - that compounds the undercount below.

**2. The error direction is undercount, deliberately.** A genuinely retained
user who happens not to open the app during a window is never counted. For a
number used to decide whether to keep building something, undercounting is the
safe failure. The old open-ended `>=` overcounted instead, which is worse.

**3. Retention starts at the 2026.12 release. Everything before contributes
nothing.** `firstRunAt` is only stamped on a genuinely fresh install, so every
install predating the field has `""` - and `""` means fire nothing, with no
fallback. Founder-ruled: a number you cannot trust is worse than one that
starts empty. The first months will read low while the cohort builds.

**Why there is no work-date fallback.** The original rule measured days since
the earliest logged work day, which is an age test on the work rather than a
usage test on the person. It was wrong twice:

- A user who logged one shoot in May and opened the app once in September fired
  **both** thresholds. That is the definition of churned.
- A **brand-new** user who backfilled a job they did in May fired `retained_30`
  on their **first ever launch**. Backfilling a finished job to invoice it is
  one of the main reasons people download this app, so that was not an edge
  case - it was a main path.

AN15b pins both by name and AN15c pins that no fallback returns. The comment on
`firstRunAt` in DEFAULT_USER_PREFS used to recommend exactly that fallback; it
has been corrected, because it was the source of the mistake.

## Analytics — read a once-ever milestone with count(), NOT unique users

**There is no per-event unique-user metric in Aptabase.** This costs a day to
rediscover, and an early design here was built on the assumption that one
existed.

From `etc/tinybird/endpoints/top_n.pipe` (the per-event breakdown), the only two
values it will compute are:

```sql
{% if value_column == 'UniqueSessions' %}
 uniqExact(session_id) as Value
{% else %}
 count() as Value
{% end %}
```

`count()` or unique **sessions**. Not unique users. `uniqExact(user_id)` appears
only in `key_metrics.pipe`, for app-wide DailyUsers, never per event.

User identity could not carry the weight anyway. From
`src/Features/Privacy/DailyUserHasher.cs`:

```
salt   = per-app, per-CALENDAR-DATE, 16 random bytes (app_salts table)
userId = SipHash(salt, "{clientIP}|${userAgent}")
```

with `PurgeDailySaltsCronJob.cs` deleting old salts nightly. So:

- **Cross-day identity is impossible by design.** A new salt each date means the
  same person hashes differently tomorrow, and the salt is then destroyed, so
  even Aptabase cannot re-link it. This is the privacy property the service was
  chosen for; it is not a bug to route around.
- **Same-day identity is IP-based**, so one person moving between set 4G, home
  wifi and a hotspot is several ids on the same day. Only the
  `USERID-{appId}-{sessionId}` cache (48h) holds it stable within one session.

**Therefore:** a once-ever milestone is read as **`count()` over the period** -
"this many people crossed five shoots in November". Unique sessions reads lower,
and unique users is not on offer. The every-time events (production_created,
invoice_sent, callsheet_used, timesheet_shared, import_used) are also `count()`,
but there it means volume rather than people.

This is why `userPrefs.analyticsSent` exists: deduplication has to happen on the
device, because the service structurally cannot do it. **Do not remove the
marker on the reasoning that Aptabase will absorb the repeats. It will not.**

## Analytics — debug events still count toward the 20,000/month quota

Separating debug from release is for **data quality, not cost**. From the
Aptabase server source:

- `src/Features/Ingestion/Buffer/EventRow.cs:37` — debug events are stored
  under `<appId>_DEBUG`, a separate bucket that never mixes with release.
- `src/Features/Stats/StatsController.cs:182` — the dashboard's build-mode
  selector reads that bucket. No second app to register.
- `src/Features/Billing/BillingQueries.cs:51` and
  `etc/clickhouse/queries/billing_usage_per_app__v1.liquid` — billing groups by
  `replace(app_id, '_DEBUG', '')`, so **debug events are billed like any
  other**.
- Retention differs: debug 182 days, release 5 years (`EventRow.cs:8,10`).

So heavy TestFlight testing consumes free-tier quota. It does not corrupt the
numbers, which is the point, but it is not free.

## 15 Pro device walk — the TestFlight clause CANNOT be pinned

`BuildKind.resolve` is fully pinned: `audit:native` compiles it with swiftc and
executes all eight compile-flag × receipt-name combinations. What no test on
this machine can produce is a **real TestFlight install**, so the premise that
TestFlight writes a receipt named `sandboxReceipt` is verified by hand or not
at all. **A green gate is not evidence for it.** This is stated in
`BuildKind.swift`'s header and in `build-kind.js`'s own output so nobody later
assumes otherwise.

Owed on the 15 Pro, before 2026.12 ships:

1. **Xcode debug build** — open the app, confirm the Aptabase dashboard's
   debug bucket receives events and the release bucket does not.
2. **TestFlight build** — install from TestFlight, confirm events still land in
   the **debug** bucket. This is the un-pinnable clause. If they land in
   release, `sandboxReceipt` is not what the receipt is called on this iOS
   version and `BuildKind.resolve` needs the real value.
3. **Release path** — cannot be exercised before App Store release. First
   real release-bucket event is the confirmation; watch for it.
4. The home-screen notice appears once on first open, both buttons dismiss it,
   and Settings → Privacy reflects the choice afterwards.

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

## LIVE MONEY BUG — the dayDefaults promotion path — **FIXED by the agreement guard** (proven reachable 2026-09-02, guard landed same day)

**Status: was OPEN and SHIPPED; now guarded.** In Best Boy mode, a date with
no `dayDefaults` entry and ONE member's individual override had that lone value
promoted into the date's department default on the next launch, stripped from
their record, and cascaded to every lean crew member on that date.

**Measured on a three-crew fixture** (Gaffer £600 / Best Boy £527 / Spark £444,
one member edited to an 05:00 call): the two crew nobody touched went
**£527.00 → £1,080.35** and **£444.00 → £910.20** — **£1,019.55 invented on a
single day** — while the edited member's own figure never moved, which is why
nobody would notice. Lunch also shifted 13:00 → 13:30 for all three (see the
second defect, below).

**Reachable through the app's OWN writers**, not just in theory:
`applyDayPresence` (ticking crew onto a date) and `applyQuickSet` (the grid's
single-field writer) both leave a date with no defaults entry — only
`setDayDefault` writes one, and that fires when a user edits a *department*
default. Both routes reproduced the table above byte-for-byte.

**Was live**: present in `v2026.11` (the archived, uploaded build) and on
`origin/main`. Introduced `9b012a5`, **13 May 2026** — every release since.
Solo productions are unaffected for money (one record, promoted value is their
own). The founder's own data could not exhibit it: **19 productions, 0
multi-crew, 32 dated days, 1 date without a defaults entry** (single-crew).

**Nothing marked it.** `getCrewVariances` requires `dayRecord.callTime` to be
present, and the collapse deletes it — so the edited member LOSES their VAR chip
and the inheriting crew never had one. Totals simply read higher.

**THE GUARD (founder-ruled 2026-09-02):** promote only when the winning value is
held by **at least two records**, or the date has **exactly one record**. Both
halves are load-bearing and are not the same test — a lone override on a
three-crew date and a solo date's only value both count one among *holders*, and
only the record count separates them. Pinned MG1–MG7 (resolved times AND day
totals, not field presence); the ordered mutation — reverting to the live rule —
reddens MG1 by exactly £1,080.35 and £910.20.

**PAST DAMAGE IS UNDETECTABLE AND UNREPAIRABLE.** After promotion and collapse
the state is `record.field === undefined` with the value in `dayDefaults[date]`,
which is **byte-identical to a day that legitimately inherited it**. No
per-field provenance is stored. Only a backup predating the promotion could show
what was lost. The guard protects future loads only.

**SECOND DEFECT on the same path — LATENT, not live (do not fold into the
guard).** The backfill falls back to the global `DEFAULT_PRODUCTION_DAY` rather
than the production's own `defaultDay`. It is currently **value-inert**: all
three creation sites seed `defaultDay: DEFAULT_PRODUCTION_DAY`, no UI writes it,
and the only editor that ever existed lived for **30 minutes** on 24 April 2026
(`c45dfb0` → `fd94fc8`) and never shipped. So the two sources are always
identical and nothing diverges. **It arms itself the day anyone adds a "set this
job's standard times" feature** — measured on a manufactured 07:00/13:00
production, the day went **£700.00 → £600.00, UNDER-claiming £100** (an hour of
OT plus a late-first-break penalty). Make the fallback fix a **precondition of
that feature**, not a fix now. Awaiting ruling.

---

*Original entry, kept for its reasoning:*

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

**Status (25 August 2026): the resolver slice is BUILT on develop** - `1a199af` (laShiftRecord + the prompt's CARD_LIFETIME_MS suppression grace), `14eb9e6` (the sweep's three lookups; the kill and the early linger dismissal close here), `a0bc751` (the descriptor + controller key; overnight re-mint and the Still-on-set restart close here). Pins NR1-NR14 + WP16-17, all negative-tested; TT7a/TT8b/TT10a moved WITH the ruling. **The stillOnSetAt bound is max(threshold, callMs + 16h) by RULING (25 Aug 2026)** - the founder confirmed the deviation from the literal "extended to": an answer meaning "keep going" must never shorten coverage. Do not "correct" it to a literal replace; NR4's fourth conjunct pins the max. Ownership and epochs are proven at synthetic midnights in the harness.

**Device verify state (27 August 2026): stages 1-4 PASSED on real hardware, stage 5 NOT RUN.** The walk + one real night proved: no midnight kill, a genuine SYSTEM-ended husk classified and dismissed by the sweep with a correct re-mint (the 03:07:35 log: `sweep.run cards=0 husks=1` → `dismissHusks n=1` → `sweep.start` with the call epoch anchored to yesterday's 18:30), and the prompt/handover behaviour. **What is NOT proven on device: stage 5, the consecutive-nights wrong-day mint.** The resolver's two-candidate selection is pinned executable (NR5, negative-tested - the running yesterday shift beats today's future record, and hands over after its bound), but no device has run the two-record case. To prove it without reconstructing anything: solo production with TWO days - the night day dated D (call 17:00, wrap 04:00) AND a second day dated D+1, same times; Diagnostics on; walk the clock to 03:00 on D+1 with the card force-ended (Web Inspector: `Capacitor.Plugins.LiveActivity.end({ immediate: false })`, then foreground within the linger). PASS = the re-minted card is YESTERDAY's shift - roughly 10h elapsed, tonight's money, and the Diagnostics `sweep.start ... call=` epoch equals D 17:00. FAIL (the old bug) = a fresh "CALL 17:00" card carrying D+1's base-day total mid-shift. After the handover (threshold passed or the prompt answered), D+1's card minting pre-call is EXISTING daytime behaviour, not the bug - the bug is only tomorrow's card appearing mid-shift.

**Observation from the verify planning (prompt reach, consecutive blocks):** the prompt's live-card suppression is per PRODUCTION (WP11, ruled). On a consecutive-nights block, the morning-after foreground mints TOMORROW's card (existing pre-call behaviour) and that card then suppresses the ask for yesterday's still-unclosed day - so on back-to-back nights the overnight ask can be shadowed by the next shift's card. Not data loss (midnight already counted the day; the record just stays unwrapped/unasked until opened by hand). Candidate fix when the prompt next gets a slice: scope the suppression to the card whose dayDate matches the day being asked about, which the descriptor's dayDate field (a0bc751) now makes expressible.

**Ingest sub-piece RULED and BUILT (25 Aug 2026):** `laEventTarget` closes both event holes - the midnight discard below AND the second finding from the same walk (native intents stamp `ev.date` as UTC-today at PRESS time, so a post-midnight press was dated the new day and misrouted). Acceptance and apply target both ride the resolver; see the entry below for the built state.

**Why the remainder stays parked:** the ingest piece writes to stored days (propose-first under the pay/stored-data rule), and the card's midnight behaviour can only be finally verified on device. The full failure mode ships in the LIVE 5.4.0 build (the plugin, the qualifies-end branch, and husk dismissal are all on origin/main), so 2026.11 inherited rather than introduced it.

## Card events — the drain-to-persist durability gap: a background press can be eaten silently

**Trigger:** any work on the LA ingest path, or the next report of a card press that "did nothing".
**The finding** (captured on device, 27 August 2026 00:11, the night-walk log + the 03:07 snapshot): the native event queue hand-over is DESTRUCTIVE (`drainPendingEvents` reads-and-clears, "handed over exactly once") and the applied-id mark persists BEFORE the productions do (`applied.add` + the APPLIED_KEY write precede `setProductions`, whose commit then feeds the debounced record persist). So the durability chain is drain → React commit → persist, with no net underneath: a process death or lost commit anywhere inside that window eats the press with `ingest.apply` already logged and the event unrecoverable - the queue is empty and the id is marked applied. Exactly this ate a card Lunch press applied at 00:11:08 from the intent's background window ("Issue C best-effort" is the documented fragility): the flag never reached state, the record never changed, no error anywhere. The ingest acceptance/targeting was verified CORRECT in the same trace - this is purely the durability seam, and it predates the resolver/ingest slice.
**Candidate fix (not built):** hold the drained batch in a native side-pocket at hand-over and clear it only when JS confirms the productions persist landed (a confirm call after the storage write); on the next drain, re-hand any unconfirmed batch - the JS `appliedEventIds` set already makes re-application idempotent, which is what makes this shape safe.
**Why parked:** stored-data path (propose-first), needs native + JS changes and an on-device kill test mid-window.

## Sick-webview intermittent — now a DATA-INTEGRITY issue, not just a white screen

**Trigger:** the next freeze/blank report, or any unexplained loss of recent edits.
**The signature** (first captured 26-27 August 2026, night-walk Diagnostics + snapshots): `plugin.load | webview booted` MID-SESSION is the tell - the WKWebView content process died and the bridge rebuilt. That night it fired twice (18:33:48, thirty seconds after day creation; 03:07:55, during the freeze the founder force-quit out of). The user-visible shape: blank screen, unresponsive UI, background/foreground does not recover, force-quit does. NOT a React render error - RootErrorBoundary exists and renders a visible dark fallback card with a message, and nothing swallows render errors silently.
**The data cost, which upgrades this from cosmetic:** (1) a background React commit can be dropped - the 00:11 card-Lunch apply logged and then never existed (see the durability entry above); (2) a record can be left DEGRADED - the 03:07:42 in-memory snapshot export showed the walk fixture's day stripped of callTime/wrapTime/lunchStartTime/lunchDurationMins while keeping date/flags/createdAt, seconds after a card minted from those very times. The only code that deletes exactly those fields is migrateDay's time-field sanitiser (built for the historical "NaN:NaN" onCallChange corruption), so either corrupt values transited the record or the exporter's ref photographed a torn, never-committed render from the dying webview. Root cause of the process deaths unestablished (a heavy single-file app on the in-browser Babel pipeline is the standing suspicion); the founder has seen the freeze "at random points before".
**Watch item riding this:** the OT-from slice (c924b94) added ~36 calcForDisplay probes per render on a NIGHT day's shoot page (deep probe + bisection + the newly-lit wrapCurve, plus the minute tick re-render). Not implicated in the captured incident, but it raises load on exactly the page where the intermittent lives. If freezes cluster on night-day pages after that build, cache the probe results per record-signature (the descriptor inputs that feed them) - that cuts the steady-state cost to near zero.

## TimeMachineIntents — current() needs a liveness filter

`current(productionId)` is `.first { productionId match }` over `Activity.activities` with NO liveness filter. When a husk and a live card coexist for one production (routine around ends and re-mints), it can return the ENDED instance, whose `Activity.update` ActivityKit silently ignores - an arm that never renders, a cosmetic update that never lands. Money is unaffected (the event queue does not ride ActivityKit). Fix when next in the intents: prefer `.active`/`.stale` instances, fall back to first.

## arm readback — the log line reports a race as a failure

The post-update readback in `arm()` can read ActivityKit's state before the awaited update propagates: the captured case logged `readback=(empty — update did not take)` at 00:11:06.551, yet the very same stamp (1787785866) was visible armed two seconds later - the update HAD taken, there was no retry, and the second tap was the confirm working as designed. Soften the line (e.g. "readback empty - update not yet visible (may be propagation lag)") so a future log does not send someone chasing a non-fault. The readback stays: a persistently-empty readback across taps is still the real ended-activity smoking gun it was built for.

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

## LIVE MONEY BUG — noOT is ignored by the weekend OT branches (found 2026-08-29, the suite's first Saturday run)

**Trigger:** the propose-first round on the CALC_DECISIONS.md open question ("noOT vs weekend overtime"), or any work in the Saturday/Sunday emit branches. **Status: OPEN, not yet ruled, engine untouched.**

**How it was found.** OTF3 (noOT card stays hidden) rode real-today; the suite's first-ever Saturday run turned it red. The weekday calc reads `crew.noOT ? 0 : …`, so weekday OT is suppressed (NOOT1-4 pin £192.20 on exactly that). The Saturday OT emit (index.html, the two `Saturday OT (${satMult}× BHR)` pushes) and the post-midnight triple emit (`OT Triple Time (after 00:00)`, both pushes) compute their rates directly from BHR and **never consult the flag**. NOOT1-4 never saw it because every fixture was dated a weekday.

**The fixture, exact — pin the fix against THIS, nothing needs re-deriving:**
Director, `bdr: 961`, `otCoef: 0`, `noOT: true`; Sat `2026-06-13` and Sun `2026-06-14`; call `08:00`, wrap `06:00` `wrapNextDay: true`, lunch `13:00`/60; `calculateDay(day, crew, {})`.

**Current figures, executed (witnessed by NOOT5-7 in calc-boundary, green by construction — they assert current behaviour):**

| | Line | Current |
|---|---|---|
| Sat | Saturday Day (1.5× BDR) | £1,441.50 |
| Sat | **Saturday OT (1.5× BHR)** 19:00-00:00, 5h × £144.15 | **£720.75 phantom** |
| Sat | **OT Triple Time (after 00:00)** 6h × £288.30 | **£1,729.80 phantom** |
| Sat | Missed 2nd Break | £48.05 |
| Sat | **Total** | **£3,940.10** |
| Sun | Sunday Shoot (2× BHR, flat) 15h | £2,883.00 |
| Sun | **OT Triple Time (after 00:00)** 6h × £288.30 | **£1,729.80 phantom** |
| Sun | Missed 2nd Break | £48.05 |
| Sun | **Total** | **£4,660.85** |

Flag on and flag off are **byte-identical** on both days (NOOT7) — the flag is simply never read on these paths.

**SHOULD figures under the recorded reading** (derived, NOT ruled — the round must confirm): suppress Saturday OT and triple; day premium/structure and break penalties stand.
- **Saturday: £1,489.55** (1,441.50 + 48.05) if the Appendix 1 blank-OT columns mean the day rate is all-in for the suppressed hours — the natural reading.
- **Sunday: two candidates the round must choose between.** If the hourly structure prices ALL worked hours once triple is suppressed: 21h × £192.20 + £48.05 = **£4,084.25**. If the flat window stays "to 00:00" and the post-midnight hours are all-in: **£2,931.05** (2,883 + 48.05).

**When ruled and built:** NOOT5/6/7 go red on purpose; rewrite them as the suppression pins against the chosen figures.

**The gate map, established by mutation (2026-08-29):** the REAL weekday suppressor is the `if (!crew.noOT) {` block (index.html ~5889) wrapping Early Call and the weekday OT emission — breaking it reddens NOOT1 and OTF3. Saturday's Early Call is separately guarded (`isEarly && !crew.noOT`, ~5761). The famous `crew.noOT ? 0 : (Number(crew.otCoef) || 1)` read (~5492) is **provably inert**: broken outright, all 1,625 assertions stay green (for a stored otCoef of 0 the `|| 1` even inverts it). Per the decoration rule the round should delete it and pin the behaviour, or make it the only mechanism — never both.

**Two more riders for the round, probed 2026-08-29:** (1) **weeknights** — a noOT Director's Wednesday night 17:00→09:00 bills 2× BHR for all 15 worked hours, flag on/off identical at £2,979.10; whether the past-minimum hours (the split's "Night OT") are "OT" under the reading is undecided. (2) The Sunday flat-window sub-question above.

## Any rate-card change — both cards must carry identical role-name sets

**Trigger:** adding, renaming or removing a role on any card in `RATE_CARDS` (so: every September uplift, and any mid-year correction).

Both cards carry the same 66 role names today (verified Phase 8: the Sept 2026 card is a BDR-only uplift of Sept 2025, same rows). Every role `<Select>` in the app is bound to `DEPARTMENTS`, which is `RATE_CARDS[0].departments` — the BASE card — while the *values* come from `roleDefaultsFor(production)`, which resolves the card by the production's start date. So a role can be **listed** from card 0 but **looked up** on a later card.

While the sets are identical that never bites, and it makes several `?? fallback` branches provably unreachable:

- `applyRoleOtProfile`'s `fallbackCoef` — three surfaces pass three different answers (the graded Phase 6 fallback, keep-existing, a flat 1.5)
- `stepUpPatch`'s `fallbackCoef` — likewise
- `autoOtCoef`'s card-less path, and the `d.bdr ?? …` rate fallbacks in every role picker

**Add a role to one card and not the other, and all of those become reachable at once** — on the same edit, with three different answers, none of them reviewed. The 2025 card is the one that matters most here: it is `RATE_CARDS[0]`, so it defines the pickable list for *every* production regardless of date.

**What to do:** when changing role names on any card, change them on all cards in the same commit, or make the picker resolve its list from the production's own card rather than the base card. If neither is possible, the three fallbacks stop being dead code and need adjudicating before the change lands — they were deliberately left per-surface (Phase 8) precisely because they were unreachable.

## Accepted cosmetic inconsistency — Lighting has both a card "Trainee" and a synthetic "Lighting Trainee"

**Ruled ACCEPTED (founder, 2026-08-27) when the eleven APA trainee roles landed. Not a bug, not to be "fixed" on sight. It only becomes live if an APA surface ever passes an APA agreement to `roleRegistryFor`.**

`roleRegistryFor(agreement)` (index.html, beside `LF_ROLE_REGISTRY`) synthesises a `"<Dept> Trainee"` entry per department at the flat `LF_TRAINEE_RATE` recommendation — £250 for APA, £150 for long form. Since the eleven card trainees landed, its `isApa` branch **suppresses that synthetic where the card already holds a role of the exact same name**:

```js
if (D[dept][`${dept} Trainee`]) continue;
```

Eleven departments are suppressed (Script Supervisor, Locations, Camera, Grip, SFX, Art Dept, Construction, Sound, Costume, Hair & Makeup, Other). **Four still synthesise: Direction & Production, Assistant Directors, Rigging — and Lighting.** The first three have no card trainee at all, which is correct. Lighting is the residue: its card role is named **`"Trainee"`**, not `"Lighting Trainee"`, so the name test misses and both survive — one real card role called "Trainee" at £250, and one synthetic called "Lighting Trainee" at £250. Same money, two names, one department.

**Why it is not fixed.** The obvious fix is renaming the card role to `"Lighting Trainee"`, and that is a **stored-data change**: saved crew records carry `role: "Trainee"`, so a rename orphans them from the card (rate and grade both lost at the next resolve) and needs a migration for a cosmetic gain. `TT20a` also anchors on that exact key, its £250 value and its carry-over comment. The founder ruled the rename out and the duplicate in.

**Why it is invisible today.** `roleRegistryFor` has exactly two consumers, `LongFormRolePicker` and `LongFormSetupWizard`, and all three render sites pass a long form agreement (`w.agreement`, `production.agreement` on a long form job, or the literal `"longform"`). **No surface passes an APA agreement**, so the `isApa` branch is reached only by the `LF22d`/`TR7` pins. Nothing renders either name.

**The trigger that makes it live:** the first APA surface that calls `roleRegistryFor` — an APA role picker rebuilt on the shared component, or a unified picker across both engines. At that moment a Lighting user sees "Trainee" and "Lighting Trainee" side by side. `TR7` does **not** catch it (the two strings differ, so there is no duplicate), which is deliberate and recorded here instead. If that day comes, resolve it as its own slice with the migration, not as a drive-by rename.

## LF22f now depends on at least one APA department having NO card trainee

**This is a dependency a future change would not obviously connect to that pin, which is the only reason it is written down.**

`LF22f` asserts, among other things, `roleRegistryFor('apa').some(r => r.trainee && r.rate === 250)` — that the APA registry still emits at least one **synthetic** trainee carrying the flat £250 recommendation. Before the eleven card trainees landed, all fifteen departments synthesised one and the assertion was unfalsifiable in practice. It is not any more.

Since the suppression guard (`if (D[dept][\`${dept} Trainee\`]) continue;`), only departments **without** a card role of that exact name still synthesise. **Four survive today:**

- **Direction & Production** — no card trainee
- **Assistant Directors** — no card trainee (Floor Runner / AD Trainee is a different name, and is pmpa)
- **Rigging** — no card trainee; deliberately excluded from the 2026-08-27 ruling
- **Lighting** — only via the naming residue above: its card role is `"Trainee"`, not `"Lighting Trainee"`, so the guard misses and the synthetic survives

**Take those four to zero and LF22f goes red.** That needs two independent things to happen, which is exactly why nobody will see it coming: adding card trainees to Direction & Production, Assistant Directors and Rigging (a plausible follow-up to the eleven — the founder ruled those three out at the time, not for ever), **and** resolving the Lighting residue by renaming its card role to `"Lighting Trainee"`. Either alone leaves the pin green. Both together empty the synthetic set and `some()` finds nothing.

The failure would read as "the long form trainee registry broke", because that is what LF22f's label is mostly about — the tv/film list divergence. It would in fact mean "the APA card has absorbed every synthetic trainee", which is arguably the *correct* end state and not a bug at all. If you reach it: the honest fix is to split LF22f, keeping the tv/film clause and retiring the APA `some()` clause with a note pointing back here — **not** re-adding a synthetic to keep a pin green.

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

## Boundary breadcrumb — approved, after the 2026.11 submission — **BUILT `08e58ed`** (2026-08-30)

**Status: DONE.** Shipped with the `bigals_last_render_error` key on the KEYS
warm list in the same commit, as the T1 rule requires. The text below is the
original ruling, kept for its reasoning.

**Ruled (founder, 2026-08-17).** `componentDidCatch` writes a
`bigals_last_render_error` record (message, component stack, APP_VERSION,
date) through the storage adapter; Settings → Help & data surfaces it as a
"Last screen error" row. Deliberately NOT before submission: it adds a
persisted `bigals_*` key, which means the adapter's KEYS warm list in the
same commit (the T1 rule) — a schema change, not a slip-in. One commit when
picked up.

## Render-smoke audit stage — the next phase, once 2026.11 is away — **BUILT `5c19819`** (2026-08-30)

**Status: DONE.** `audit:render` is gate stage 4 (jsdom + real react-dom, 5
assertions), and its acceptance criterion was met: it goes RED against the
pre-`f842101` code. The text below is the original ruling, kept for its
reasoning.

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

## J2 (fake-IDB import warm test) flaked once — async timing (2026-08-30)

During the device-review build, `J2 import: cache reflects imported
productions` and `J2 import: marker SET` failed ONCE and passed unchanged on
immediate re-run — an async-timing flake in the fake-indexeddb import warm
path, not a code change (the edits in flight touched stats copy and the
shoots-list header only). Recorded because a pin that reddens at random is a
pin people learn to re-run rather than believe, and that habit is more
dangerous than the flake. If it recurs, this note is the attach point: the
fix is likely a longer/settled await around the import in the J-suite
harness, not a loosened assertion.

## APPROVED, DEFERRED: the second LA pusher — sweep content-refresh (2026-08-31)

Founder-approved in principle alongside the ingest push seam (commit 1,
shipped) but deliberately deferred to its own round. The finding, intact:
the reconcile sweep starts, ends and converges cards but never updates the
CONTENT of an existing single qualifying card — so an app-side edit made
anywhere OTHER than the mounted day page (a crew rate in settings, a
production-level kit change) reaches the card only when the day page next
mounts (adopt-and-update). Rarer than the card-originated failures the
ingest seam closes, and the fix requires the sweep to resolve WHICH card
belongs to WHICH day — the ownership risk lives there, so it gets its own
proposal, its own properties, and its own mutation round. Sketch: a
content branch in liveActivityReconcile for a qualifying live card —
descriptor + laDescriptorSig guard (both now top-level and shared), push
on change only, never wrapped, never a husk.

## DISCLOSED LIMIT: curtail + wrap with the process terminated (2026-08-31)

A curtail committed on the card AND the wrap confirmed on the card while
the app process is COLD at both presses: no JS exists anywhere in the
window, so the wrap freezes off the pre-curtail wrapCurve and the lingering
wrapped card shows a total short by the curtailed-break line (the founder's
£28.86). DISPLAY ONLY, and bounded: the events sit in the App-Group queue,
the record self-corrects on the next foreground drain (app figures right;
only the card's ~5-minute send-off linger shows the low figure). Closing it
would need money arithmetic in Swift or push infrastructure — both against
the design discipline (the engine is the only place pay is computed). Do
not fix; this note is the disclosure.

## Call-sheet fixtures: OUTSIDE the repo, stage skips LOUDLY (ruled 2026-08-31)

The repo is PUBLIC on GitHub (history permanent - deleting never unpublishes).
Real call sheets therefore live at ~/Developer/tm-callsheets/ - outside both
checkouts - and are read in place by audit:callsheets (TM_CALLSHEET_DIR
overrides). NOTHING from that folder is ever committed: no originals, no
extracted text, no JSON - and the phase-two expectations file (real invoicing
emails + companies per sheet) lives THERE too, same rule, same reason.
.gitignore carries belt-and-braces patterns (*callsheet*, tm-callsheets/,
*.pdf with the five tracked agreement PDFs excepted - a future legit PDF
needs `git add -f` or its own !exception line).

The stage: absent/empty folder -> "⚠ CALL-SHEET FIXTURES NOT PRESENT at
<path> / stage SKIPPED" printed in-band, exit 0 (green, but a VISIBLY
different green). With sheets: per-sheet extraction stats, the CONVENTION
COVERAGE report (per lexicon: hit count + the NAMED sheets missing it - the
measurements that turn the pattern-primary design's guesses into data), and
two assertions (every sheet > 200 chars of text layer, corpus contains
"invoic" somewhere). Phase two (executing the real harvests against the
sheets via a swiftc harness, the TimeMachineTimesParser precedent, checked
against the outside-repo expectations file) waits on the pattern-primary
reader build.

## DONE (commit 3, 2026-09-01): hide-the-tutorial-card ruling closed out

The requirement line is DELETED and the reader is ungated - both landed. The
note below is kept for the reasoning; nothing in it is still owed except the
two copy items, which remain with the founder:

- **Ruling 1, the AI-off hint** on an eligible device with Apple Intelligence
  switched off: PROPOSED, not written in. Held pending wording.
- **Ruling 2, the no-invoicing-details one-liner** for a sheet like Project
  Comet where patterns find only the title: PROPOSED, not written in. Held
  pending wording, along with the scoping question (fire only when EVERY
  invoicing field is missing, not when some are).

Until both land, an iPhone 12 opening a sheet with no invoicing details sees
a screen of dashed rows with no explanation. The ungating is shippable; that
screen is the reason it is not yet user-complete.

## SUPERSEDED: hide-the-tutorial-card-on-ineligible-devices (2026-08-31)

The earlier ruling (approved-pending-copy) to hide or reword the call-sheet
tutorial card on ineligible devices is SUPERSEDED by the pattern-primary
reader: commit 3 of that sequence ungates the feature for every iPhone and
DELETES the card's requirement line ("Needs iOS 26 and Apple Intelligence."
- main's August wording) outright, because the sentence stops being true.
Do not re-apply the hide/reword option from the older note. The AI-off
hint copy and the no-invoicing-details one-liner are BOTH to be proposed
in the commit-3 round (founder rulings 1 and 2, 2026-08-31), not settled
before it.

## App Store Connect edits owed at the 2026.12 submission (founder-worded)

Neither can be made from the repo. Both travel in the same submission.

**Reader line.** Replace `Requires a supported iPhone (iPhone 15 Pro and
later)` - false from commit 3 - with:

> Reads call sheets on any iPhone. On iPhone 15 Pro and later, Apple
> Intelligence helps with unusual layouts.

**Analytics line.** Add to the description:

> No account, no tracking, no servers. Your shoots stay on your phone. The app
> sends a few anonymous milestones about which features get used, and you can
> switch that off in Settings.

The names/money/dates detail deliberately stays OFF the listing - it lives on
the privacy page, which the listing links to.

**Nutrition label** (App Privacy section, separate from the description): add
Product Interaction, "not linked to you", "not used for tracking", purpose
Analytics - matching `PrivacyInfo.xcprivacy`. A binary that posts events under
a label that says it collects nothing is a rejection.

## The expectations file: what the founder is reviewing, and how (commit 4)

Phase two of the call-sheet audit asserts the harvest against a file only the
founder can write, because only he knows what each sheet actually says.

**Where.** `~/Developer/tm-callsheets/expected.draft.txt` - outside the repo,
beside the PDFs. It is **rewritten on every gate run**, so do not edit it in
place: the next run would wipe the corrections.

**What to do.**
1. Copy `expected.draft.txt` to `expected.txt` in the same folder. The gate
   never writes `expected.txt`; it is yours.
2. Open `expected.txt`. There are **20 blocks**, one per sheet, each with six
   lines: `title`, `company`, `job ref`, `invoice email`, `cc email`,
   `postcode`, then a `notes` line.
3. For each block, open the matching PDF and check the six lines against
   what is printed on the sheet:
   - **88 lines already have a value** - confirm each is right, or correct it.
   - **14 lines are blank** (6 company, 4 invoice email, 4 postcode) - the
     harvest found nothing. Type the value from the sheet, or leave it blank
     if the sheet genuinely has none.
   - **18 lines say `(none)`** (4 job ref, 14 cc email) - confirm the sheet
     really has no such thing, or replace with the value.
4. When a block is checked, change its `notes` line to anything that does not
   begin with the word `draft` - `notes: checked` is enough. **A block whose
   notes still begin `draft` is skipped, not asserted**, so you can do this a
   few sheets at a time and the gate will only hold you to what you have
   confirmed. It prints how many are still unreviewed on every run.
5. Postcodes: spacing and case do not matter. Emails: case does not matter.
   Company and title: they must match the sheet exactly, including case.

**What happens then.** The gate asserts every reviewed block. A mismatch turns
the stage RED, names the sheet and the field, and shows the expected and found
values with emails and numbers masked. That is the moment a harvest rule gets
a real correction from a real sheet - which is the whole point of the file.

## Device walk owed for the ungated reader (commit 3, before 2026.12 ships)

Run the SIMULATOR pass first - it needs no phone, has no Apple Intelligence,
and therefore exercises exactly the pattern-only path the iPhone 12 will take.
If the reader is broken there, both phones will show it too.

**Simulator (any iPhone sim, no Apple Intelligence).** Share each corpus sheet
in. Expect: the Import button VISIBLE (it used to be replaced by a "turn on
Apple Intelligence" line), extraction runs and returns, no reject. Title,
prodCo, jobReference, invoicing email and address filled from patterns where
the corpus measurements say they should be. Any crash or reject here is a
commit-3 defect, not a device quirk.

**iPhone 12 - the device this redesign exists for.** Per sheet, from the
harvest measurements:

| sheet | expect |
|---|---|
| Gymshark Winter Womens | prodCo "Uncovered Group" (payee line), address with SW8 1DF, invoicing email found |
| Nettwerk / TENDER | prodCo "SASHA HADLEY STUDIO LTD", job ref SHS_NET1 |
| Teepee x Threebrand | prodCo "TEEPEE FILMS", job ref "CMK AW26" |
| TDA176 Everlast Palm Angels | job ref TDA176; prodCo NOT found, address NOT found - dashed rows are CORRECT here |
| Project Comet | title only. Every invoicing row dashed. THIS is the sheet ruling 2's one-liner exists for |
| InRehearsal / The Visuals Team | address NOT found (known limitation, already recorded) |

The four ADDRESS-MISSES above are expected misses, not regressions - reach is
16/20 and that was the measured gate for commit 2.

**iPhone 15 Pro - confirming nothing regressed.** Open the same sheets and
compare against what it produced before this commit: every VERIFIED value,
its crop, and its page number must be identical. The promise is byte-identity
wherever the model produced a verified value, and it is mechanically proven at
source level (the extracted model loop is character-identical to the loop it
replaced, and all 8,635 characters downstream of it are untouched) - the
device pass is confirming that the proof holds in the field, not discovering
whether it does.

Also on the 15 Pro: turn Apple Intelligence OFF in Settings and re-run one
sheet. It must still read, and the ruling-1 hint must appear under the Import
button ("Apple Intelligence is off. The reader works without it and reads most
sheets the same way."). It must NOT appear on the 12 or the simulator - they
have nothing to switch on.

On EVERY device, Project Comet must show the ruling-2 line above the dashed
rows ("This sheet doesn't carry invoicing details. Plenty don't - tap any row
to fill it in yourself."), and a sheet that found even one invoicing field
must NOT show it.

## Pattern-primary commit gate: ADDRESS-REACH measured 16/20 (2026-08-31)

Commit 1's harness measures the address block∩postcode reach on the real
corpus (ruled: this gates commit 2). Result: 16/20 - in line with the
other anchors (job-ref 16/20, prodCo ~16/20 effective, emails ~18/20),
NOT materially below. Named misses: InRehearsal (pattern-DARK on the
PDFKit text layer - its glyph damage deletes text rather than
substituting; Vision OCR never runs because the layer is big enough),
Forever Living (no address printed), Project Comet (no invoicing content
at all), Everlast (F.A.O person-addressee, no postal block). The
InRehearsal finding is the PDFKit-extraction discovery: two sheets that
LOOKED readable under pdfjs read differently under the device's own
decoder family - which is exactly why the harness now extracts via
PDFKit.

## KNOWN LIMITATION: InRehearsal-class sheets - big text layer, no structure (2026-08-31)

Measured, not theorised: the InRehearsal call sheet's text layer decodes
WORSE under PDFKit (the device's own decoder) than under pdfjs - its font
damage DELETES characters rather than substituting them (3,887 vs 4,628
chars), the invoicing section does not survive, and every harvest and the
email/title paths come back empty. Vision OCR never rescues it in the app
because loadPages trusts any text layer over 40 chars/page - the layer is
BIG, just wrong. It is therefore a Comet-class sheet on-device (review
sheet shows title-at-best plus dashed rows), for a different reason than
Comet (which genuinely has no invoicing content).

DETECTION - CORRECTED 2026-09-02. The cross-check proposed here ("Vision's
text much larger than the layer's") DOES NOT WORK and would waste an
afternoon: measured on the corpus, InRehearsal's page-1 OCR-to-layer
character ratio is **1.13**, indistinguishable from a clean sheet (the
range across all 20 is 0.82-1.13). The damage deletes the characters that
matter, not many characters. What replaced it is the FIELD-BASED trigger
now built into run(): a text layer is present AND company or postcode came
back missing -> OCR page 1 plus the invoicing pages and fill only those two
fields. That recovers InRehearsal's postcode and company (the OCR reads
"Production Company:" over "The Visuals Team"); its title is still the
truncated layer value, because the fallback never replaces a found value.

## ON THE RECORD: forced dark mode overrides a light-mode preference (2026-08-31)

UIUserInterfaceStyle=Dark (Info.plist) + color-scheme:dark (index.html meta
+ :root CSS) deliberately override a user's system light-mode preference.
This is not an oversight to reopen: the app has no light theme, and the
alternative - what light-mode users actually got - was light native chrome
(glass pill clusters, default tab-bar material) against dark content, which
is worse for legibility than consistent dark. System accessibility features
(Smart Invert, Increase Contrast, Reduce Transparency, Dynamic Type) are
unaffected and still apply. The Live Activity is untouched and correctly
so: fixed hex palette, system-owned lock-screen material, and widget
processes ignore UIUserInterfaceStyle anyway - the widget extension must
NOT gain the key. All three declarations are pinned (DM1-DM3).

## RELEASE-TIME VERIFICATION OWED — fetch the live site after the /app/ build change (2026-09-02)

**Trigger: the next merge to `main` and push (nothing in this change deploys —
it sits on `develop`).**

The web app now publishes the BUILT artifact (`dist/`) rather than the raw
`index.html`, which removed four third-party script loads (unpkg.com ×3,
cdn.tailwindcss.com). Verified LOCALLY: `dist-web/` built clean, served over
`python3 -m http.server`, the app rendered its onboarding wizard and what's-new
deck with **no console errors**, and the network panel showed **five requests,
all same-origin, zero external hosts**.

**What local verification cannot prove**, and what must be done at release:
fetch `https://timemachineapp.co.uk/app/` after the deploy and confirm (a) it
returns the 44KB built shell, not the 2.27MB source, (b) `app/assets/app.js`,
`app/assets/tailwind.css` and both `app/vendor/*.js` resolve 200, (c) the
network panel shows zero external hosts, and (d) the app actually runs. The
27 August lesson stands: a local build passing is not the same as the site
working, and Netlify now runs `npm run build` before publishing — a step that
has never run on their infrastructure.

## audit:web clause 7 (outbound network) — ITS TWO LIMITS, recorded (2026-09-02)

The clause spies six APIs — `fetch`, `XMLHttpRequest`, `sendBeacon`,
`WebSocket`, `EventSource` and `Image` (the last because `new Image().src`
is the beacon that evades the other five) — and fails naming the HOSTNAME
LIST and the API used, e.g. `["us.aptabase.com via fetch"]`. Proven against
all six by mutation, and proven NOT to red on same-origin fetches
(`./assets/tailwind.css`, `/assets/app.js`, own-host absolute), which is the
deliberate external-hostnames-only decision: a false red on the print
stylesheet would teach people to loosen the clause.

**Limit 1 — it sees BOOT ONLY.** The bundle is evaluated and settled, then the
list is asserted. A request fired later by a user action — which is exactly
what analytics would be — is outside its reach. Covering that needs the
`IS_NATIVE` gate plus a source-level clause asserting no analytics module is
reachable on the web path; do not assume clause 7 does it.

**Limit 2 — it cannot see static HTML.** It is a runtime check over
`dist/assets/app.js`; a `<script src="https://…">` in a published page's head
is invisible to it. That is `audit:publish`'s job (gate stage 7), and the
division is deliberate: four CDN loads shipped for months precisely because
the only web check was a runtime one.
