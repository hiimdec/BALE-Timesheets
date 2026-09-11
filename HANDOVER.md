# TimeMachine - handover

The document to read cold. It points; it does not duplicate. **Where this file
and the repo disagree, the repo wins** - verify against the code before acting on
anything here. Written on 10 September 2026 from the repo and the log, after
2026.12 went live on the App Store and on the website, and updated on
11 September for the 2026.13 close-out. Every hash below is on `main` unless it
says otherwise; `develop` is level with `main`.

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

**2026.13 is the current release.** It is Capacitor 8.5 alone, shipped in three
stops on `develop`: `ee098c0` (stop one, the dependency 8.3.4 to 8.5.1, four
files, device-verified), `0b7597b` (stop two, UIScene by hand on the storyboard
route, five files, device-verified), and stop three, the same code built under
Xcode 27 RC, build 27A266a, and walked on an iPhone 12 on iOS 27 with no commit
of its own, because Xcode 27 altered no tracked file. The close-out commit that
carries this document bumps `APP_VERSION` to 2026.13, `MARKETING_VERSION` to
2026.13 and `CURRENT_PROJECT_VERSION` to 13; `develop` was then merged into
`main` as the merge commit **tagged `v2026.13`** and pushed, so the web serves
2026.13. **The App Store build 2026.13 (13) is the founder's to archive and
submit from the Xcode 27 GUI**; until Apple approves it, the store serves
2026.12 (12), and `home-preview.html`'s `softwareVersion` stays 2026.12 - it
moves only on approval, with the release line in `CLAUDE.md`.

**No what's-new card for 2026.13 (founder-ruled).** The release has nothing a
user can see; the card is for announcements. `WHATS_NEW_VERSION` stays 2026.12
behind `APP_VERSION` 2026.13, and the deck's gate requires the two to be equal,
so on 2026.13 the deck fires for nobody, including a user coming from 2026.11
who never saw the 2026.12 card, and the Settings button "Show what's new again"
clears the edition but mounts nothing. Both consequences were put to the
founder at the close-out. The storage pins that hold the relationship, Z9f and
WN1, were retargeted by name to the ruled pair and mutated once.

**What 2026.13 carries to the phone beyond Capacitor.** Turnaround measured to
the pre-call, TOC only (`e482492`, ruled 10 September, `CALC_DECISIONS.md`), on
the web since the 2026.12 close-out merge and now **verified on hardware**
(11 September, iPhone 12): a 22:00 wrap followed by a 09:00 unit call with an
08:00 pre-call produced the breach, and the invoice PDF named the pre-call as
the measure. There is no 2026.13 section in `CHANGELOG.md`; that is the
founder's call, made with the no-card ruling.

**2026.12 for the record.** The App Store build 2026.12 (12), built from
`develop` at `751c7ba`, went live on 10 September 2026. `main` carries the
release merge `942ab0f` ("Merge branch 'develop' into main: 2026.12", parents
`b649d5f` and `751c7ba`), tagged `v2026.12` on that merge commit (the previous
tag, `v2026.11`, sits on the archived develop commit `ab583a8`; the founder
ruled the merge commit from then on). The 10 September close-out merged
`3068d80` and the records commit `ea5cd1b`; the handover rewrite `a9bcb7c`
followed. After the 2026.13 close-out, `main`, `develop` and `origin/main` are
level; nothing is pushed except a release merge on request.

**How the web deploys and how you prove it.** Netlify builds `main` with
`npm run build && node scripts/build-web.js` (proven on the 2026.12 deploy, the
first time its build step ever ran) and publishes `dist-web/`, a fail-closed
allow-list of 51 files with zero external subresources. There is no Netlify CLI,
token or browser session on this Mac: the live site changing is the only deploy
signal, and it changes within a minute of the push. Verify by fetching, byte for
byte against a fresh `dist-web/` (`node scripts/build-web.js`), never by
assuming; a failed Netlify build leaves the previous deploy live rather than
breaking the site. App Store Connect edits for 2026.12 are done (founder);
2026.13's listing needs none, the release has no user-facing copy.

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

## 2026.13 shipped: Capacitor 8.5 alone, in three stops

Ruled as the whole release so that an unexplained fault afterwards has one
candidate. Each stop was proposed first, built, gated, and device-verified by
the founder before its commit. The durable facts, for the next Capacitor round:

**Stop one, `ee098c0`: the dependency alone.** core, ios and cli 8.3.4 to
8.5.1 in package.json and the lock (the CLI gained a dependency on `xcode`,
which took six lock entries out of dev-only, no version change), the SPM
manifest pinned to exact 8.5.1, Package.resolved at revision 6afa7424. No
migrator, no SceneDelegate. Proved the runtime alone changes nothing: gate
GREEN with every count identical, clean Xcode 26.6 build, and the device walk
including Open Settings, the `app-settings:` navigation that exercises 8.5.1's
changed activation-state check (the two `window.open` links do not reach it).

**Stop two, `0b7597b`: UIScene by hand, on the storyboard route.** Never run
`npx cap migrate` on this project: it is the 7-to-8 upgrade wrapper, it would
loosen every Capacitor range to `^8.0.0` and `npm update` the whole tree, its
plist serialiser drops the FORCE DARK comment, and its project-file serialiser
rewrites `LastUpgradeCheck` and stamps attributes Xcode never writes. The four
edits were made by hand with the vendor's exact texts: the scene manifest in
Info.plist (one configuration, `$(PRODUCT_MODULE_NAME).SceneDelegate`, the
Main storyboard, multiple scenes off); `SceneDelegate.swift`, which builds no
window and names no controller and only forwards the three scene callbacks to
`SceneDelegateProxy`, so the window and its root come from Main.storyboard,
whose initial controller is `MainViewController`, the class that registers the
eleven plugins and owns the chrome (the vendor's template builds a second window
around a plain `CAPBridgeViewController`, which boots with no plugins and no
chrome; SC4 pins that shape out); AppDelegate's two URL handlers removed and the
vendor's `configurationForConnecting` added, so a working share link proves the
scene path served it; the file registered with four canonical project entries.
Pins SC1-SC7 live in the lifecycle stage of the native audit (13 assertions),
fourteen mutations on copies. The CLI's own classifier reads the project as
already migrated, so a future Capacitor 9 migrate skips the stage. Simulator
cold launch: one `plugin.load` line, one bridge, both bars.

**Stop three, no commit: the same code under Xcode 27.** Xcode 27 RC, build
27A266a, sits at `/Applications/Xcode 27.app` beside 26.6. Its iOS 27 SDK's
minimum deployment target is 15.0, so the app's 15.0 and the widget's 16.2 need
no change; Swift language mode 5 compiles; every ActivityKit call we make is
declared identically in both SDKs; the parked `requestConfirmation(result:)`
is still deprecated, not obsoleted. Built and walked on an iPhone 12 on iOS 27:
bars, status bar, PDF contents, the Live Activity card, the app icon and share
all correct; `git status` clean afterwards. Use a per-command `DEVELOPER_DIR`
rather than a global switch, keep its build under `ios/DerivedData/` (the
ignore pattern matches that exact name only), and prove which Xcode built a
product from its Info.plist (`DTXcode`, `DTXcodeBuild`, `DTSDKName`), never
from the shell. Only the iOS 26.5 simulator runtime is installed; a simulator
run under 27 needs the runtime download, the phone does not.

**The derived data trap, two shapes.** After stop one, the Xcode GUI's derived
data still held the 8.3.4 package while the command line had resolved 8.5.1, and
the first GUI build failed with three "Cannot find 'SceneDelegateProxy' in
scope" errors. File > Packages > Reset Package Caches, then Product > Clean
Build Folder, fixed it. A toolchain switch has the same shape of trap with
stale build products: the GUI folder is shared by both Xcodes because it is
named by the project path (`~/Library/Developer/Xcode/DerivedData/App-<hash>`),
and Swift modules compiled by one compiler cannot be imported by another. Clean
Build Folder before the first build under a different Xcode, in both
directions; on the command line, a separate `-derivedDataPath`. This will
happen again to anyone building from a GUI after a Capacitor bump or an Xcode
change.

**Carried to 2026.14 from stop three:** the new Xcode 27 warnings - the
FoundationModels initialiser the reader calls at `CallSheetPlugin.swift:966`
(`GenerationOptions(sampling:)`, now deprecated and renamed to
`init(samplingMode:)`) and the weak-capture diagnostics the Swift 6.x compiler
raises in Swift 5 mode. Warnings only; recorded in the queue below.

**Capacitor 9** is a later round with its own iOS floor decision: 9 requires
iOS 16, Xcode 27 with Swift 6, `@main` and Node 24, and drops the Cordova
runtime product from `Package.swift`. GA was forecast for the end of November
2026.

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
- **The pre-call data entry fault - two hypotheses now, not one.** What it is:
  a pre-call that would not go in. The first-hand report (founder, 11 September,
  on 2026.13 on the device): a number is selected in the pre-call field, enter
  is pressed, and the value does not go in; it took several attempts before it
  took. That is an input-layer symptom. Neither the founder nor the session
  could reproduce it on 2026.13 on the device afterwards. Hypothesis one, the
  input layer: the solo editor's `TimeInput`, the date edit, the department
  default and the day record's time input are the entry sites; `preCallTime`
  is not one of the five cascade fields but an extras field, backfilled onto
  every `dayDefaults` entry by the load pass and compared against
  `defaults.preCallTime` for the variance chips. Hypothesis two, silently
  ignored after saving: the engine ignores a pre-call that sits after the call
  when the implied overnight window exceeds 12 hours, pushes a note saying so
  ("Pre-call appears to be after main call - ignored"), and nothing in the app
  renders the engine's notes, so such a pre-call saves, pays nothing and shows
  nothing; the founder's own data holds one such record (8 May 2026, call
  06:30, pre-call 11:50). The two are not the same fault and the report fits
  the first. Why it matters: money is entered here, and a value that appears to
  refuse entry is the worst kind of fault to have on set. Parked for 2026.14:
  reproduce the input symptom first, on the device, with the ring on, then
  decide; the fix for hypothesis two is a visible line beside the field
  whenever the pay block ignores the value. Report before proposing either way.
- **The tutorial adopting the new card component.** What it is: the what's-new
  deck and the tutorial share one chassis since `0f4c83e` (one way out, bar
  dots, hero tiles), but the tutorial adopted the chassis only - its six cards
  and their illustrations are untouched, and its copy is its own round. Why it
  matters: two surfaces that look like siblings and are not, and the tutorial is
  the first thing a new user sees. The deck's own device round (`bd776d2`,
  `681118a`) is the model; `TUTORIAL_VERSION` moves only if the copy changes.

- **The IA7 storage pin that flaked.** What it is: IA7, the Live Activity
  ingest idempotence pin, went red once on 11 September (its wrap clause,
  applying a wrap event twice and comparing the records) and green on the
  rerun without the tree changing. Why it matters: a pin that can go red on the
  clock is halfway to decoration, and a red that is waved through as "the
  flake" is how a real red gets waved through one day. Find the timestamp the
  wrap apply takes that the comparison does not strip, and make the pin
  deterministic.
- **The new Xcode 27 warnings.** What it is: the FoundationModels initialiser
  the reader calls at `CallSheetPlugin.swift:966`, `GenerationOptions(sampling:)`,
  is deprecated in the iOS 27 SDK and renamed to `init(samplingMode:)`; and the
  Swift 6.x compiler raises weak-capture diagnostics in Swift 5 mode. Why it
  matters: they are warnings today and the deprecation is a removal in waiting;
  the reader is iOS 26-gated, so the fix is a rename behind the same guard,
  propose-first because it touches the reader.

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
- **Turnaround to the pre-call: verified on hardware, 11 September**, and off
  this list - a 22:00 wrap, a 09:00 unit call with an 08:00 pre-call, the breach
  shown and the invoice PDF naming the pre-call as the measure. The Best Boy
  grid's chip on the member with the pre-call only was not part of that walk.
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

Updated on 11 September 2026 for the 2026.13 close-out: the release state
(2026.13 shipped in three stops, the no-card ruling and its two consequences,
the version bump, the store build the founder submits from the GUI); the
Capacitor section rewritten from a plan into a record, with the derived data
trap in both its shapes; the pre-call turnaround moved from unverified to
verified; the pre-call entry fault re-framed as two hypotheses around the
first-hand report; the IA7 flake and the Xcode 27 warnings added to the 2026.14
queue; the stale line about `main` and `develop` being ahead of `origin`
corrected.
