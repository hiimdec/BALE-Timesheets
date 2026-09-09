# TimeMachine — handover

The document to read cold. It points; it does not duplicate. **Where this file and
the repo disagree, the repo wins** — verify against the code before acting on
anything here. Written on 9 September 2026 from the repo and the log, after the
2026.12 web release. Every hash below is on `main` unless it says otherwise.

`CLAUDE.md` holds the operating rules and is loaded automatically. This file is
the state, the method and the map.

## What the app is

TimeMachine is a pay and timesheet calculator for UK film and TV crew: you enter
call, lunch and wrap, and it works out what the day pays under the relevant
agreement, then turns that into timesheets and invoices. It runs two independent
pay engines — **APA** (commercials, the mature one) and **Pact/Bectu long form**
(scripted TV and film, newer) — chosen per production and fixed for that job's
life. The source is a single self-contained `index.html` (React 18 + Tailwind,
in-browser Babel when opened raw). The website publishes the BUILT app from
`dist/` under `/app/` (vendored React, no external subresource), deployed to
timemachineapp.co.uk by Netlify from `main`; the iOS app is the same build
wrapped by Capacitor, with the native side in `ios/App/App/*.swift` and a widget
extension for the Live Activity.

## The working method

- **Propose first, build second** on anything touching the calc engine, the
  storage schema, a migration, a frozen record, or native code. Investigate, show
  the current logic, propose, wait for the ruling. No silent edits to the pay
  engine. Ambiguity gets claimed-and-flagged, never silently under-claimed.
- **Sequential commits with a gate between each.** `npm run gate` must print
  `RESULT: GREEN` as its last line before every commit — the script prints the
  verdict in band precisely so piping through `tail`/`grep` cannot manufacture a
  pass (see the comment at the top of `scripts/gate.sh`; three checks have passed
  while testing nothing on this project).
- **Report `git diff --stat` before every commit.** Both git counts
  (`origin/main..develop` and `develop..origin/main`) run, not recalled.
- **Never adjust a pin to make it pass.** A moving pin means a rule leaked. Stop,
  report it with before, after and why, and only then decide. Some movers are
  correct and become *retargets* — name them, keep every clause they held.
- **A pin that can't go red is decoration.** Mutate every clause of every new pin
  and confirm the intended pin, and only it, goes red. A mutation that reddens
  nothing, the wrong pin, or crashes the harness is stop-and-report.
- **Native code compiles genuinely**: Xcode `BUILD SUCCEEDED`, a deliberate error
  that fails at a named line, the file restored by sha, a green rebuild.
- **Merge, never rebase. Nothing is pushed** except a release merge on request.
- **Device passes are part of the work**, not a formality — see the lessons.

## The non-negotiables

- Every existing **APA calc pin byte-identical**; all **123 scenarios byte-equal**
  (`scripts/build-vs-source-audit/compare.js`).
- All long-form pins green, including the **eleven worked-example fixtures**
  `LF13a`–`LF13k` in `scripts/storage-audit/storage-test.js` — the agreements'
  own worked examples, executed.
- **No APA production gains a key** (`LF22d`): the APA role set stays exactly
  `RATE_CARDS[0]`, byte-identical and in order.
- **`UK_BANK_HOLIDAYS` and `isBankHoliday` are untouched.** Nation sets compose
  around them; the default path must stay value-identical.
- **Sent invoices are frozen.** Snapshot at send; never mutate one, even when the
  underlying production changes. Bug-fixes may repair saved data; preference
  changes are defaults for NEW shoots only, never retroactive.
- Every persisted `bigals_*` key joins the storage adapter's **KEYS warm list in
  the same commit**, or a relaunch destroys the record.
- **The corpus of real call sheets never enters the repo** (`~/Developer/
  tm-callsheets/`, one copy, no backup). Never quote personal data from it; never
  edit the founder's `expected.txt`.
- **House style** (`BRAND.md`): British English, sentence case, no em dashes (the
  spaced hyphen), no emojis.

## Where the documents live

| File | What it is for |
|---|---|
| `CLAUDE.md` | Operating rules, build topology, environment constraints. Auto-loaded. |
| `MAINTENANCE.md` | The parked-work ledger: every round's record, every held item with its trigger and reasoning. Read before touching anything named below. |
| `CALC_DECISIONS.md` | The calc rulings ledger: every adjudicated pay question, with the clause quoted, the ruling, and its reach. Read before re-litigating any calc behaviour. |
| `CHANGELOG.md` | What shipped, per release, in the release-notes voice; the 2026.12 section is the one just written. |
| `WRAPPED_DATA_AUDIT.md` | Phase 0 scoping for the end-of-year Wrapped: storage map, field inventory, Health integration, ownership, data completeness. |
| `PACT_BECTU_PLAN.md` | The long-form plan file: roadmap, standing hazards, rulings-in-context. |
| `APA_RULES.md` | Rule file — APA, authoritative for the commercials engine. §5 is time off the clock. |
| `PACT_BECTU_TV_RULES.md` / `PACT_BECTU_FILM_RULES.md` / `PACT_BECTU_RATE_CARDS.md` | Long-form rule files and cards. |
| `APA_CREW_TERMS_2026.md` + `APA_2025_TO_2026_CHANGE_LOG.md` | The Sept 2026 APA terms and a clause-by-clause diff. |

**Source PDFs** at the repo root as before; the scripted-TV PDF has an OCR sidecar —
grep the sidecar, cite the PDF. **APA rate cards** are `RATE_CARDS` in
`index.html`, effective-dated, with exactly one documented exception (`terms`).

## Lessons that keep repeating

- **A pin that can't go red is decoration.** Assume the next one is yours.
- **Mutate every clause, not the pin.** The whole-pin test proves the pin fires;
  only per-clause mutation proves each rule inside it does.
- **A guard that cannot fail is decoration in the source, not just in the suite.**
- **The false-green class: absence of a result reads as a pass.** Verdicts in
  band and last, existence asserted before equality, assertion counts read rather
  than colours, and every fixture access defensive so a mutation yields a red
  assertion instead of taking the run with it. The newest instance (9 September):
  a render pin's target threw *outside* the render call, React 18's rethrow, and
  took the whole smoke stage with it — the pin now mounts under a boundary of its
  own so a failure is a named red, never a crash.
- **Nothing between the copy and the phone rendered the deck.** The 2026.12
  what's-new copy pointed a row's icon at an object with an icon-shaped name
  (`ICloudBackup`, the backup wrapper), React threw #130 on launch, and every
  stage was green because the sandbox stubs React and the smoke's fixture kept
  the tutorial due. `WN2` (values executed) and `R8` (the real deck through real
  react-dom) exist because of it. **If a surface can mount on launch, some stage
  must mount it.**
- **The corpus proves the forms it holds and nothing more.** Twenty sheets held
  five company label forms; the twenty-first, a live job, brought a sixth within
  an hour and shipped its label inside the company. Sixteen of twenty is a
  statement about those twenty sheets, not an accuracy claim.
- **Verification is presence, not meaning.** A model value that merely appears
  on the sheet verified — the page-1 brand as the company on 14 of 20 sheets, a
  masthead's "DAY 1" as the reference. Every field with a context gate now (email,
  reference, company) got it after a real miss; the address has none yet.
- **A green the device would not reproduce is worse than a red** (the Forever
  Living gap, below).
- **Never anchor a structural pin on copy.** Anchor on the render condition or
  the code structure, never on a string a copy edit can touch.
- **Verifying on the default path proves nothing when the default is the case
  where the bug is invisible.** Ask which input would distinguish correct from
  broken; if the default cannot, it is the one case not worth checking.
- **A discipline that depends on remembering a step will eventually be skipped.**
  If a step is load-bearing, it belongs in a command that can fail: `npm run
  gate`, `npm run ship:ios`.
- **A finding that doesn't become an assertion isn't a finding, it's a note.**
  The moment a diagnostic reproduces a defect, write it as a pin before the
  report.
- **Fixtures assert the happy path unless you make them do otherwise.** Every
  money fixture carries at least one broken claim link.
- **Read the assertion COUNT, not just the colour.** A red gate always deserves
  the tail of the output, not just its verdict.
- **The device finds what pins cannot.** Walk every editor an area can reach.
- **Two enforcement points for one rule share one constant, or they drift.**
- **Report as you go; never end a turn with the report unwritten.** Two turns
  this cycle closed on "no response requested" with the founder waiting.

## Build and device

```bash
npm run gate          # build + all audits; must end RESULT: GREEN
npm run build         # esbuild → dist/ only
node scripts/build-web.js   # the fail-closed web publish set → dist-web/
```

For the device, from the develop worktree — **this is the only supported way**:

```bash
npm run ship:ios
```

It builds, runs `npx cap copy ios`, verifies `dist/assets/app.js` against
`ios/App/App/public/assets/app.js`, prints the checksum and `APP_VERSION`, and
opens Xcode; it ends `RESULT: SHIPPED` or `RESULT: FAILED` in band. Xcode reuses
whatever `cap copy` last wrote, so building without the copy ships **old
JavaScript in a new wrapper** — that has cost two cycles here. `npm run ship:ios`
must run from the same tree whose Xcode project you then build.

App work lives in the worktree `~/Developer/tm-develop` on `develop`; the shared
checkout at `~/TimeMachine` is `main` and the web side. Each tree has its own
`node_modules`; the main checkout needed `npm ci` from the merged lock before the
2026.12 gate would run there — expect the same after any merge that touches
`package.json`.

Direct builds for verification:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData build
```

The repo must stay on a **local volume**, never iCloud Drive. See `CLAUDE.md`.

## State

### Where the release stands

**`main` is 2026.12**, the merge commit `942ab0f` ("Merge branch 'develop' into
main: 2026.12", parents `b649d5f` and `751c7ba`), **tagged `v2026.12`** on that
merge commit (the previous tag, `v2026.11`, sits on the archived develop commit
`ab583a8` instead; the founder ruled the merge commit this time). The web side
was pushed on 9 September and verified live by fetching, byte for byte against
`dist-web/`: the privacy page with the analytics wording, the about page, the
built app at `/app/` with zero external hosts and a clean console, the
stylesheet, and the internal files still answering 404. Netlify ran
`npm run build` for the first time on this deploy and it succeeded — the bundle
at `/app/assets/app.js` exists only if it did.

**The App Store build 2026.12 (12)** is built from `develop` (`751c7ba`, the
deck fix) and is **awaiting submission**. `develop` is 0 ahead of `origin/main`
and was brought level with `main` after this document was written, so both
trees carry it. `APP_VERSION` and `WHATS_NEW_VERSION` read 2026.12,
`TUTORIAL_VERSION` stays 2, `CURRENT_PROJECT_VERSION` is 12 and
`MARKETING_VERSION` 2026.12 at all eight project lines; the built products stamp
2026.12 (12) for the app and the widget.

**Moves only when Apple approves:** `home-preview.html`'s `softwareVersion`
(reads 2026.11, tracks the live listing), the release line in `CLAUDE.md`, and
this document's release state. **App Store Connect edits are done** (founder,
9 September): the two listing lines and the privacy label at Product
Interaction.

### What shipped in 2026.12 — 167 commits between the tags, by feature

Read `CHANGELOG.md`'s 2026.12 section for the release voice; the log for the
hashes. In the order the changelog groups them:

- **The call sheet reader works on every iPhone.** Ungated from Apple
  Intelligence; patterns run everywhere, the model folds in where it exists,
  bounded to 12 seconds and three pages. Then the three context gates the device
  taught us: email (`0a739e4`), reference (`6903e73`), company (`4510f55`), and
  the label fixes from the first live sheet (`7f14a2a`), with the reader's own
  `reader.field` ring lines naming every field's source.
- **Your earnings, clearer** — the stats money round; the headline is the sum
  of the month rows, pinned executable under each basis.
- **Buyouts** — one figure, the day-by-day record on the second page.
- **Timesheets worth sending** — the shared text timesheet with golden fixtures.
- **The lock screen keeps up** — the Live Activity ingest seam, the card as
  witness (mismatch detector + Apply), the resolved-day fixes to the detector
  and the descriptor (`4a27417`, `e5664ea`), the night-wrap intent (`7fc5cee`).
- **Steps that stick around** — the Legwork rollup that survives a new phone
  (`170cb0b`); access-off inferred from a zero year (`df8727e`).
- **Anonymous usage milestones** — Aptabase, opt-out with its own notice;
  deliberately absent from the what's-new deck (pinned `DK9`, recorded).
- **What's new, redesigned** — the deck (`AnnouncementDeck`, `WHATS_NEW_PAGES`),
  three heroes then the list; rendered by the gate since `751c7ba`.
- **Dark mode everywhere**; **a crew rate fix** (the dayDefaults agreement
  guard, `9be7ae5`); **saved means saved** (the record is an atomic file,
  `c998575`).
- **Reliability** — no native dialogs (`c19e324`), share-in closes the app-level
  screens (`03abd0e`), one door out of the chooser and the Inbox cleared
  (`6903e73`), no synchronous system call on the main thread (`b221db5`), the app
  holds background time for its backgrounding work with lifecycle ring lines and
  the iCloud cancel timers (`99886da`).
- **A faster website** — the built app published from `dist/`, the fail-closed
  allow-list, zero external subresources (`c21c8aa` and its siblings).
- **Share diagnostics** — the long-press export and the Siri intent, the
  always-on ring lines; a support tool that earned its place in the notes.

### 2026.13 IS CAPACITOR 8.5 ALONE — founder-ruled, propose-first

Nothing else goes in. It changes how the app starts up, the layer with this
project's worst history, and it unblocks Xcode 27; shipped isolated, an
unexplained fault afterwards has one candidate. Propose first; device walk
afterwards on share links, the share sheet, the call sheet reader and PDF export.

**Where we are (from `package-lock.json` and `ios/App/CapApp-SPM/Package.swift`):**
core, ios and cli at **8.3.4**; first-party plugins app 8.1.0, browser 8.0.3,
filesystem 8.1.2, haptics 8.0.2, local-notifications 8.2.0, preferences 8.0.1,
share 8.0.1, status-bar 8.0.2; one third-party plugin, `capacitor-email-composer`
8.0.0 (EinfachHans; last release 16 January 2026, not archived, six open
issues). **No Cordova plugins** (zero in the lock); the SPM manifest links the
runtime's `Cordova` product only because the template does. Deployment target
iOS 15.0 for the app, 16.2 for the widget; `SWIFT_VERSION` 5.0; `@UIApplicationMain`
on the app delegate; the root view controller comes from `Main.storyboard`
(`UIMainStoryboardFile`), custom class `MainViewController`, which registers all
eleven app-embedded plugins in `capacitorDidLoad` and owns the native chrome, the
termination shim, the diagnostics gesture and the lifecycle plugin.

**What 8.5 changes (read from the published `@capacitor/ios@8.5.1` and
`@capacitor/cli@8.5.1`, not from memory):** UIScene support — a
`SceneDelegateProxy` that receives `scene(_:willConnectTo:)`,
`scene(_:openURLContexts:)` and `scene(_:continue:)`, mirrors the URL into
`ApplicationDelegateProxy.lastURL` so `getLaunchUrl()` keeps working, posts the
same `capacitorOpenURL` / `capacitorOpenUniversalLink` notifications the App
plugin already listens to, and **defers a cold-launch URL until the bridge view
controller's first `viewDidAppear`** (ours calls `super`, so the post fires). The
bridge's `pause` / `resume` document events move to `UIScene` notifications;
`UIApplication` notifications still post, so `AppLifecyclePlugin`'s background
task and lifecycle lines and the App plugin's `appStateChange` are untouched.
`npx cap migrate` adds `UIApplicationSceneManifest` to Info.plist (with
`UISceneStoryboardFile: Main`; it does not remove `UIMainStoryboardFile`), writes
the template `SceneDelegate.swift`, patches `AppDelegate.swift` with
`configurationForConnecting`, registers the file in the pbxproj, and **warns**
about our custom `open url:` and `continue userActivity:` handlers.

**The risk that is ours, ranked first:** the template SceneDelegate builds a new
window with a plain `CAPBridgeViewController()`, not `MainViewController`. Left
as written, the app boots with none of our plugins registered and no chrome. The
generated file must instantiate `MainViewController` (or keep the storyboard's
controller), and a native-audit pin must say so. Then, in order: share-in from
Files and Mail at cold launch (URL delivery now arrives after `viewDidAppear`;
the handler reads `getLaunchUrl()` and listens for `appUrlOpen`, deduped, so
both orders should work — device-only proof); share links (universal links via
the scene `continue` path); the two app-delegate handlers going silently dead;
a Live Activity button press launching the app in the background under scenes
(no scene connects, so the webview may not boot — the intent already treats a
cold process as "leave it for foreground"); the chrome's layout under a
programmatic window.

**What the gate cannot cover:** none of the scene delegate runs in the storage
sandbox or the render smoke, and Xcode proves only that it compiles. The
simulator can exercise cold launch, a file shared from its Files app, and a
universal link via `simctl openurl`. Device-only: the share sheet from Mail and
Files on a real phone, the lock-screen Live Activity press, PDF export through
the print pipeline, the background task's expiry, Health, and the receipts.

**Xcode 27:** Apple's requirement is tied to the SDK you build with — an app
built against the iOS 27 SDK without a scene manifest does not launch. 8.5 is
what the vendor shipped for exactly that ("a breaking minor rather than waiting
for Capacitor 9"), so **8.5 genuinely unblocks Xcode 27**; our Swift 5 language
mode keeps `@UIApplicationMain` compiling there. **Capacitor 9** is at
`9.0.0-alpha.6` (14 July), GA forecast for the end of November 2026, requiring
**iOS 16.0, Xcode 27 with Swift 6, `@main`, Node 24**, and dropping the Cordova
runtime product from `Package.swift`. 9 is a later round with its own iOS floor
decision, not part of 2026.13. This Mac runs Xcode 26.6.

**The sequence proposed for the round:** (1) bump to 8.5.1 without migrating —
the delegate-based app still works on 8.5 — gate, Xcode, a device smoke:
stopping point one, proves the runtime alone changes nothing; (2) run the
migrator, hand-edit the SceneDelegate to `MainViewController`, drop or forward
the dead app-delegate handlers, add the pins (SceneDelegate instantiates our
controller; the manifest names it; no handler left behind), gate, Xcode, the
simulator walk: stopping point two; (3) the device walk on the four named
surfaces plus the lock-screen press and the ring's lifecycle lines: stopping
point three, then the ship step. Each point needs its proof before the next.

### 2026.14 CARRIES EVERYTHING ELSE, WITH WRAPPED

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

- **The raw-read ledger.** The load pass collapses five cascade fields
  (`callTime`, `wrapTime`, `lunchStartTime`, `lunchDurationMins`, `dayType`) into
  day defaults, so a reader that takes the raw record instead of `resolveDay`
  sees nothing where the resolved value lives. Five such defects were fixed in
  one week (the detector, the descriptor, the night-wrap intent among them); the
  sweep record in `MAINTENANCE.md` classified every remaining read. The ledger
  is an audit stage that lists every read of those fields and its class, so a
  sixth instance reddens the gate instead of a device. Proposed, not built. The
  founder's count of the reads is 336.
- **The invoicing address context gate, the last of the three fields.** The
  model's address verifies on a postcode in the span, which is shape, not
  intent: the shoot location has a postcode too, and a verified model value is
  never displaced. Same fix shape as the email, the reference and the company
  gates: presence must sit where the field belongs (an anchored invoicing block
  or a payee phrase). Propose-first with a corpus measurement; the Mac's copy of
  the model and the replay tooling from the company round are in the
  MAINTENANCE record.
- **The iCloud coordination timeouts, the remainder.** The 5 September record
  proposed six parts; `99886da` built the cancel timer on every coordination,
  the cached container URL, the `icloud.timeout` line and the structural pin.
  Still open: coalesced pending writes (one in flight per filename), the
  flag-gated `icloud.slow` line, and the Settings backup row timing its
  "checking" state out to "iCloud not responding".
- **The Forever Living harness fidelity gap.** The corpus mode's OCR mirror runs
  with language correction off and top-left ordering; the plugin's OCR runs with
  correction on and mid-line bands. On that sheet the harness finds the company
  and the plugin's settings find nothing, so the phase-two green is harness-only.
  Its own round: align the mirror with the plugin (the device is the truth),
  re-ratchet, device-walk the sheet. Until then read the phase-two count as
  "green on the Mac's OCR settings".
- **The long-form chip precedence.** The long-form day editor's lunch chip chain
  runs CURTAILED before LATE, the opposite of the solo editor, which since
  `c04f685` renders both. Recorded for this round in `MAINTENANCE.md`.
- **The error boundary paints hardcoded colours.** `RootErrorBoundary` renders
  above the themed tree with inline hex (near-black ground, sky button on black)
  and reads no theme token; in poppy mode the accent is wrong. Paint it from the
  tokens, or keep it deliberately theme-free and say so.
- **The open calc question:** whether a very-late AND curtailed lunch receives
  both CWD and curtail treatment. `CALC_DECISIONS.md`, OPEN, surfaced 4 September.

**Three new items from the founder (9 September):**

1. **Best Boy Excel export.** Alongside the PDF, a more technical spreadsheet of
   a whole unit's times and money. A new feature, propose-first, probably the
   largest item on the list. The money enumerator behind the stats surfaces and
   the invoice snapshots are the sources; every figure must come from the same
   place the PDF's do.
2. **Pre-call excluded from turnaround.** Pre-calls are left out of the
   turnaround calculation and should be included. The engine today:
   `restHoursBetween(prevDay, currDay)` and `calcTOC` measure the rest from the
   previous day's wrap to the current day's `callTime`, on resolved days;
   `preCallTime` plays no part, so a 05:00 pre-call after a late wrap shows a
   full night's rest. APA §5 (`APA_RULES.md`, "time off the clock"): eleven
   hours minimum, one TOC hour paid at the OT rate when the break is ten, a
   breach below ten. Report what the engine does, what the agreement says, and
   what changes if pre-calls count — money, so it needs a ruling before a build.
3. **Pre-call data entry fault.** The founder hit a case where entering a
   pre-call would not save; not yet reproduced. Note before assuming the class:
   `preCallTime` is **not** one of the five `TIME_CASCADE_FIELDS`; it belongs to
   the extras family, backfilled onto every `dayDefaults` entry by the load pass
   and compared against `defaults.preCallTime` for the variance chips. The entry
   sites are the solo editor's `TimeInput` (`set({ preCallTime })`), the date
   edit, the department default and the day record's time input. Investigate and
   report before proposing.

**Carried forward from the ledgers (read the entries before acting):**

- **The weekend noOT money bug** — `CALC_DECISIONS.md` OPEN since 29 August;
  `MAINTENANCE.md` "LIVE MONEY BUG". The oldest open item and live money.
- **The standalone-invoice bucket row** — a standalone month still has none;
  the founder's records hold zero standalone invoices.
- **Hourly Bectu card rates cannot fill the wizard's rate field** — "Ruling
  needed" in `MAINTENANCE.md`; propose-first.
- **D5 enforcement**, **the dayDefaults fallback to the global default**
  (latent), and **flat penalty lines with no rate** — the rest of the ruling list
  carried from the last handover, unchanged.
- **The trainee device walk** — the eleven APA trainee roles shipped in 2026.11
  and have never been walked; the founder counts nine surfaces (the three
  `roleRegistryFor` call sites feeding the crew editors, the wizard and the
  pickers, plus the rate displays reading `ROLE_DEFAULTS`).
- **Marketing items the founder has not ruled out** — the September rate-label
  markers on `welcome.html` and `how-it-works.html`, and softening the
  Greggs/Leatherman comparators (both in `MAINTENANCE.md`). **Done: Google
  reindexing. Ruled out: Bing.** (Founder, 9 September.)

### Unverified, and to be said plainly

- **The TestFlight debug bucket.** That a TestFlight install writes a receipt
  named `sandboxReceipt` cannot be pinned; `BuildKind.resolve` is executed for
  every combination, the premise is verified by hand or not at all, and it has
  not been.
- **The first release-bucket analytics event.** Nothing can exercise the release
  path before the App Store release; the first real event is the proof. Watch
  for it on launch day; read the dashboard as `count()` over the period, never
  unique users.
- **The dead-controls fault.** The one code-backed hours-long freeze (the JS
  thread parked in a synchronous dialog iOS refused) was removed in `c19e324`,
  and the 4 September watchdog file (a blocked process at graceful termination)
  led to the main-thread and background-task work in `b221db5` and `99886da`.
  Plausible, unproven: no occurrence has been observed since, and the
  discriminating observations for the next one are in the record (clock, scroll,
  web control, picker, bars; the ring's `nav.native`, `render.*`, `lifecycle.*`
  and `webview.TERMINATED` lines).
- **The 5 September reloads were not a fault** — ordinary reclaims of a
  suspended app, no crash files; recorded and corrected.

### Outstanding device verification, named

1. The 2026.12 body as a whole on the phone before submission, and the walks
   owed per record: the reader (Gymshark with Apple Intelligence on shows no
   reference; the live sheet reads DADBOD LTD with six `reader.field` lines), a
   burst of taps then a ring export in order, background then export shows
   `lifecycle.background` / `.done` / `foreground` with the summary, the same
   sheet shared twice into a warm app, Health access off with a counted day, the
   night-wrap edit, the kill-test day's two chips and banners.
2. The trainee-role walk (above).
3. The light-mode chrome check on the iPhone 12.
4. The Live Activity discard-on-midnight fix, device verify pending.
5. Forever Living on the device (the fidelity gap).
6. The three analytics items (debug bucket, marker across a restore, first
   release event).

### What was stale in this document, and what this pass fixed

Rewritten from the repo and the log on 9 September 2026: the release state (2026.11
live → 2026.12 on main, web deployed, store build pending), the unreleased count
(49 → 0; 167 commits between the tags), the analytics section folded into the
shipped list, the reader section replaced by the three gates and the live-sheet
lesson, the open-rulings list re-derived (the very-late-and-curtailed lunch added;
the buyout question stays closed), the 2026.13 and 2026.14 plans added, the three
founder items added, and the lessons extended by the deck and corpus findings.
