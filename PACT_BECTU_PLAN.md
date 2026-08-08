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

Filename note: the guidance PDF circulated misnamed as
`Pact-Bectu-Scripted-TV-Agreement-12-December-2022.pdf`. Each file above was
identified by CONTENT (page-1 render / text extraction), not by its filename,
and named for what it actually contains. Do the same for any future document.

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
  resets to zero.
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

## Still open (claim-and-flag applies)

The live inference list is in the Phase 1b proposal record; headline items the
engine must flag when they bite: TV travel day skip-vs-reset on the consecutive
run (§8.10 states only "do not count"); film prep/wrap 30+30 vs the OT clock
(§3.2(a)); film camera OT 4th hour+ non-pro-rating (§3.3(a)(i)); the §7.11
beyond-cap CWD camera OT rate ("agreed locally" — flag, never price); the
called-camera-OT window banding across 23:00 (§7.6 × §7.10(a)).
