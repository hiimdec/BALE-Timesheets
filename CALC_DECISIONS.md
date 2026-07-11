# CALC_DECISIONS — rulings ledger for the calc engine

The 2026-07 adversarial calc audit split its findings in two. The confirmed
boundary bugs were FIXED first (TIME_EPS floating-point guard, curtailed-
lunch double-pay on hourly structures, Sunday/BH triple gated to OT). The
judgement calls below were then **adjudicated by Derrick on 2026-07-12
against the actual APA Recommended Terms PDF** (`APA RULES.pdf`, repo root —
effective 1 Sept 2025), and the approved corrections implemented on
`fix/calc-audit` with expected-£ pins in
`scripts/build-vs-source-audit/calc-boundary-assertions.js`. Status per
item: **RESOLVED — IMPLEMENTED**, **RESOLVED — KEEP**, **DEFERRED**, or
backlog. Every resolved entry quotes its PDF citation.

> **Editorial note:** APA_RULES.md (the markdown reconstruction) carried
> contradictions the PDF resolves — §2.1.5 vs §2.2.2/§2.2.5 (basic night vs
> continuous night: BOTH are real, distinct day types), §2.1.3's boilerplate
> Mon–Fri opener vs its explicit "Early call rule applies on all days
> throughout a week, Monday to Sunday" sentence (the sentence governs), and
> §6.2's night-row amount (the first break is one hour, so 1h — the cheat
> sheet's "30m" conflated it with the second break). APA_RULES.md still
> needs that editorial pass so the reconstruction matches the PDF and the
> engine; until then the PDF is the only authority.

All £ figures use a grade I £444 BDR (BHR £44.40, OT £66.60, 2× £88.80,
3× £133.20) unless stated; impacts scale linearly with BDR.

---

## A4 — Night missed-break charges: **RESOLVED — IMPLEMENTED** (Derrick, 2026-07-12)

**PDF citations.** §6.2: *"Your first break of one hour will begin no more
than 5½ hours after work has commenced"* and its night row: *"If Missed on a
night shoot — Missed break on a night shoot is charged at basic hourly
rate."* §6.3: second break is half an hour, identical night row. The break
durations settle the amounts: the first break's charge covers 1 hour, the
second's 30 minutes.

**Ruling on the rate.** Derrick rules all break penalties on nights charge
at the prevailing **2× BHR** — a deliberate crew-favourable choice, uniform
across the 1st-break, 2nd-break and CWD-break charges, because the night day
operates at double time. **This exceeds the literal single-rate reading**:
the PDF's night rows say "basic hourly rate", and its own §2.2.2 night-CWD
example prices the missed 30m break at £39 = single BHR for a £785 1st AD.
Recorded here explicitly as a chosen generosity, not an oversight, so it is
defensible if a producer queries an invoice against the literal terms.

**Implemented.** New line "Missed 1st Break (night)": 1h × 2× BHR (£88.80
@£444), gated on `lunchMissed` (a very-late-but-taken break converts the day
via §6.2 **without** this charge — pinned). It stacks with the B1
continuous-night conversion per the ruling (separate concerns: pay structure
vs missed-break charge). The missed/late 2nd break on nights stays at
30m × 2× BHR (unchanged, now pinned as deliberate).

**Nuance recorded for future reference:** the app cannot distinguish a day
*booked* as a continuous night (where no first break was ever scheduled —
the shape of the PDF's £1,727 example, which carries no missed-break charge)
from a night whose break was *missed*; `lunchMissed` is the only signal, so
every no-lunch night carries the charge. Crew-favourable; if a producer
disputes a booked-CWD night, the charge line is the item to discuss (a
"booked CWD" flag would be the carve-out if ever needed).

Probe delta: H06 £1,028.70 → £1,117.50. Pins: S19–S20 + stageA4
(5 assertions), B1 pins re-anchored at line level (structure unchanged).

---

## B1 — Continuous nights: **RESOLVED — IMPLEMENTED** (Derrick, 2026-07-12)

**Ruling.** §2.2.2/§2.2.5 govern a night that runs continuous; §2.1.5's flat
model governs basic (non-continuous) nights. Implemented on `fix/calc-audit`.

**PDF citations (authoritative source, re-spaced from the letter-spaced
extraction).** §2.2.2: *"If your call time is before 5 a.m. and the day is a
Continuous Working Day, we will pay you double basic daily rate. … Overtime
will apply after 9 hours from the call time and is charged at double basic
hourly rate."* §2.2.5: same structure for 5 p.m.–5 a.m. calls ("The day
includes 9 hours in total."). Decisively, the PDF's own §2.2.2 worked
example prices a 1st AD (£785), call 03:00 wrap 13:00, as **1×£1,570 (2×BDR
covering 03:00–12:00) + 1×£157 (OT hour) = £1,727** — OT meters from hour
NINE. (My earlier table here said the models "coincide up to 10h" — wrong:
the divergence ramps from 9h and holds at 1h × 2×BHR from 10h on.)

**Implemented.** Night branch: when `continuousDay` (the §6.2-conversion
flag — first break missed or started past 6.5h) AND the call date is a
weekday, pay `2×BDR + ceilHalf(max(0, wrap − (call + 9h))) × 2×BHR` —
clock-based, no lunch deduction (mirrors the weekday CWD), no triple after
midnight (clause prices night-CWD OT at 2×BHR; §2.1.5's no-triple covers
night engagements), no separate min-10h (2×BDR ≡ the old 10h floor, so ≤9h
days are payout-identical). Basic nights stay flat (pinned, no regression).
**Weekend/BH nights stay flat** per the explicit §2.4(iii)/(iv) night rows —
§2.2.2/§2.2.5 carry the Mon–Fri opener with no all-days override (unlike
§2.1.3). Engine's PDF-example output verified: **£1,727 exactly**.

Probe-scenario deltas (their old values embedded the under-payment): F01
£932.40 → £1,021.20; H06 £939.90 → £1,028.70 (before A4's separate charge).
Pins: S14–S17 + stageB1 (7 assertions incl. the PDF example to the pound).

## §2.4(vi) — Sunday/BH continuous days: **RESOLVED — IMPLEMENTED** (Derrick, 2026-07-12)

Surfaced during the PDF confirmation pass (was not in the original audit —
the audit had checked the Sunday CWD against the hourly model, not §2.4(vi)).

**PDF citation.** §2.4(vi): *"Continuous Working Day if on Sundays, Bank
Holidays and Statutory Holidays means you will be paid at two times your
basic daily rate. Overtime commences after 9 hours from the call time. For
each overtime hour, you will get paid double your basic hourly (2xBHR)
rate."*

**Implemented.** Sunday/BH Shoot arm: when `continuousDay`, pay
`2×BDR + OT after 9h from call at 2×BHR`, clock-based, with §4.7's
after-midnight OT at triple retained via the A3 OT-gated split. ≤9h
continuous days pay 2×BDR ≡ the old hourly min-10h floor (payout-identical).
Saturday §2.4(v) already matched the engine — untouched, pinned. 12h Sunday
CWD: £1,065.60 → **£1,154.40** (+£88.80 at £444; scales with BDR). The A3d
boundary pin updated accordingly (£932.40 → £1,021.20 — the day fee is
2×BDR, not hourly, under the ruled structure). Pins: S18 + stageSunCwd
(4 assertions incl. BH-Monday labels and the Saturday no-change guard).

---

## B2 — Saturday early-call premium: **RESOLVED — IMPLEMENTED** (Derrick, 2026-07-12)

**PDF citation.** §2.1.3: *"Early call rule applies on all days throughout a
week, Monday to Sunday."* The clause's "provisions apply to weekdays ie
Monday to Friday" opener is the section template (§2.1.4/§2.1.5 carry it
verbatim); §2.1.3 is the only §2.1.x clause with an all-days override
sentence, so the sentence governs.

**Implemented.** The Saturday Shoot arm emits the early-call line exactly as
the weekday branch does: `ceilHalf(7 − callH)` hours at the **Saturday OT
rate (1.5× BHR** per §2.4(i)/§4.6), gated on `!crew.noOT`, Shoot and CWD
alike; the OT threshold (11h from call, 9h on a CWD) is unchanged, and the
05:00–07:00 band is disjoint from the night bands — no double-count against
the flat 1.5×BDR day fee. **Sunday is a documented no-op**: the hourly
2×BHR-from-call structure already pays 05:00–07:00 at §4.7's Sunday OT rate
(2× BHR), which is the premium.

Verified: Sat 06:00 call £666.00 → **£732.60**; Sat 05:30 → £765.90; Sat
07:00 boundary unchanged £666.00; Sat early CWD £865.80 (premium + OT after
9h, mirroring §2.2.3); noOT crew gets no premium; Sunday 06:00 unchanged
£888.00. Pins: S21–S23 + stageB2 (6 assertions).

---

## B3 — Travel-time threshold: **DEFERRED** (Derrick, 2026-07-12)

**Ruling.** Do not implement — the engine's current span-based behaviour is
retained unchanged, pending Derrick's separate decision. Rationale: the
money moves in BOTH directions depending on day shape (shorter days with
substantial travel would go up; full 11h-span days with sub-hour billable
travel would stop paying), the textual basis is the softest of the four
items, and there is no urgency. The analysis below stands ready for when it
is picked up.

**PDF text.** §3.1: *"Travel time is always paid at single time, regardless
of time, or day of the week. If travel time & working time total less than
11 hours, then no travel time is payable."* Read literally that is a GATE on
net working time + travel (§6.2's note makes lunch NOT working time). The
in-app explainer documents a third model (absorption into the unused basic
day). The engine implements none of the three exactly.

**Engine today.** Pays travel beyond `11h − SPAN`, where span = call→wrap
INCLUDING the unpaid lunch hour. Measured (2h door-to-door each way, so 1h
each way after the first-hour deduction = 2h deductible travel):

| Day | Net worked | Engine pays | Gate reading | Absorb reading |
|---|---|---|---|---|
| 08:00–19:00 (11h span) | 10h | 2h (£88.80) | 2h | 1h |
| 08:00–18:00 (10h span) | 9h | 1h (£44.40) | 2h | 0h |
| 08:00–17:00 (9h span) | 8h | 0h | 0h (8+2 < 11 → wait, 10 < 11 → £0) | 0h |

The engine effectively counts the unpaid lunch hour as "working time" for
the threshold. On full 11h-span days it lands on the gate reading; on
shorter days it under-pays the gate reading by up to 1h × BHR and over-pays
the absorb reading.

**Direction.** ±£44.40–£88.80 per travel day depending on the ruling and
the day length. Not consistently favourable in either direction.

**When picked up, the question is:** the intended basis — (a) gate on NET
work + travel (≥11h → all deducted travel payable), (b) absorption into the
unused basic day, or (c) current span-based hybrid — and whether lunch
counts as "working time" for the threshold.

---

## B4 — Break penalties on nights at 2× BHR: **RESOLVED — KEEP** (Derrick, 2026-07-12)

**Ruling.** Keep the 2× BHR (double) rate on all night break penalties —
1st break (the new A4 charge), 2nd break, and the CWD 9h/12.5h breaks —
uniformly at the prevailing double rate, because the night day operates at
double time. A **deliberate crew-favourable interpretation that exceeds the
literal terms**: the PDF's §6.2/§6.3 night rows say "charged at basic hourly
rate", and its own §2.2.2 night-CWD worked example prices the missed 30m
break at £39 = single BHR (£785 1st AD). Recorded as a chosen generosity,
not an oversight — the defence if a producer queries an invoice line against
the literal terms is that the choice is intentional and consistently
applied. Day-shift penalties stay at single BHR per §6.3/§6.4. The code
comment at the `breakPenaltyRate` definition carries the same note.

---

## B5 — Saturday curtailment top-up rate: **RESOLVED — KEEP** (Derrick, 2026-07-12)

**PDF.** §6.2 (curtailed, no OT worked): crew is *"paid for the time by
which their break was curtailed at single time."* On a Saturday no-OT day
the engine pays the top-up at the prevailing 1.5× BHR (30m = £33.30) rather
than literal single time (£22.20); weekday pays 1× (literal). After fix A2
this only arises on the FLAT structures — Sunday/BH and nights no longer
emit a top-up at all (the hourly pay already covers the minutes).

**Ruling.** Keep — crew-favourable by +£11.10 per Saturday curtailment,
same "prevailing rate on a double/uplifted day" philosophy as B4.

---

## B6 — Defensive-default gaps (robustness hardening, low reachability)

Not rulebook conflicts — engine fallbacks that only bite on hand-made or
corrupted data. The normal UI seeds all of these correctly.

1. **Missing `otCoef` falls back to 1.0**, not `autoOtCoef(bdr)`. A grade I
   crew record with a stripped coefficient pays OT at 1× BHR instead of
   1.5× (verified: £330 + penalties vs £360 grade-correct — an under-pay of
   £15/OT-hour at £300 BDR). Suggested hardening: fall back to
   `autoOtCoef(bdr)`.
2. **Step-up to a hand-typed role with no `stepUpOTCoef`** inherits the
   crew's own coefficient (verified: Spark 1.5 stepping to a £568 custom
   role pays OT £85.20/h vs grade II £71.00 — over-pay £14.20/h). The role
   picker seeds coefficients from the rate card, so this needs a free-typed
   role.
3. **`noOT` does not carry through step-up**: stepping up to Director/
   Producer would pay OT on a £933+ BDR. No real-world path today.

**DERRICK TO RULE:** priority for hardening these three (suggest: bundle
into the next calc-touching release; none is reachable from the UI today).

---

## B7 — PMPA simplifications: **RESOLVED — KEEP** (Derrick, 2026-07-12)

Appendix 1 §(a) crew (PM / PA / Runner / Floor Runner) are exempt from
§2/§3/§4/§5/§6 (PDF §3 note confirmed verbatim: *"None of the provisions of
clause 3 shall apply to PM's, PA's or Runners"*). Both engine choices
confirmed as deliberate:

1. **Travel Day pays flat BDR** rather than min-5h × BHR — favourable
   simplification (£238 vs £119 for a Runner).
2. **Mileage stays payable** if entered — user-entered, effectively opt-in.

---

## B8 — Latent tripwires (guarded assumptions, no action needed today)

1. **Bank holiday on a Saturday** would resolve as Saturday 1.5× rather than
   BH 2× — `treatAsSat` is checked before `treatAsSun` in both engines.
   UNREACHABLE with the current UK_BANK_HOLIDAYS table (every gazetted
   E&W holiday 2025–2035 is a weekday; weekend holidays are listed as their
   Monday/Tuesday substitutes, matching gov.uk). This is a **guarded
   assumption**: if the table is ever extended with a raw weekend date, the
   branch order silently under-pays 0.5× BDR. Guard suggestion for the next
   calc-touching release: an assertion (or table-load check) that no
   UK_BANK_HOLIDAYS key falls on a Saturday/Sunday.
2. **Short-day missed lunch labels the day CWD** (e.g. call 08:00, wrap
   13:00, no lunch → `continuousDay: true`) even though §6.2 converts only
   once 6.5h have elapsed. Verified **money-neutral** (flat BDR either way;
   CWD break penalties can't fire before the 9h deadline) — cosmetic only
   (day label/chip reads CWD). Fix opportunistically whenever the break
   state machine is next touched.

---

*Compiled 2026-07-12 on `fix/calc-audit` from the adversarial audit findings;
adjudicated by Derrick the same day against the actual APA Recommended Terms
PDF. Implemented and pinned: A1–A3 (boundary bugs), B1 + §2.4(vi) (continuous
double-rate days), A4 (night missed-break charge, ruled 2×), B2 (Saturday
early call). Kept deliberately: B4 (night penalties at 2×), B5, B7. Deferred:
B3 (travel threshold). Backlog: B6, B8. Remaining follow-ups: the
APA_RULES.md editorial pass, and the optional "booked CWD" carve-out noted
under A4.*
