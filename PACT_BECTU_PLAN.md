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
- **Consecutive day counting:** a worked day advances the count, a travel day
  neither advances nor breaks it (TV §8.10; Film §4.4), a day off breaks it and
  resets to zero. **Turnaround days hold the run like travel** (ruled Phase 2d):
  a turnaround day is paid at the daily rate as compensation for a night block,
  so it is a paid engaged day, not a day off — the same distinction the APA
  side draws between a Rest Day and a Day off. An absent calendar day (no
  record at all) breaks the run. Computed by `consecutiveRunFor`, a pure
  read-time selector — never stored, because the run crosses week boundaries.
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

## Still open (claim-and-flag applies)

The live inference list is in the Phase 1b proposal record; headline items the
engine must flag when they bite: TV travel day skip-vs-reset on the consecutive
run (§8.10 states only "do not count"); **turnaround days holding (not
breaking) the run** — an inference from their paid-engaged character, ruled
Phase 2d, neither agreement states it for the count; film prep/wrap 30+30 vs
the OT clock (§3.2(a)); film camera OT 4th hour+ non-pro-rating (§3.3(a)(i));
the §7.11 beyond-cap CWD camera OT rate ("agreed locally" — flag, never
price); the called-camera-OT window banding across 23:00 (§7.6 × §7.10(a)).
