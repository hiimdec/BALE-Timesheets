# Pact/Bectu long form — the plan and the rulings

The rulebooks hold the rules; this file holds the decisions. Where this file and
a rulebook disagree on what an agreement says, the rulebook wins. Where it
records a founder ruling, the ruling stands until the founder reverses it here.

## Source documents (repo root)

| File | What it is |
|---|---|
| `PACT_BECTU_TV_RULES.md` | Markdown rebuild of the Scripted TV agreement + folded-in Joint Guidance |
| `PACT_BECTU_FILM_RULES.md` | Markdown rebuild of the MMP (film) agreement |
| `pact-bectu-scripted-tv-agreement-2023.pdf` | The signed Scripted TV Agreement, effective 1 January 2023 (28pp, image scan) |
| `pact-bectu-mmp-agreement-as-amended-5-april-2021.pdf` | The MMP Agreement as amended 5 April 2021 (doc ref 11186226-5) |
| `pact-bectu-joint-guidance-8-december-2023.pdf` | The Joint Pact/Bectu Guidance, issued 8 December 2023 |
| `pact-bectu-scripted-tv-agreement-2023.ocr.txt` | OCR sidecar of the TV agreement scan (Vision, accurate mode, all 28 pages) |

Filename note: the guidance PDF circulated misnamed as
`Pact-Bectu-Scripted-TV-Agreement-12-December-2022.pdf`. Each file above was
identified by CONTENT (page-1 render / text extraction), not by its filename,
and named for what it actually contains. Do the same for any future document.

OCR note: the TV agreement PDF is an image-only scan with no text layer, so
the `.ocr.txt` sidecar carries its machine-readable text (Apple Vision,
accurate mode, page markers preserved). `PACT_BECTU_TV_RULES.md` is therefore
now VERIFIABLE against the source rather than authoritative on its own; where
the rebuild and the sidecar disagree, check the scan itself — OCR can misread,
but it cannot invent a clause.

## Architecture rulings

- **Agreement is chosen at production creation and is immutable.** Absent means
  APA: the `agreement` key only ever exists on long form productions, is never
  written by `migrateProduction`, and is read everywhere through
  `agreementOf(p)` (`p?.agreement ?? 'apa'`), evaluated at read time and
  persisted never.
- **One version stamp, on the production.** `agreementVersion` is resolved from
  the principal photography start date at creation and stamped once. A deal memo
  fixes the terms for the life of the job: a mid-shoot table amendment must not
  change money. No version fields on weeks. Recommended rates are autofill only
  and have no calc role.
- **Week boundary** defaults Monday–Sunday, overridable per job, and locks once
  any week in that job has been invoiced.
- **Long form jobs live in the main Productions list** under a pinned
  "In progress" group, falling into normal month grouping when marked wrapped.
  The week layer is one level down.
- **One engine, two data rows. Not two engines.** The camera/non-camera OT split
  (film) and the ACH (TV) are switches in the ruleset table. No agreement id
  literals in the engine body — pinned.
- **Dispatch at the long form entry point**, not by field-absence checks
  scattered across surfaces. Field absence (no `callTime` on a long form day, no
  `preCallTime` ever) remains as a second safety net, not the primary guard.
- **Everything derivable is derived.** Only genuine human elections become
  toggles: comp rest vs payment on TV night work (§5.3), prior written approval
  on non-shooting sixth days (§2.3(b)), and the sixth/seventh day override
  below.
- **Consecutive day counting:** a working day (shoot, prep or pre-light —
  §2.5 reaches non-shooting days) advances the count, a travel day neither
  advances nor breaks it (TV §8.10; Film §4.4), rest days and days off break
  it and reset to zero. **Turnaround days hold the run like travel** (ruled
  Phase 2d): a paid engaged day, not a day off. An absent calendar day (no
  record at all) breaks the run — **ruled Phase 3c: the plain gap reset
  stands**; the surfacing proposal ("no record for Thu 14 - if you worked it,
  Sunday is a sixth day") was DROPPED, because nobody invoices a week they
  haven't finished filling in. Computed by `consecutiveRunFor`, a pure
  read-time selector — never stored, because the run crosses week boundaries.
- **Day type and day shape are two fields** (ruled Phase 3c): SWD/SCWD/CWD
  describe how the day is broken; shoot/prep/pre-light describe the work.
  The shape shows on working types only and IS the lunch. §1.5/§2.3(b)
  derive from the type. Non-shooting SCWD/CWD read as the exception they are
  (TV §1.5(c)), signalled inline, never nagged.
- **Record definition, not an agreement inference** (blessed Phase 3d):
  `rest` means ENGAGED but not working, so bank holiday pay can attach
  (TV §11.3 Band 4 / Film §5.6(a)); `dayOff` means NOT ENGAGED, so it
  cannot. The same distinction the APA side draws between a Rest Day and a
  Day off.
- **Turnaround days are suggestion-only** (ruled Phase 3c): the app may
  notice a night run has ended and OFFER a turnaround day; it must never
  insert one. An accepted suggestion claims 1T and, on TV, flags that the
  mechanism is film's (§5.3 settles TV nights weekly).
- **The stored rate is the Basic Daily Rate** (ruled Phase 3c): §1.4(a) keys
  everything off BDR ÷ 10, so BDR is the primitive and it is on the user's
  paper (§1.4(c)). The §1.3 departments see the derived Total Daily Rate on
  screen to check against the deal memo. £250 is the starting figure —
  the agreement's own example — freely editable. Long form roles are
  freeform with the list as suggestions plus per-department Trainee grades.
- **Bank holidays resolve by NATION SET from the production base**
  (Guidance §11.4, landed Phase 3c): composed core + nation entries, never
  England-plus-extras, verified against gov.uk and pinned in both
  directions (LF12). `UK_BANK_HOLIDAYS`/`isBankHoliday` stay the APA
  engine's, byte-untouched.
- **Where a rule is unresolved, the app CLAIMS the money and FLAGS the
  assumption.** It never silently under-claims. Applies to every open inference.
- **Sixth and seventh days are flagged and overridable** down to a normal day
  rate, one tap, control on the day and surfaced in the week view.
- **Editing a day in an invoiced week is allowed.** The sent invoice stays
  frozen (the existing snapshot mechanism), the live week diverges, the user
  resends. The week view shows the divergence.
- **PAYE users are supported for tracking gross only.** No deductions, no
  holiday pay, no pension. The app never models net pay.

## Resolved inferences — recorded so nobody reopens them

- **TV CWD overtime starts at 9 hours elapsed from individual call; film CWD at
  10.** Founder confirmed against practice (the rulebooks' Appendix B item 1 in
  each: no worked example demonstrates the non-SWD triggers).
- **Night work weekly cap "one working day" = 10 hours** (TV Section D
  Example 1: 15h, 12h and 10h all resolve to one rest day).
- **Night work accrues on scheduled shooting hours only** (TV Example 3: the
  unscheduled de-rig overrun is 2T overtime, not night work).
- **Broken turnaround and night work enhancements are uncapped** (TV §1.9(c)
  exempts Early Call explicitly; §7.13 reaches only Overtime and OT-rate
  penalties, which neither enhancement is).
- **The 30 mile time / 25 mile cost asymmetry in TV §8.3(a) is correct as
  printed** and must not be "fixed".

## The leak sweep — a REPEATING step, not a one-off

Phase 2b's sweep enumerated every surface that assumes "every production is
APA" (invoice creation, share links, the call sheet chooser, the hero card's
lunch/wrap writes, Siri/Live Activity ingest, widgets, duplicate, backup
restore, day-defaults cascade) and classified each: unreachable, dispatches
correctly, refuses loudly, or silently writes/drops. The ruled fixes are
list-presentation gates through `agreementOf`, not scattered surface checks.

The sweep must RE-RUN after every slice that adds a long form data type.
Items found latent (the hero card's `currentShoot` write path and the
`setActiveShoot` → Siri "log my times" ingest) are latent only because long
form day records do not exist yet — each new data type (days, weeks, week
invoices) arms a fresh set of APA surfaces against that same assumption.
Sweep output is a report with proposed fixes; the founder rules before
anything is gated.

The sweep has TWO DISTINCT CLASSES, and they need different hunting:

- **Entry points** — a long form record reaches an APA screen (the invoice
  picker, the call sheet chooser, share senders, the hero card, the Siri
  snapshot). Found by walking navigation and event routes; fixed with
  `agreementOf` list gates at the point of presentation or selection.
- **Aggregates** — APA code iterates EVERY production and silently absorbs
  long form data (productionTotals/TotalsFull/Hours/OTHours, the StatsScreen
  enrichment loop). These route nowhere visible when they arm, so they only
  surface by grepping the `calcForDisplay` / `resolveDay` call sites and
  checking each iterating caller for an agreement gate.

Both classes RE-ARM when the engine lands and long form days start carrying
money: entry points because long form £ becomes meaningful to show and must
come from the right engine, aggregates because a long form total silently
joining an APA rollup stops being £0 noise and becomes a wrong number.

## Still open (claim-and-flag applies)

The live inference list is in the Phase 1b proposal record; headline items the
engine must flag when they bite: TV travel day skip-vs-reset on the consecutive
run (§8.10 states only "do not count"); **turnaround days holding (not
breaking) the run** — an inference from their paid-engaged character, ruled
Phase 2d, neither agreement states it for the count; film prep/wrap 30+30 vs
the OT clock (§3.2(a)); film camera OT 4th hour+ non-pro-rating (§3.3(a)(i));
the §7.11 beyond-cap CWD camera OT rate ("agreed locally" — flag, never
price); the called-camera-OT window banding across 23:00 (§7.6 × §7.10(a)).
