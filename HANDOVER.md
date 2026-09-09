# TimeMachine — handover

The document to read cold. It points; it does not duplicate. **Where this file and
the repo disagree, the repo wins** — verify against the code before acting on
anything here.

`CLAUDE.md` holds the operating rules and is loaded automatically. This file is
the state, the method and the map.

## What the app is

TimeMachine is a pay and timesheet calculator for UK film and TV crew: you enter
call, lunch and wrap, and it works out what the day pays under the relevant
agreement, then turns that into timesheets and invoices. It runs two independent
pay engines — **APA** (commercials, the mature one) and **Pact/Bectu long form**
(scripted TV and film, newer) — chosen per production and fixed for that job's
life. It is a single self-contained `index.html` (React 18 + Tailwind + in-browser
Babel via CDN), deployed to timemachineapp.co.uk by Netlify from `main`, and
wrapped by Capacitor for iOS.

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
- **Report `git diff --stat` before every commit.**
- **Never adjust a pin to make it pass.** A moving pin means a rule leaked. Stop,
  report it with before, after and why, and only then decide. Some movers are
  correct and become *strengthenings* — say so explicitly.
- **A pin that can't go red is decoration.** Negative-test every new pin family
  by mutating the source and confirming the intended pin fails.
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

## Where the documents live

| File | What it is for |
|---|---|
| `CLAUDE.md` | Operating rules, build topology, environment constraints. Auto-loaded. |
| `PACT_BECTU_PLAN.md` | The plan file: long-form roadmap, standing hazards (e.g. the duplicated-gate instances), rulings-in-context, candidate slices. |
| `MAINTENANCE.md` | The parked-work ledger — see below. |
| `CALC_DECISIONS.md` | The calc rulings ledger: every adjudicated pay question, with the clause quoted, the ruling, and its reach. Read before re-litigating any calc behaviour. |
| `APA_RULES.md` | Rule file — APA, authoritative for the commercials engine. |
| `PACT_BECTU_TV_RULES.md` | Rule file — scripted TV. |
| `PACT_BECTU_FILM_RULES.md` | Rule file — film (MMP). |
| `PACT_BECTU_RATE_CARDS.md` | Long-form rate cards and bands. |
| `APA_CREW_TERMS_2026.md` + `APA_2025_TO_2026_CHANGE_LOG.md` | The Sept 2026 APA terms and a clause-by-clause diff against 2025. |

**Source PDFs** at the repo root: `APA RULES.pdf`, `apa-crew-terms-sept-2026.pdf`,
`pact-bectu-scripted-tv-agreement-2023.pdf`,
`pact-bectu-mmp-agreement-as-amended-5-april-2021.pdf`,
`pact-bectu-joint-guidance-8-december-2023.pdf`. The scripted-TV PDF has an **OCR
sidecar**, `pact-bectu-scripted-tv-agreement-2023.ocr.txt` — grep the sidecar, cite
the PDF.

**APA rate cards** are `RATE_CARDS` in `index.html`: effective-dated, resolved by a
production's `startDate`. Cards carry numbers only — with exactly one documented
exception, `terms` (the card-versioned rule set), resolved once at the
`calcForDisplay` call site. A future rule change extends that term set; it never
adds a second mechanism.

## Parked work

`MAINTENANCE.md` is the ledger. Do not restate it here — read it. Everything in it
carries its trigger, its reasoning and, where ruled, its scheduling.

Three items were ruled and queued behind the 2026.11 submission. **Two have since
been built**: the error-boundary breadcrumb (`08e58ed`) and the **render-smoke
audit stage** (`5c19819`, proven against the pre-`f842101` code — the 27 August
render broke with every gate green because nothing in the suite rendered
anything). **One is genuinely still parked**: the three raw-day-record gates,
ruled approved, to land as a single commit with one device walk.

## Lessons that keep repeating

- **A pin that can't go red is decoration.** Four tautological pins have been
  caught and rewritten here; assume the next one is yours.
- **Mutate every clause, not the pin.** A pin with six clauses can pass its
  whole-pin negative test — write it before the feature, watch it go red — and
  still contain clauses that never fire. Ruling 3's seven pins were all proven
  red against the unbuilt code, which felt like proof and wasn't: mutating each
  guard *individually* afterwards found two source lines that no mutation could
  redden. **The whole-pin test proves the pin fires. Only per-clause mutation
  proves each rule inside it does.** Budget for the second pass; it is where the
  findings are.
- **A guard that cannot fail is decoration in the source, not just in the
  suite.** The decoration rule has always been aimed at pins. It applies to
  production code the moment a line is written *as* a guard. Two in Ruling 3,
  both deleted: an ownership `if (owned.length === 0) return []`, unreachable
  because the intersect expression below it already yields an empty set in every
  case it could fire; and a guard-2 `if (inRange.length === 0) return []`, which
  only restated the value the fall-through already returns. Neither changed
  behaviour, and that is the danger — **a line that reads as a guard and enforces
  nothing tells the next reader a rule is held somewhere it isn't.** Delete it
  and pin the behaviour, or make it the only mechanism. Never both.
- **The false-green class: absence of a result reads as a pass.** Third
  instance, third disguise, and the shape this project keeps meeting from new
  directions. Every time, something *failed to produce a verdict* and the
  failure was indistinguishable from success. (1) `| tail` reported tail's exit
  code instead of the check's — a green that meant "tail ran". (2) A parity
  check compared two *missing* files and called them identical — a green that
  meant "nothing to compare". (3) Now: a legitimate mutation crashed the suite
  at `IE4`'s unguarded `Map.get(...).invoiceId`, killing 1,400 assertions
  including the ones under test, and the grep for red lines came back empty — a
  green that meant "the run died". **Ask what a pass would look like if the
  check never ran, and if the answer is "the same", the check cannot report.**
  The defences are all the same defence: verdicts in-band and last (`RESULT:
  GREEN`), existence asserted before equality, assertion *counts* read rather
  than colours, and every fixture access defensive so a mutation yields a red
  assertion instead of taking the run with it.
- **Never anchor a structural pin on copy.** A string's position is a proxy for
  structure, not structure, and the proxy fails both ways. Observed twice, once
  per phase, and both times *loudly*: PT7 anchored the prep-booking control's
  placement on its own label text and went red when a rebuild retired the label;
  IE12 anchored the invoiced-earnings note's placement on the note's heading and
  went red when extracting that note into a shared component moved the string
  above the branch it was ordered against. Neither was a silent pass — but each
  cost a diagnosis on a change that had nothing to do with the rule, and neither
  anchor was measuring the rule in the first place. The silent-pass case is the
  one still waiting to happen: a copy edit that lands the string somewhere that
  *still* satisfies the ordering leaves the pin green and guarding nothing.
  **Anchor on the render condition or the code structure, never on a string a
  copy edit can touch.**
- **A pin whose anchor cannot express the rule it names is decoration that reads
  as correct.** Distinct from a tautology: it *can* go red, just never in the
  direction it was written for. IE12 claimed "not in the empty state" and
  compared source positions against the opening `<div>` of the first empty
  branch — so anything dropped *inside* that branch still sat "after" it and
  passed, and the second empty branch was not covered at all. It looked right and
  it was green for two phases. **Reading the assertion would not have caught it;
  only mutating the source did.** When a pin names a containment rule, check that
  its anchor can actually express containment — an ordering test against an
  opening tag cannot.
- **Verifying on the default path proves nothing when the default is the case
  where the bug is invisible.** The Phase 17 window bug added every claimed
  invoice to every windowed total — a ~£12k tax year read ~£20k. On **All-time**
  the window predicate is the identity, so every invoice is legitimately in
  scope and the figure was exactly right. That is the figure the device pass
  checked, and it was reported as verified. Same shape as the mileage near-miss,
  where the right and the wrong code agreed at the default 50p. **Before
  believing a check, ask which input would distinguish correct from broken —
  and if the default cannot, the default is the one case not worth checking.**
  Pins have the same failure: WIN1 exists because no All-time assertion, however
  strict, could have caught it.
- **A discipline that depends on remembering a step will eventually be skipped.**
  Every check on this project that relied on someone remembering has failed at
  least once: the gate (a commit landed on a red storage pin because
  `| tail` reported tail's exit code), the cap-copy checksum (twice — the second
  cost a week of diagnosing fixes that were never on the phone), and a parity
  check that compared two missing files and called them identical. **If a step
  is load-bearing, it belongs in a command, and that command must be able to
  fail.** `npm run gate` and `npm run ship:ios` exist for exactly this reason —
  and both print their verdict in band, because a step you can skip and a check
  you can pipe away are the same failure.
- **A finding that doesn't become an assertion isn't a finding, it's a note.**
  The sharpest lesson on this project, and it cost the founder a week of wrong
  numbers. The invoice-with-no-day-link double count was *reproduced, measured
  and reported* — "invoice claims no days at all → old £900, new £1,700,
  INFLATED by £800" — one turn before it shipped. It was report-only work, so
  it never became a pin, and the defect went out anyway. **The moment a
  diagnostic reproduces a defect, that diagnostic is a pin — write it as one
  before writing the report.** A finding held only in prose has no way to stop
  the thing it found.
- **Fixtures assert the happy path unless you make them do otherwise.** Every
  money fixture written for the invoice-atomic model gave its invoices
  well-formed `dayKeys`. The founder's real data had **none** — ten of fourteen
  invoices named no days at all, because `dayKeys` was seven days old and the
  `dayBreakdown` it falls back to was fourteen. The fixture was the exact
  inverse of reality and passed fourteen times over. **Every money fixture
  carries at least one broken claim link from here.**
- **Read the assertion COUNT, not just the colour.** A pin placed in a scope
  where its sandbox does not exist *throws*, and the throw kills every
  assertion after it in the file. WIN1 first landed outside the `sb` block: the
  suite reported **1,352 passing against 1,392**, and the gate went red on a
  crash rather than on a failure — which reads as one problem when it is forty
  untested. A red gate always deserves the tail of the output, not just its
  verdict.
- **A screen deciding it has nothing to show, on a test that doesn't cover
  everything it can show.** Three instances now: Phase 14's invoiced note
  shipped inside the empty-state block where it could never render; the crew
  editor that crashed on open behind green pins; and the stats memo returning
  null on `enrichedDays.length === 0`, which hid a tax year holding an invoice
  but no work. Each was a guard written against the *usual* content and blind
  to the rest. **When a surface has an empty state, enumerate everything it can
  render and check the guard admits all of them.** More evidence for the
  render-smoke stage, queued as the next phase after submission.
- **The device finds what pins cannot.** Recent: the grid crew editor crashed on
  open for *seven phases* behind 1,356 green assertions (`cardRoles` out of scope,
  swallowed by the error boundary); the solo day-rate indicator sat on a card the
  solo view hides; the standalone invoice had no back level; a solo header chip
  read the raw day record; the Day rates control was invisible on cascaded-day
  productions; and an invoiced-earnings note was placed in the empty-state block —
  green pins, dead UI. Walk *every* editor an area can reach, not just the one you
  changed.
- **Two enforcement points for one rule share one constant, or they drift.** The
  duplicated-gate hazard is tracked in the plan file; the Phase 8 collapse of six
  crew writers into two helpers exists for the same reason.
- **The suite tests calculation and record construction, and renders nothing.**
  That is exactly why both money bugs were caught and the render bugs were not.
  Until the render-smoke stage lands, a device pass is the only thing standing
  between a broken surface and a green gate.

## Build and device

```bash
npm run gate          # build + all audits; must end RESULT: GREEN
npm run build         # esbuild → dist/ only
```

For the device, from the repo root — **this is the only supported way**:

```bash
npm run ship:ios
```

It builds, runs `npx cap copy ios`, verifies `dist/assets/app.js` against
`ios/App/App/public/assets/app.js`, prints the checksum and `APP_VERSION`, and
opens Xcode. It ends `RESULT: SHIPPED` or `RESULT: FAILED` in band, with an
honest exit code, and it refuses to continue if the two differ.

**Why it exists in one line:** Xcode builds the Swift and reuses whatever
`cap copy` last wrote — it never refreshes the web assets — so building without
the copy ships **old JavaScript in a new wrapper**, with the version string and
build date both looking correct. That has cost two cycles here, the second one a
week long: three fixes to a money bug were green on this Mac while the founder's
phone kept reporting the pre-fix figure.

`--no-open` skips Xcode. `--widget` also compiles the extension scheme, which is
a compile check rather than a shipping step: the App scheme already embeds
`TimeMachineWidgetExtension.appex` into `App.app/PlugIns`, and the widget reads
no web assets at all. `TM_SHIP_VERIFY_ONLY=1` runs the verification alone — it
exists so the check can be proven to fail, since build and copy otherwise
regenerate both files and it could never go red.

Check **`assets/app.js`**, never `index.html`. The root `index.html` is the
self-contained source we edit; what `cap copy` puts on the device is
`dist/index.html`, a ~800-line **loader shell** (vendored React, one
`<script src="./assets/app.js">`). All app code lives in `app.js`, so the shell's
checksum is stable by design — comparing shells proves nothing.

For CI or a verification pass, both schemes still build directly:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData build
xcodebuild -project ios/App/App.xcodeproj -scheme TimeMachineWidgetExtension -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData build
```

The repo must stay on a **local volume**, never iCloud Drive — `com.apple.provenance`
breaks codesigning. See `CLAUDE.md`.

## State

### Where the release stands

**LIVE: 2026.11 (11).** Approved by Apple, on the App Store, and — because
Netlify deploys from `main` — on timemachineapp.co.uk too. `main` is
`b649d5f`; the site's `softwareVersion` (`home-preview.html`, the `#software`
node) reads 2026.11 and tracks the live listing, never `develop`. Tags:
`v2026.11` marks the archived uploaded build (`ab583a8`); `v5.4.0` the last
pre-2026.11 release.

**UNRELEASED: 49 commits on `develop` past the 2026.11 merge (`45a6a06`),
shipped NOWHERE.** Not on the App Store, not on the website, not on the
founder's phone except where a device walk put a build there. **2026.12 has no
release date.** Treat "it's on develop" as "nobody outside this machine has
seen it". `develop` is `main` + 49 and **0 behind**; nothing has been pushed.

`APP_VERSION` in `index.html` still reads 2026.11: the bump is a release-time
step, not a development one.

**Two things gate the 2026.12 submission, both recorded in `MAINTENANCE.md`:**
the release-time verifications D/F/G/H (what each looks like if wrong), and
the App Store Connect edits — both listing lines and the privacy nutrition
label changing to Product Interaction, not linked, not tracking. Neither can
be made from the repo.

### What landed since 2026.11, by feature

- **The stats money round** (`32e0804` → `03c8896`, then the device-review
  commits `29cc15b`, `720c668`, `c0f10ee`, `88deeff`). One money enumerator
  behind every surface, then the rulings deleted its options one at a time
  (D1, D2, D3, D4, D7, the shortfall by subtraction, the three numbers, month
  attribution, tax year to date). The device review found the composed hole
  and produced **THE IDENTITY**: on every filter and both bases the headline
  *is* the sum of the month rows, pinned executable under each basis. Then:
  the toggle owns the top card only, and VAT (D6).
- **Buyouts** (`8cb66b7`); **the shared text timesheet** (`c2653b1`, golden
  fixtures on a surface that had none); **the Live Activity ingest push seam**
  (`6f504c8`, SEAM1–8); **diagnostics and the render-smoke stage** (`b9874dd`,
  `a6aba9b`, `08e58ed`, `5c19819`); **the carousel, anchor and nav fixes**
  (`f842101` is the 27 August blank-shoot-page fix; `6b1af08` keys shoot pages
  on `openId`); **forced dark mode** (`df32d1e`).
- **The web publish change** (`c21c8aa`, `c87015b`, `20c6bb7`, `ebebac6`).
  The site now publishes the BUILT app (`dist/` under `/app/`): 5.4 MB → 2 MB,
  two external hosts → zero, so the privacy page's "no other company sees your
  IP address" became true. `audit:publish` (static, subresources) and
  `audit:web` clause 7 (six network APIs spied at boot) guard it. **Netlify
  has never run `npm run build`** — see verification F.
- **The dayDefaults agreement guard** (`9be7ae5`). A live money bug: one crew
  member's override re-priced a whole date for the untouched crew. Fixed in
  `migrateProduction`; MG1–MG7 pins; the founder's data was immune.
- **Anonymous usage analytics** — see the next section. Built end to end in
  one day, then corrected three times by device and review findings.
- **The pattern-primary call-sheet reader** — four of four commits built, plus
  the post-ungating round. See the section after.

### ANALYTICS — built, corrected, and STOPPED until on a device

**What it is.** Aptabase, EU-hosted, iOS only; the web build is incapable of
sending by two independent mechanisms (`IS_NATIVE` bail, key resolves empty).
Opt-out with a home-screen notice that offers both choices and cannot be
dismissed without deciding; the permanent switch is Settings → Privacy.
Fourteen events in a frozen allow-list (`ANALYTICS_EVENTS`), and — the
centrepiece — a frozen **value** allow-list: no user text or figure can
physically reach the wire. Nine events are once-ever (thresholds), five are
every-time (actions), and AN30 pins that the two halves partition the list.

**Where the truth lives.** `trackEvent` (the only network seam, `index.html`),
`trackOnce` (the once-ever door, writing `userPrefs.analyticsSent` — names
only, only on a 2xx), `analyticsMilestones` (the derived survey),
`BuildInfoPlugin.swift` + `BuildKind.swift` (native truth for debug vs
release; TestFlight folds into debug; fails toward debug). Pins AN1–AN33 in
`storage-test.js`; the BuildKind cases run through swiftc in `audit:native`.

**The three corrections, in order, each caught by the founder or the review
and not by any pin:** milestones fired once per *launch* on the reasoning that
the service deduplicated — it structurally cannot (per-date purged salt; no
per-event unique-user metric), so they now fire once ever, persisted
(`e96708d`); retention was anchored on the earliest *work* date, so a new user
backfilling an old job fired `retained_30` on first launch — it is anchored
on `firstRunAt` now, with no fallback (`7d6265c`); and the wrapper reported
success on any HTTP status, so a quota hit would have marked milestones as
sent for ever — only 2xx counts now, and a failure leaves the marker alone
(`22b90ca`, with the shoot filter, the true copy, and calendar-bucket
retention: week 2 = days 7–13, month 2 = days 30–59).

**Read the dashboard as `count()` over the period**, never unique users —
`MAINTENANCE.md` has the citations. **Retention will read low for freelance
crew and that is the definition working** — also recorded there.

**What is NOT proven:** that a TestFlight install writes `sandboxReceipt`
(un-pinnable, device only); that the marker survives a real new-phone
restore (fixture only; the one device test was a false negative — stale
build, old backup); that the release bucket receives anything (first App
Store event is the proof). All three are on the device-walk list.

### THE CALL-SHEET READER — four of four commits built, then the device round

The reader no longer requires Apple Intelligence. `CallSheetPipeline` is
ungated (`9b7ce40`); the `@available(iOS 26)` annotation sits on exactly the
four model-touching members, and the Xcode target builds against the iOS 15
deployment target — the proof that nothing else needed 26. Patterns run on
every device; the model folds in where it exists, bounded to **12 seconds and
three pages** when no page mentions invoicing (`83eae87`). Byte-identity for
a verified model value (`resolveField`) is unchanged and mechanically proven.

The four commits: the pure harvest core (`9e74849`), the wiring with
model-verified-never-displaced (`1499e90`), the ungating with rulings 3 and 4
(`9b7ce40`), and rulings 1 and 2 worded in plus phase-two assertions against
the founder's expectations file (`7e39efb`). Before them, the masthead fix
(`7334536`) and the corpus moved outside the public repo (`0f85afc`).

**The device round (founder, on a 15 Pro) found that two pinned fixes did
not reach the device — and the cause was not the extractor.** On the model
path a *verified* model value stood untouched, so the stripper only ever ran
on the pattern path. Ruling: **cleaning is not sourcing** — `cleanTitle` /
`cleanRef` now apply to whatever wins (`83eae87`). Same commit: `title:`
outranks `production title:`, `production:` and `client:` (four sheets
change, three of which had been showing the client); the numeric-pair
collapse is deleted; the Comet masthead needed three rules; and **guard C** —
two or more quoted strings is a list, and a list is not a title — keeps M&S
at "MARKS & SPENCER" (founder overruled the fifth change). The nine masthead
fixtures now also assert on PDFKit lines in corpus mode (`TITLE-PIN`, 15
sheets): Comet was the one passing on lines the device never saw.

**Three pre-existing UI bugs were exposed by the ungating and fixed
(`6652017`):** Root rendered app-level screens over an open production, so a
share-in over Settings mounted the reader beneath it; the once-only import
effect never re-fired for the already-open production; sheet z-slots were
frozen at open. All predate 2026.11.

**Owed:** the founder's review of `expected.draft.txt` (phase two asserts
against nothing until he has), and the device walk — simulator first (no
Apple Intelligence, so it exercises the iPhone 12 path), then the 12, then
the 15 Pro confirming nothing regressed. DFS "address returns the sentence"
is recorded as not-a-fault: select-on-sheet returns the OCR line.

### THE CORPUS — one copy, no backup, and every call-sheet pin depends on it

Twenty real call sheets live at **`~/Developer/tm-callsheets/`**, outside the
repo because the repo is **public on GitHub** — history is permanent, so a
committed original could never be unpublished. `.gitignore` carries
belt-and-braces patterns; the audit stage reads them in place and **skips
loudly** when they are absent (a machine without them stays green, visibly
differently).

**This is a risk, not a note.** Those twenty PDFs (~28 MB) exist in exactly one
place, on one Mac, with no backup and no copy in any repo. Every lexicon in
`CallSheetHarvest.swift` was measured against them, the address-reach gate
(16/20) was measured against them, and the coverage report re-measures them on
every gate run. **If that folder is lost, the measurements cannot be reproduced
and the pins lose their justification** — the fixture pins would still pass,
because they are sanitized and committed, but nothing could re-derive whether the
lexicons still match reality. Backing it up somewhere private is unfinished
business, and it is the founder's call where.

**`expected.draft.txt` sits in that folder awaiting the founder's review.** The
harness generated it — one block per sheet, prefilled with what the harvests
found. Confirming it is what **breaks the circularity**: without a human-checked
ground truth, phase two would assert the harvests against their own output, which
proves only that the code is consistent with itself. The review is needed once,
and it is deliberately cheap — most fields arrive prefilled, the four sheets with
no job reference arrive marked `(none)`, and the work is confirming roughly ten
to twenty lines across the whole corpus rather than typing 120.

### Known limitations, discovered by measurement

- **InRehearsal is a Comet-class sheet on-device.** Its text layer decodes
  *worse* under PDFKit — the decoder the app actually uses — than under the pdfjs
  tooling: font damage **deletes** characters (3,887 vs 4,628), the invoicing
  section does not survive, and every harvest comes back empty. Vision OCR never
  rescues it because `loadPages` trusts any text layer over 40 chars per page —
  the layer is big, just wrong — and **the weak-page banner cannot fire**,
  because it keys on OCR confidence and OCR never runs. A detector is named in
  `MAINTENANCE.md` (render page 1, OCR it, compare against the layer) and
  deliberately not built.
- **Four sheets are pattern-unresolvable for prodCo** — Umberto Giannini, Nike
  Vision, InRehearsal, Everlast — plus Forever Living and Project Comet, which
  have nothing to find. That set is precisely the model's remaining value on
  eligible devices, and the honest floor on every other iPhone.
- **The corpus is one working life.** UK commercials, APA world, mostly
  agency/prodco exports. No long-form or scripted-TV sheets, no non-UK
  productions (the postcode anchor fails by design there), no US-agency formats,
  and no sheet whose invoicing details live in a separate attached document. Any
  claim about those populations is extrapolation.

### Open rulings awaiting the founder

Derived from the ledgers, not from memory — read the entries before acting.

**The definitive list, six items, swept from both ledgers on 2026-09-01 and
re-verified on 2026-09-02** — the dayDefaults *promotion* bug left this list the
same day it was proven: it is fixed, and recorded in `MAINTENANCE.md` as a live
money bug rather than a design question. Its second defect took its place.
Everything else in them is ruled — including D1–D7, D9 and D10, all ruled and
implemented. (**"D8" never existed**: a numbering slip, investigated and
deleted — see the ledger note, and do not re-open the hunt.)

1. **The weekend noOT money bug** — `CALC_DECISIONS.md` "noOT vs weekend
   overtime (§4.4, §4.6): **OPEN — NOT YET RULED**"; `MAINTENANCE.md` "LIVE
   MONEY BUG". Witnessed at NOOT5–7 in calc-boundary, found by the suite's first
   Saturday run. *Undecided: whether §4.4/§4.6 weekend overtime is suppressed at
   all for a noOT role, and what a noOT Saturday or Sunday actually pays.* **Live
   money, and the oldest open item here.**
2. **D5 enforcement** — every send path already stamps `dateSent`. *Undecided:
   whether to enforce it (a migration stamp, or a hard invariant) or leave the
   defensive guards for legacy and hand-edited records.*
3. **The standalone-invoice bucket row** — a standalone month still has none.
   *Undecided: what it should show.* Unexercised by real data: the founder's
   records hold zero standalone invoices. (This is the narrow survivor of the
   buyout-presentation question, which is **closed** — `720c668` built the
   first-class Buyout row.)
4. **The dayDefaults fallback to the GLOBAL default** rather than the
   production's own `defaultDay` — the second defect found while proving the
   promotion bug. **Latent, not live**: `defaultDay` is seeded from the global
   constant at every creation site and no UI can change it, so the two are
   always identical today. *Undecided: whether to fix the fallback now or make
   it a precondition of any future "set this job's standard times" feature —
   which is the day it arms itself* (measured: £700.00 → £600.00, under-claiming
   £100 on a manufactured 07:00/13:00 production).
5. **Hourly Bectu card rates cannot fill the wizard's rate field**
   (`MAINTENANCE.md`, "Ruling needed"). *Undecided: what the wizard offers when
   the card's rate is hourly and the field wants a day rate.* Propose-first
   before any code.
6. **Flat penalty lines carry no rate, so their working cannot be shown**
   (`MAINTENANCE.md`, "Known gap"). *Undecided: what an invoice shows for a flat
   penalty with no rate × quantity behind it.* Money-surface display, so it needs
   a ruling rather than a patch.

Adjacent, and **not** open rulings — listed because they read like ones: the
**equipment-hire base-to-base exclusion** is `DEFERRED — RECORDED` (ruled to
defer, not undecided); the **three raw day-record gates** are ruled approved and
merely unbuilt; **VAT (D6)** is ruled and built but *entirely unexercised by real
data* — the founder is not VAT-registered, so the VT fixtures are its only
witness.

### Outstanding device verification, named

1. **The call-sheet walk, all three targets** — simulator first (no Apple
   Intelligence: the exact iPhone 12 path), then the 12, then the 15 Pro
   confirming the byte-identity promise held in the field. The 15 Pro round of
   2026-09-01 found the cleaning gap; the fixes since have not been on a device.
   Plus the analytics device items: TestFlight → debug bucket, the marker
   across a real restore, the first release-bucket event.
2. **The light-mode chrome check on the iPhone 12** — set the phone to light
   mode and confirm the search/settings pill, the create button and the tab bar
   all render dark, and that a share sheet comes up dark.
3. **The trainee-role walk** — the eleven APA trainee roles shipped to the
   website ahead of the store build and have never been walked on a device.
   Every surface that reads `roleRegistryFor` (three call sites, feeding the
   crew editors, the wizard and the pickers) plus the rate displays that read
   `ROLE_DEFAULTS` should be walked once: create a crew member on each trainee
   role, confirm £250/1.5× and that no department attribution reads back wrong.
4. **The Live Activity discard-on-midnight fix** — `MAINTENANCE.md` records it
   FIXED by ruling with **device verify pending**.
5. **The raw day-record gates** — parked, ruled approved, and when built they
   carry one device walk covering `CrewMemberDayView` and `DayBreakdownView`.
6. **Every commit since 27 August**, collectively. The stats round, the buyout,
   the timesheet text and the LA seam have had partial device review at best, and
   several were device-reviewed mid-round rather than after the round closed.
   Before any 2026.12 submission, the whole unreleased body needs a walk.

### What was stale in this document, and what I fixed

**2026-09-01 pass (third).** Three things, all derived from `git log` and the
files rather than from the session: the document had **no analytics section**
while nine analytics commits sat on `develop`; the call-sheet section said the
reader **"currently requires Apple Intelligence"** and that **two of four**
commits were built — all four are, plus a device round and a UI round; and the
commit count was 29 (now 49). The outstanding-device list's first item pointed
at commit 2. All rewritten above.

The last two handover corrections both found real drift; the one before this found six, and a follow-up sweep found two more.

1. **"`develop` and `main` now hold the same work"** — false since 27 August.
   `develop` is 29 commits ahead. Rewritten.
2. **"The stats money redesign … Not built."** — it is built, in eleven commits,
   and its rulings are in `CALC_DECISIONS.md`. Rewritten.
3. **"The shoot-page render failure … No fix proposed yet."** — it was diagnosed
   and fixed in `f842101` (the carousel's unresolved-slot offset). Rewritten.
4. **The parked-work section** said the boundary breadcrumb and the render-smoke
   stage were unbuilt. Both shipped (`08e58ed`, `5c19819`). `MAINTENANCE.md` was
   stale the same way and now carries BUILT lines on both entries. The third
   parked item — the raw day-record gates — is genuinely still parked.
5. **`CALC_DECISIONS.md`'s "Invoices tab — the two count sites total
   differently: OBSERVED — UNRULED"** — resolved by the composed-hole commit
   (`c0f10ee`, both sites now total through `invoiceCurrentTotal`) but its
   heading still said UNRULED. Corrected in place.

7. **"How a buyout month presents" was carried as open and is closed.** The
   line was written in `29cc15b`; the very next commit `720c668` ruled and built
   it (buyout-covered days leave the ordinary buckets, a first-class Buyout row
   carries the invoice net, rows sum to the amount — pinned SM7d, rendered at the
   bucket-row list in `index.html`). The forward-reference was never struck
   through. Same class as the drift below and the fourth instance of it: **a
   "this is its own ruling" line written one commit before the ruling lands
   reads as open forever unless someone closes it.** Both the ledger line and
   this list are now closed against the build.
8. **"D8" was carried as an open item and does not exist.** The first pass of
   this handover reported it as undefined-but-open. A full-history search
   (`git log -S` across every commit, both ledgers and every other file) then
   found exactly two real occurrences, both in `c7bf73c` — the ledger's summary
   line and its own commit message; every other apparent hit is a pbxproj UUID
   containing those characters. D1–D7 were enumerated together and D9/D10 were
   found later during the build, so the summary reached for the next free number
   and D8 was never defined. **Founder-ruled: delete it** — a ledger entry saying
   "there is an unruled decision and nobody knows what it is" is worse than no
   entry. The line is gone, and the finding is recorded in one place so the hunt
   is not re-opened.
