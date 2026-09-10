# TimeMachine - handover

The document to read cold. It points; it does not duplicate. **Where this file
and the repo disagree, the repo wins** - verify against the code before acting on
anything here. Written on 10 September 2026 from the repo and the log, after
2026.12 went live on the App Store and on the website. Every hash below is on
`main` unless it says otherwise; `develop` is level with `main`.

`CLAUDE.md` holds the operating rules and is loaded automatically. This file is
the state, the method, the map and the traps.

## What the app is

TimeMachine is a pay and timesheet calculator for UK film and TV crew: you enter
call, lunch and wrap, and it works out what the day pays under the relevant
agreement, then turns that into timesheets and invoices. It runs two independent
pay engines - **APA** (commercials, the mature one) and **Pact/Bectu long form**
(scripted TV and film, newer) - chosen per production and fixed for that job's
life. The source is a single self-contained `index.html` (React 18 + Tailwind,
in-browser Babel when opened raw). The website publishes the BUILT app from
`dist/` under `/app/` (vendored React, no external subresource), deployed to
timemachineapp.co.uk by Netlify from `main`; the iOS app is the same build
wrapped by Capacitor, with the native side in `ios/App/App/*.swift` and a widget
extension for the Live Activity.

## Where the release stands

**2026.12 is live on both sides.** The App Store build 2026.12 (12), built from
`develop` at `751c7ba` (the deck fix), was approved and went live on 10 September
2026. The website has served 2026.12 since 9 September: `main` carries the
release merge `942ab0f` ("Merge branch 'develop' into main: 2026.12", parents
`b649d5f` and `751c7ba`), **tagged `v2026.12`** on that merge commit (the
previous tag, `v2026.11`, sits on the archived develop commit `ab583a8`; the
founder ruled the merge commit this time). 167 commits lie between the two tags.

**The close-out on 10 September, on Apple's approval:** `home-preview.html`'s
`softwareVersion` moved to 2026.12 (`70048fd`); `develop` was merged into `main`
as `3068d80` ("Merge branch 'develop' into main: 2026.12 close-out", parents
`70048fd` and `e482492`), gated on the merged tree, pushed and verified live by
fetching: the homepage serving 2026.12 and every published file byte-identical
to the local publish set, 39 seconds after the push; the records commit
`ea5cd1b` followed and left the site byte-identical. `APP_VERSION` and
`WHATS_NEW_VERSION` read 2026.12, `TUTORIAL_VERSION` stays 2,
`CURRENT_PROJECT_VERSION` is 12 and `MARKETING_VERSION` 2026.12 at every project
line, app and widget. Nothing is unreleased on the web. After this document's
own commit, `main` and `develop` are level and ahead of `origin/main` by this
document alone (nothing is pushed except a release merge on request).

**One thing the App Store build does not carry.** The close-out merge took
`e482492` to the web: turnaround measured to the pre-call, TOC only (ruled
10 September, `CALC_DECISIONS.md`). Build 12 was archived before it, so the
phone measures turnaround to the unit call until the next store build, while the
web app measures it to the pre-call now. It reaches the phone with 2026.13 and
belongs in that changelog section; the what's-new deck does not change for it.

**How the web deploys and how you prove it.** Netlify builds `main` with
`npm run build && node scripts/build-web.js` (proven on the 2026.12 deploy, the
first time its build step ever ran) and publishes `dist-web/`, a fail-closed
allow-list of 51 files with zero external subresources. There is no Netlify CLI,
token or browser session on this Mac: the live site changing is the only deploy
signal, and it changes within a minute of the push. Verify by fetching, byte for
byte against a fresh `dist-web/` (`node scripts/build-web.js`), never by
assuming; a failed Netlify build leaves the previous deploy live rather than
breaking the site. App Store Connect edits for 2026.12 are done (founder).

### What shipped in 2026.12, by feature

Read `CHANGELOG.md`'s 2026.12 section for the release voice; the log for the
hashes. In the order the changelog groups them:

- **The call sheet reader works on every iPhone.** Ungated from Apple
  Intelligence; patterns run everywhere, the model folds in where it exists,
  bounded to 12 seconds and three pages. Then the three context gates the device
  taught us: email (`0a739e4`), reference (`6903e73`), company (`4510f55`), and
  the label fixes from the first live sheet (`7f14a2a`), with the reader's own
  `reader.field` ring lines naming every field's source.
- **Your earnings, clearer** - the stats money round; the headline is the sum
  of the month rows, pinned executable under each basis.
- **Buyouts** - one figure, the day-by-day record on the second page.
- **Timesheets worth sending** - the shared text timesheet with golden fixtures.
- **The lock screen keeps up** - the Live Activity ingest seam, the card as
  witness (mismatch detector + Apply), the resolved-day fixes to the detector
  and the descriptor (`4a27417`, `e5664ea`), the night-wrap intent (`7fc5cee`).
- **Steps that stick around** - the Legwork rollup that survives a new phone
  (`170cb0b`); access-off inferred from a zero year (`df8727e`).
- **Anonymous usage milestones** - Aptabase, opt-out with its own notice;
  deliberately absent from the what's-new deck (pinned `DK9`, recorded).
- **What's new, redesigned** - the deck (`AnnouncementDeck`, `WHATS_NEW_PAGES`),
  three heroes then the list; rendered by the gate since `751c7ba`.
- **Dark mode everywhere**; **a crew rate fix** (the dayDefaults agreement
  guard, `9be7ae5`); **saved means saved** (the record is an atomic file,
  `c998575`).
- **Reliability** - no native dialogs (`c19e324`), share-in closes the app-level
  screens (`03abd0e`), one door out of the chooser and the Inbox cleared
  (`6903e73`), no synchronous system call on the main thread (`b221db5`), the app
  holds background time for its backgrounding work with lifecycle ring lines and
  the iCloud cancel timers (`99886da`).
- **A faster website** - the built app published from `dist/`, the fail-closed
  allow-list, zero external subresources (`c21c8aa` and its siblings).
- **Share diagnostics** - the long-press export and the Siri intent, the
  always-on ring lines; a support tool that earned its place in the notes.

## 2026.13 is Capacitor 8.5 alone - founder-ruled, propose-first

Nothing else goes in. It changes how the app starts up, the layer with this
project's worst history, and it unblocks Xcode 27; shipped isolated, an
unexplained fault afterwards has one candidate. Propose first; device walk
afterwards on share links, the share sheet, the call sheet reader and PDF export.
One thing is already in the tree ahead of it and cannot be kept out: turnaround
measured to the pre-call (`e482492`), on the web since the close-out merge; the
2026.13 store build carries it, and its changelog section names it.

**Where we are - the version inventory, from `package-lock.json` and
`ios/App/CapApp-SPM/Package.swift`, re-read on 10 September:**

| Package | Version |
|---|---|
| `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli` | 8.3.4 (the SPM manifest pins `capacitor-swift-pm` exact 8.3.4) |
| `@capacitor/app` | 8.1.0 |
| `@capacitor/browser` | 8.0.3 |
| `@capacitor/filesystem` | 8.1.2 |
| `@capacitor/haptics` | 8.0.2 |
| `@capacitor/local-notifications` | 8.2.0 |
| `@capacitor/preferences` | 8.0.1 |
| `@capacitor/share` | 8.0.1 |
| `@capacitor/status-bar` | 8.0.2 |
| `capacitor-email-composer` (EinfachHans, the one third-party plugin) | 8.0.0; last release 16 January 2026, not archived, six open issues |
| `@capacitor/assets` (dev), `@capacitor/synapse` (transitive) | 3.0.5, 1.0.4 |

**No Cordova plugins** (zero in the lock); the SPM manifest links the runtime's
`Cordova` product only because the template does. Deployment target iOS 15.0
for the app, 16.2 for the widget; `SWIFT_VERSION` 5.0; `@UIApplicationMain` on
the app delegate; the root view controller comes from `Main.storyboard`
(`UIMainStoryboardFile`, no scene manifest in `Info.plist`), custom class
`MainViewController`, which registers all eleven app-embedded plugins in
`capacitorDidLoad` and owns the native chrome, the termination shim, the
diagnostics gesture and the lifecycle plugin. This Mac runs Xcode 26.6.

**What 8.5 changes (read from the published `@capacitor/ios@8.5.1` and
`@capacitor/cli@8.5.1`, not from memory):** UIScene support - a
`SceneDelegateProxy` that receives `scene(_:willConnectTo:)`,
`scene(_:openURLContexts:)` and `scene(_:continue:)`, mirrors the URL into
`ApplicationDelegateProxy.lastURL` so `getLaunchUrl()` keeps working, posts the
same `capacitorOpenURL` / `capacitorOpenUniversalLink` notifications the App
plugin already listens to, and **defers a cold-launch URL until the bridge view
controller's first `viewDidAppear`** (ours calls `super`, so the post fires). The
bridge's `pause` / `resume` document events move to `UIScene` notifications;
`UIApplication` notifications still post, so `AppLifecyclePlugin`'s background
task and lifecycle lines and the App plugin's `appStateChange` are untouched.
`npx cap migrate` (the CLI's `migrate-uiscene` task) adds
`UIApplicationSceneManifest` to Info.plist (with `UISceneStoryboardFile: Main`;
it does not remove `UIMainStoryboardFile`), writes the template
`SceneDelegate.swift`, patches `AppDelegate.swift` with
`configurationForConnecting`, registers the file in the pbxproj, and **warns**
about our custom `open url:` and `continue userActivity:` handlers.

**THE SINGLE MOST IMPORTANT FACT IN THIS SECTION.** The migrator's template
SceneDelegate builds a new window with a plain `CAPBridgeViewController()`, not
our `MainViewController` subclass. Left as written, the app boots with none of
our plugins registered and no chrome: no share-in, no Live Activity, no
diagnostics, no lifecycle plugin, no native bars. The generated file must
instantiate `MainViewController` (or keep the storyboard's controller), and a
native-audit pin must say so before the round is called done.

**The risk list, ranked, after that one:**
1. Share-in from Files and Mail at cold launch: URL delivery now arrives after
   `viewDidAppear`; the handler reads `getLaunchUrl()` and listens for
   `appUrlOpen`, deduped, so both orders should work - device-only proof.
2. Share links: universal links now arrive via the scene `continue` path.
3. The two app-delegate handlers (`open url:`, `continue userActivity:`) going
   silently dead once scenes own delivery - drop them or forward them, and pin
   that none is left behind.
4. A Live Activity button press launching the app in the background under
   scenes: no scene connects, so the webview may not boot - the intent already
   treats a cold process as "leave it for foreground".
5. The chrome's layout under a programmatic window instead of the storyboard's.

**What the gate cannot cover, and what is device-only.** None of the scene
delegate runs in the storage sandbox or the render smoke, and Xcode proves only
that it compiles. The simulator can exercise cold launch, a file shared from its
Files app, and a universal link via `simctl openurl`. Device-only: the share
sheet from Mail and Files on a real phone, the lock-screen Live Activity press,
PDF export through the print pipeline, the background task's expiry, Health, and
the receipts.

**Xcode 27, answered.** Apple's requirement is tied to the SDK you build with:
an app built against the iOS 27 SDK without a scene manifest does not launch.
8.5 is what the vendor shipped for exactly that ("a breaking minor rather than
waiting for Capacitor 9"), so **8.5 genuinely unblocks Xcode 27**; our Swift 5
language mode keeps `@UIApplicationMain` compiling there. **Capacitor 9** is at
`9.0.0-alpha.6` (14 July), GA forecast for the end of November 2026, requiring
**iOS 16.0, Xcode 27 with Swift 6, `@main`, Node 24**, and dropping the Cordova
runtime product from `Package.swift`. 9 is a later round with its own iOS floor
decision, not part of 2026.13.

**The three-stop sequence, and what must be proven before each stop is passed:**
1. **Bump to 8.5.1 without migrating** - the delegate-based app still works on
   8.5. Proof before passing stop one: gate GREEN, Xcode `BUILD SUCCEEDED`
   genuinely (see the method), a device smoke of launch, share-in and the Live
   Activity. This proves the runtime alone changes nothing.
2. **Run the migrator, then hand-edit** the SceneDelegate to `MainViewController`,
   drop or forward the dead app-delegate handlers, add the pins (the
   SceneDelegate instantiates our controller; the manifest names it; no handler
   left behind). Proof before passing stop two: gate GREEN with the new pins
   mutated, Xcode green, the simulator walk (cold launch, a file from Files,
   `simctl openurl` for a share link).
3. **The device walk** on the four named surfaces (share links, the share sheet,
   the call sheet reader, PDF export) plus the lock-screen press and the ring's
   lifecycle lines. Proof before passing stop three: every one seen on the phone,
   then the ship step. Each point needs its proof before the next.

## 2026.14 carries everything else, with Wrapped

**Wrapped has a fixed date, 19 December** (founder), and it is the only dated
item on the list: the aggregation layer must be capturing weeks before then or
the figures will not exist. What exists today: `WRAPPED_DATA_AUDIT.md` (phase 0,
`70264da`), three additive day fields captured since 20 August (`createdAt`,
`wrappedAt`, `source`, `feb3ecd`, "nothing reads them yet"), the wrapped flag on
days, and the Legwork rollup that survives a new phone (`170cb0b`). No weekly
money aggregation exists; the stats aggregation is per-screen. The audit's own
warnings stand: bound the year at `min(31 December, today)`, and never propose a
per-day HealthKit maximum (365 queries; `MAINTENANCE.md`).

**The queue, each with what it is and why it matters:**

- **The 336-key raw-read ledger.** What it is: an audit stage that lists every
  read of the five cascade fields (`callTime`, `wrapTime`, `lunchStartTime`,
  `lunchDurationMins`, `dayType`) and classifies it as resolved, explicit by
  construction, or raw by design. Why it matters: the load pass collapses those
  fields into day defaults, so a reader that takes the raw record instead of
  `resolveDay` sees nothing where the resolved value lives. Five such defects
  were fixed in one week in September (the Live Activity detector, the card
  descriptor and the night-wrap intent among them), and three approved display
  gates are still parked in `MAINTENANCE.md` ("Raw day-record gates", one commit,
  one device walk). The founder's count of the reads is 336. Proposed, not
  built; a sixth instance should redden the gate, not a device.
- **The invoicing address context gate.** What it is: the last of the three
  reader fields to get a context gate; the model's address is verified today
  when its span carries a UK postcode, which is shape, not intent - the shoot
  location has a postcode too, and a verified model value is never displaced.
  Why it matters: the same mechanism shipped the page-1 brand as the company on
  14 of 20 sheets before the company gate. Same fix shape as email, reference and
  company: presence must sit where the field belongs (an anchored invoicing
  block or a payee phrase). Propose-first with a corpus measurement; the Mac's
  copy of the model and the replay tooling are in the prodCo record.
- **The iCloud coordination timeouts, the remainder.** What it is: the 5
  September record proposed six parts; `99886da` built the cancel timer on every
  coordination, the cached container URL, the `icloud.timeout` line and the
  structural pin. Still open: coalesced pending writes (one in flight per
  filename), the flag-gated `icloud.slow` line, and the Settings backup row
  timing its "checking" state out to "iCloud not responding". Why it matters: a
  stuck coordination holds the plugin's own queue until process death, the daily
  snapshot silently never lands, and every later backgrounding queues another
  attempt behind it. Nothing else is lost.
- **The Forever Living harness fidelity gap.** What it is: the corpus harness's
  OCR mirror runs with language correction off and top-left ordering; the
  plugin's OCR runs with correction on and mid-line bands. On that sheet the
  harness finds the company and the plugin's settings find nothing. Why it
  matters: the phase-two green on that sheet is harness-only, and a green the
  device would not reproduce is worse than a red. Its own round: align the
  mirror with the plugin (the device is the truth), re-ratchet, device-walk the
  sheet. Until then read the phase-two count as "green on the Mac's OCR settings".
- **The long-form chip precedence.** What it is: the long-form day editor's lunch
  chip chain runs CURTAILED before LATE (single slot), the opposite of the solo
  editor, which since `c04f685` renders both chips and both banners. Why it
  matters: the two editors disagree on the same lunch. The ruling is the same
  one - both when both hold - and the record says it is for this round.
- **The error boundary's hardcoded colours.** What it is: `RootErrorBoundary`
  renders above the themed tree with inline hex (near-black ground, a sky button
  on black) and reads no theme token. Why it matters: in poppy mode the accent
  is wrong, and it is the screen a user sees when the app has already failed.
  Paint it from the tokens, or keep it deliberately theme-free and say so.
- **The open calc question on a very-late and curtailed lunch.** What it is:
  whether a lunch that starts after call + 6.5h AND is shorter than 60 minutes
  receives both the CWD treatment (overtime from 9h) and the curtail treatment.
  Why it matters: money, on a shape the founder's own 4 September day had; the
  display treats CWD as exclusive, the engine may bill both. `CALC_DECISIONS.md`,
  OPEN; an executed fixture at the engine level and a pin either way.
- **The Best Boy Excel export.** What it is: alongside the PDF, a more technical
  spreadsheet of a whole unit's times and money. Why it matters: it is what a
  production accountant asks for, and probably the largest item on the list.
  A new feature, propose-first; the money enumerator behind the stats surfaces
  and the invoice snapshots are the sources; every figure must come from the
  same place the PDF's do.
- **The pre-call data entry fault - leading hypothesis: it saved and was
  silently ignored.** What it is: the founder hit a case where entering a
  pre-call would not save; not reproduced. The TOC round (10 September) found
  the other side of it: the engine ignores a pre-call that sits after the call
  when the implied overnight window exceeds 12 hours, pushes a note saying so
  ("Pre-call appears to be after main call - ignored"), and **nothing in the app
  renders the engine's notes** - no reader of `meta.notes` exists. So a pre-call
  entered after the call saves, pays nothing, shows nothing, and looks exactly
  like a pre-call that did not save; the founder's own data holds one such
  record (8 May 2026, call 06:30, pre-call 11:50). Why it matters: a user is
  told nothing about a value the engine has discarded, for pay and now for
  turnaround alike. Test this first: enter a pre-call later than the call on a
  test day, confirm the record holds it after a relaunch, confirm the breakdown
  shows no pre-call line and no signal. If it holds, the fix is a visible line
  beside the pre-call field whenever the pay block ignores the value. Only if a
  pre-call BEFORE the call fails to hold is the fault in the entry path:
  `preCallTime` is not one of the five cascade fields; it belongs to the extras
  family, backfilled onto every `dayDefaults` entry by the load pass and
  compared against `defaults.preCallTime` for the variance chips; the entry
  sites are the solo editor's `TimeInput`, the date edit, the department default
  and the day record's time input. Report before proposing either way.
- **The tutorial adopting the new card component.** What it is: the what's-new
  deck and the tutorial share one chassis since `0f4c83e` (one way out, bar
  dots, hero tiles), but the tutorial adopted the chassis only - its six cards
  and their illustrations are untouched, and its copy is its own round. Why it
  matters: two surfaces that look like siblings and are not, and the tutorial is
  the first thing a new user sees. The deck's own device round (`bd776d2`,
  `681118a`) is the model; `TUTORIAL_VERSION` moves only if the copy changes.

**Smaller items still in the ledgers** (read the entries before acting): the
three approved raw-`dayType` display gates above; the marketing rate-label
markers on `welcome.html` and `how-it-works.html`; softening the
Greggs/Leatherman comparators; the Live Activity's single staleDate slot; the
second LA pusher (approved, deferred); the derived day links' two failure modes.
Done: Google reindexing. Ruled out: Bing.

## Open rulings, from `CALC_DECISIONS.md` and the ledger

Read the entries before re-litigating anything. Every status word below is the
ledger's own.

- **noOT vs weekend overtime (§4.4, §4.6) - OPEN, NOT YET RULED** (reading
  recorded 29 August). The weekday path reads `crew.noOT`; the Saturday OT and
  post-midnight triple emits never consult it. Live money: `MAINTENANCE.md`
  "LIVE MONEY BUG - noOT is ignored by the weekend OT branches" holds the exact
  fixture (a noOT Director at £961, Saturday and Sunday, call 08:00, wrap 06:00
  next day) with current and should figures; NOOT5-7 assert the current
  behaviour by construction and go red on purpose when the fix lands. The oldest
  open item and live money.
- **A very-late AND curtailed lunch - OPEN, NOT YET RULED** (surfaced
  4 September). Above, in the queue.
- **The standalone-invoice bucket row.** The month-attribution rulings say a
  standalone invoice counts as money billed and its top company is the payee,
  ruled yes on both wrinkles but **unexercised by real data** (the founder's
  records hold zero standalone invoices), so the MB9/MB10 fixtures carry more
  weight than usual; a standalone month still has no bucket row of its own.
  Ledger: "Month attribution - Option A".
- **Hourly Bectu card rates cannot fill the wizard's rate field - RULING
  NEEDED** (`MAINTENANCE.md`). Which number an hourly rate multiplies by (the
  agreement class's contracted hours, or something the deal memo implies);
  109 of the registry's roles carry an hourly figure, so it is the majority of
  the card, not a corner. Propose-first, nothing before a ruling.
- **Equipment-hire base-to-base exclusion (clause 3.1) - DEFERRED, RECORDED.**
  The September 2026 terms exclude base-to-base for equipment hired from the
  crew member and give no replacement formula; the ledger's instruction is "do
  not invent one".
- **The dayDefaults backfill-and-collapse migration - open question**
  (`MAINTENANCE.md`): the every-load hydration promotes a single explicit crew
  value into the date default; deliberately untouched by the highlight fix.
- **Carried, unchanged:** D5 enforcement, the dayDefaults fallback to the global
  default (latent), and the flat penalty lines that carry no rate so their
  working cannot be shown. `B6` and `B8` in the ledger are recorded tripwires,
  not open rulings.

## Unverified, and to be said plainly

Each of these is unverified, not done. Nothing on this list has a pin that can
stand in for the observation.

- **The first release-bucket analytics event.** Nothing can exercise the release
  path before a real App Store install; the first real event in the RELEASE
  bucket is the only proof the release path works. 2026.12 is live, so it is
  due now. Read the dashboard as `count()` over the period, never unique users.
  If `BuildInfo.kind()` is wrong, every real user lands in the debug bucket and
  the release bucket stays empty.
- **The TestFlight debug bucket.** That a TestFlight install writes a receipt
  named `sandboxReceipt` cannot be pinned; `BuildKind.resolve` is executed for
  every combination, and the premise is verified by hand or not at all. It
  cannot be tried until a TestFlight build exists.
- **The install marker across a real restore.** Proven by fixture only; the one
  device test was a false negative (a stale Capacitor copy restoring a snapshot
  that predated the fields, `7d6265c`). If wrong, every new phone re-fires every
  milestone.
- **The dead-controls fault.** The one code-backed hours-long freeze (the JS
  thread parked in a synchronous dialog iOS refused) was removed in `c19e324`,
  and the 4 September watchdog file (a blocked process at graceful termination)
  led to the main-thread and background-task work in `b221db5` and `99886da`.
  Plausible, unproven: no occurrence has been observed since, and the record
  says so in its own words ("Not proven to be the cause"). The discriminating
  observations for the next one are in `MAINTENANCE.md`: does a clock tick, does
  the page scroll, does a web control respond, does a picker open, do the bars
  respond; and the ring's `nav.native`, `render.*`, `lifecycle.*` and
  `webview.TERMINATED` lines.
- **Turnaround to the pre-call on hardware.** Money, ruled and built on
  10 September, pinned (TP1-TP12), gated, on the web, never on a phone and not
  in build 12. The walk: a night followed by a pre-call day, the breakdown row
  and the invoice's day section reading "to HH:MM pre-call", the Best Boy grid's
  TOC chip on the member with the pre-call only.
- **The trainee walk across nine surfaces.** The eleven APA trainee roles
  shipped in 2026.11 and have never been walked; the founder counts nine
  surfaces: the `roleRegistryFor` call sites feeding the crew editors, the
  wizard and the pickers (the source holds two call sites today, at the crew
  editor and the wizard, where the earlier count said three), plus the rate
  displays reading `ROLE_DEFAULTS`.
- **The 2026.12 body on the phone.** It shipped without the walk the records
  name: the reader on Gymshark with Apple Intelligence on (no reference), the
  live sheet reading DADBOD LTD with six `reader.field` lines, a burst of taps
  then a ring export in order, background then export showing
  `lifecycle.background` / `.done` / `foreground` with the summary, the same
  sheet shared twice into a warm app, Health access off with a counted day, the
  night-wrap edit, the kill-test day's two chips and banners.
- **Smaller, still owed:** the light-mode chrome check on the iPhone 12; the
  Live Activity discard-on-midnight fix (fixed by ruling, device verify
  pending); Forever Living on the device (the fidelity gap above); the 5
  September reloads are NOT on this list - they were ordinary reclaims of a
  suspended app, no crash files, recorded and corrected.

## The working method

- **Propose first, build second** on anything touching money (the calc engine,
  a breakdown, an invoice), stored data (the schema, a migration), native code,
  or a frozen record (a sent invoice). Investigate, show the current logic,
  propose, wait for the ruling. No silent edits to the pay engine. Ambiguity gets
  claimed and flagged, never silently under-claimed. "Report only" rounds edit
  nothing.
- **The eight-stage gate.** `npm run gate` runs build, audit:build (the
  source-versus-built compare, the textual diff, and every executed pin file:
  calc boundary, kit, share link, LA ordering, variance, quick set, day off, day
  presence, theme parity, construction), audit:storage (the storage sandbox,
  1,796 assertions), audit:render (the real DOM smoke through react-dom),
  audit:web (no native or PDF libraries in the web build, no outbound network),
  audit:native (swiftc-compiled Swift pins plus the main-thread and lifecycle
  stages), audit:callsheets (the real sheets, outside the repo; skips loudly
  when absent) and audit:publish (the published tree has no external
  subresource). It must print `RESULT: GREEN` as its last line before every
  commit; the verdict is in band precisely so piping through `tail` or `grep`
  cannot manufacture a pass.
- **`npm run ship:ios` before any Xcode build**, from the same tree whose Xcode
  project you then build. It builds, runs `npx cap copy ios`, verifies
  `dist/assets/app.js` against `ios/App/App/public/assets/app.js`, prints the
  checksum and `APP_VERSION`, and ends `RESULT: SHIPPED` or `RESULT: FAILED`.
  Xcode reuses whatever `cap copy` last wrote, so a build without the copy ships
  old JavaScript in a new wrapper.
- **`git diff --stat` before every commit**, reported. **Both git counts run,
  never recalled**: `git rev-list --count origin/main..develop` and
  `develop..origin/main`, after a `git fetch`.
- **Never adjust a pin to make it pass.** A moving pin means a rule leaked. Stop,
  report it with before, after and why, and only then decide. Some movers are
  correct and become retargets: name them, keep every clause they held.
- **Mutate every clause of every new pin.** A mutation that reddens nothing, the
  wrong pin, or crashes the harness is stop-and-report. Copy the pristine file,
  replace with an exact count, run, collect the reds, restore, verify by sha.
  Never run mutations concurrently with an Xcode build.
- **Native code compiles genuinely**: Xcode `BUILD SUCCEEDED`, then a deliberate
  error (`let _: Int = tru`) that fails at a named line, the file restored by
  sha, a green rebuild, and the warning count read from that rebuild.
- **The corpus proves only the forms it holds.** Twenty real call sheets live
  outside the repo (`~/Developer/tm-callsheets/`, one copy, no backup; the repo
  is public). A green corpus is evidence about those twenty sheets and nothing
  else; the twenty-first found a new form within an hour. Never quote personal
  data from it; never edit the founder's `expected.txt`.
- **Merge, never rebase. Nothing is pushed** except a release merge on request.
- **Report as you go; never end a turn with the report unwritten.** Sent
  invoices are frozen; bug-fixes may repair saved data; preference changes are
  defaults for new shoots only. House style (`BRAND.md`): British English,
  sentence case, no em dashes (the spaced hyphen), no emojis.

### The non-negotiables in the code

- Every existing **APA calc pin byte-identical**; all **123 scenarios byte-equal**
  (`scripts/build-vs-source-audit/compare.js`).
- All long-form pins green, including the **eleven worked-example fixtures**
  `LF13a`-`LF13k` in `scripts/storage-audit/storage-test.js`.
- **No APA production gains a key** (`LF22d`): the APA role set stays exactly
  `RATE_CARDS[0]`, byte-identical and in order.
- **`UK_BANK_HOLIDAYS` and `isBankHoliday` are untouched.** Nation sets compose
  around them.
- Every persisted `bigals_*` key joins the storage adapter's **KEYS warm list in
  the same commit**, or a relaunch destroys the record.

## What a fresh session must not assume

Every serious problem this fortnight was found by something that looked like it
was working. The traps, each with the commit or record that holds it:

1. **A green gate on a surface no pin had ever rendered, which shipped an app
   that could not launch.** The 2026.12 what's-new deck pointed a row's icon at
   `ICloudBackup`, the backup wrapper object, swept up by an icon-shaped name.
   React threw #130 on launch for every user who had seen 2026.11. Every stage
   was green: the storage sandbox stubs React, every deck pin was a source regex,
   and the render smoke's fixture kept the tutorial due so the deck never
   mounted there. Fixed in `751c7ba`; `WN2` and `R8` exist because of it. **If a
   surface can mount on launch, some stage must mount it.** Do not read a green
   gate as evidence about a surface no pin renders.
2. **A mutation that crashed the harness, reported as a mutation that reddened
   nothing, and the reverse.** In `fbd5e8f` one mutation crashed the harness
   instead of reddening (IA4/IA5 were made null-safe and the runner taught to
   report a crash before IA5 reddened by name); in `c998575` two did the same;
   in `22b90ca` the batch classifier reported MA11 as a crash when it was a
   clean red, because it choked on a parenthesised clause name. A crash and a
   silent pass look alike in a summary. Read the harness's own output for every
   mutation, count the assertions, and treat an absent result as a failure of
   the run, never as a pass.
3. **Xcode caching, so a fix appears not to land, and the phone running old
   JavaScript in a new wrapper.** A cached build reports the previous build's
   state, which is why the compile discipline is a deliberate failing line at a
   named line, a restore by sha and a green rebuild, with the warning count read
   from the rebuild. The sibling trap: `7d6265c`'s device test was a false
   negative because the device ran a stale Capacitor copy (`public/assets/app.js`
   without the new fields); `npm run ship:ios` and its checksum exist because of
   it. Build the phone from the same tree you shipped.
4. **A test fixture that passed for the wrong reason.** `PC9` first passed
   because its line was not a payee line at all, so the gate refused it for a
   reason the pin was not testing; the fixture was made a payee line. `PL4` was
   corrected twice (an HMRC word anchored a block; a CATERING line was skipped by
   the cell walk) before it tested the route it named. In `83eae87` MI11 was a
   weak mutation because PP1's single-page fixture could not tell a truncated
   set from a full one. Before trusting a green pin, ask which input would make
   it red, and whether the fixture can distinguish correct from broken.
5. **The corpus is twenty sheets, not a population.** Twenty sheets held five
   company label forms; the twenty-first, a live job on 8 September, brought a
   sixth (`COMPANY NAME:`) within an hour and shipped its label inside the
   company (`7f14a2a`). Sixteen of twenty is a statement about those twenty
   sheets, not an accuracy claim. Verification is presence, not meaning: a model
   value that merely appears on the sheet verifies.
6. **Reporting from one branch without checking the other.** The two trees
   differ by design: `develop` is where app work lands and `main` is what the
   web deploys and what the store build is cut from, and they diverge for days
   at a time. The 2026.12 close-out shipped a web app with an engine change the
   store build does not carry, on purpose and recorded; a report that reads only
   the tree in front of it gets that wrong. Run both counts after a fetch, name
   the branch beside every hash, and verify what is live by fetching it. The
   main checkout needed `npm ci` from the merged lock before the 2026.12 gate
   would run there; expect the same after any merge that touches `package.json`.

### Lessons that keep repeating

- **A pin that can't go red is decoration.** Assume the next one is yours.
- **A guard that cannot fail is decoration in the source, not just in the suite.**
- **The false-green class: absence of a result reads as a pass.** Verdicts in
  band and last, existence asserted before equality, assertion counts read rather
  than colours, and every fixture access defensive so a mutation yields a red
  assertion instead of taking the run with it. A render pin's target that throws
  outside the render call (React 18's rethrow) takes the whole smoke stage with
  it unless it mounts under a boundary of its own (`R8` does).
- **A green the device would not reproduce is worse than a red** (the Forever
  Living gap).
- **Never anchor a structural pin on copy.** Anchor on the render condition or
  the code structure, never on a string a copy edit can touch.
- **Verifying on the default path proves nothing when the default is the case
  where the bug is invisible.** Ask which input would distinguish correct from
  broken.
- **A discipline that depends on remembering a step will eventually be skipped.**
  If a step is load-bearing, it belongs in a command that can fail.
- **A finding that doesn't become an assertion isn't a finding, it's a note.**
- **Fixtures assert the happy path unless you make them do otherwise.** Every
  money fixture carries at least one broken claim link.
- **The device finds what pins cannot.** Walk every editor an area can reach.
- **Two enforcement points for one rule share one constant, or they drift.**
- **Evidence first.** The 5 September "reloads" were ordinary reclaims; the
  finding was corrected the day it was made. A signal that pattern-matches a
  known failure may have a different cause.

## Where the documents live

| File | What it is for |
|---|---|
| `CLAUDE.md` | Operating rules, build topology, environment constraints. Auto-loaded. |
| `MAINTENANCE.md` | The parked-work ledger: every round's record, every held item with its trigger and reasoning. Read before touching anything named above. |
| `CALC_DECISIONS.md` | The calc rulings ledger: every adjudicated pay question, with the clause quoted, the ruling, and its reach. Read before re-litigating any calc behaviour. |
| `CHANGELOG.md` | What shipped, per release, in the release-notes voice; the 2026.12 section is the latest. |
| `WRAPPED_DATA_AUDIT.md` | Phase 0 scoping for the end-of-year Wrapped: storage map, field inventory, Health integration, ownership, data completeness. |
| `PACT_BECTU_PLAN.md` | The long-form plan file: roadmap, standing hazards, rulings-in-context. |
| `APA_RULES.md` | Rule file - APA, authoritative for the commercials engine. §5 is time off the clock. |
| `PACT_BECTU_TV_RULES.md` / `PACT_BECTU_FILM_RULES.md` / `PACT_BECTU_RATE_CARDS.md` | Long-form rule files and cards. |
| `APA_CREW_TERMS_2026.md` + `APA_2025_TO_2026_CHANGE_LOG.md` | The Sept 2026 APA terms and a clause-by-clause diff. |
| `BRAND.md` | House style for every surface. |

**Source PDFs** at the repo root as before; the scripted-TV PDF has an OCR
sidecar - grep the sidecar, cite the PDF. **APA rate cards** are `RATE_CARDS` in
`index.html`, effective-dated, with exactly one documented exception (`terms`).

## Build and device

```bash
npm run gate          # build + all audits; must end RESULT: GREEN
npm run build         # esbuild -> dist/ only
node scripts/build-web.js   # the fail-closed web publish set -> dist-web/
```

For the device, from the develop worktree - **this is the only supported way**:

```bash
npm run ship:ios
```

App work lives in the worktree `~/Developer/tm-develop` on `develop`; the shared
checkout at `~/TimeMachine` is `main` and the web side. Each tree has its own
`node_modules` (a symlink to the main repo's is enough for the worktree, because
`ios/App/CapApp-SPM/Package.swift` reaches `node_modules` by relative path). Git
allows a branch in one worktree at a time; do not switch the shared checkout out
from under a live session.

Direct builds for verification:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData build
```

The repo must stay on a **local volume**, never iCloud Drive. See `CLAUDE.md`.

## What this rewrite replaced

Rewritten on 10 September 2026 from the repo and the log, after the App Store
approval, for a reader who knows nothing of the last two weeks: the release
state (both sides live, the close-out merge, the one engine change the store
build lacks); the Capacitor 8.5 prep carried intact with the inventory re-read
from the lock; the 2026.14 queue rewritten as ten items in plain English; the
open rulings re-derived from the ledger's own status words; the unverified list
stated as unverified; the method as a list a session can follow; and the six
traps of the fortnight, each tied to its commit or record.
