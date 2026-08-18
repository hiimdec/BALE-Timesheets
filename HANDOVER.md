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
carries its trigger, its reasoning and, where ruled, its scheduling. Three items
are ruled and queued behind the 2026.11 submission: the three raw-day-record gates
(one item, one device walk), the error-boundary breadcrumb (a schema change — new
key means KEYS warm list), and the **render-smoke audit stage**, which is the next
phase once 2026.11 is away and wants its own proposal.

## Lessons that keep repeating

- **A pin that can't go red is decoration.** Four tautological pins have been
  caught and rewritten here; assume the next one is yours.
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

For the device, from the repo root:

```bash
npx cap copy ios
shasum dist/assets/app.js ios/App/App/public/assets/app.js
```

**The two checksums must match.** The device runs a *separate copy* that goes
stale silently and has already cost one wasted build — `npx cap copy ios` is not
in the gate, so run it and check by hand before every device build.

Check **`assets/app.js`**, not `index.html`. The root `index.html` is the
self-contained source we edit; what `cap copy` puts on the device is
`dist/index.html`, a ~800-line **loader shell** (vendored React, one
`<script src="./assets/app.js">`). All app code lives in `app.js`, so the shell's
checksum is stable by design — comparing shells proves nothing.

Then both schemes:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData build
xcodebuild -project ios/App/App.xcodeproj -scheme TimeMachineWidgetExtension -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData build
```

The repo must stay on a **local volume**, never iCloud Drive — `com.apple.provenance`
breaks codesigning. See `CLAUDE.md`.

## State

The release train on `develop` is **2026.11 (11)** — a date-based scheme whose
minor number tracks the iOS build; nothing in the repo parses a version, every
comparison is string equality. Not pushed; `main` is untouched and still carries
**5.3.0 (9)**, which is what is live on the App Store. 2026.11 carries: the APA
September 2026 terms (grade boundaries 458/696, the card-versioned `apaTerms`
mechanism and the prep-day rewrite with its 8-or-10 booking control), the
day-type-rate route from all three day surfaces to the production setting, a
versionless what's-new, the first-name email sign-off, the home-screen In Progress
rhythm, and earnings that report the **sent invoice** rather than the computed
figure — day claim, attribution index and all five read paths, with a PART
INVOICED marker and a one-time note. Outstanding before submission: the founder's
own device walk, and a glance at App Store Connect's TestFlight list to confirm
build 11 was never uploaded (local evidence says it was not — no archive of 5.5.0
or build 11 exists on this Mac). After it ships: the three parked items above, and
bump `softwareVersion` on the site's homepage node from 5.4.0 to 2026.11, which
tracks the live listing and never `develop`.
