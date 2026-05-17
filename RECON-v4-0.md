# V4-0 Recon — Best Boy mobile mode data model

Read-only audit. All line refs are against the current `index.html` (post V3-20).

Note on prerequisites: the v4 mockup referenced in the prompt (`/docs/mockups/v4_bestboy.html`) does **not** exist in the repo — `docs/mockups/` contains only `v2.html` and `v3.html`. The recon is grounded entirely in current code; if the mockup defines specific UX semantics, they need to be cross-checked once the file lands.

---

## 1. Day-level vs crew-level data

**Day object schema** (from `makeBlankDay` at lines 5541–5556 and the lazy fields handled by `migrateDay` at 1173):
- Identity: `id`, `crewId`, `date`
- Times: `callTime`, `wrapTime`, `wrapNextDay`, `lunchStartTime`, `lunchDurationMins`, `secondBreakStartTime`, `secondBreakDurationMins`, `preCallTime`/legacy `truckCallTime`
- Type/flags: `dayType`, `wrapped` (V3-E schema v2 flag), `noMealProvided`, `cwdBreak1Given`, `cwdBreak2Given`
- Conditions (V3-7 chip flags): `preCallEnabled`, `mileageEnabled`, `travelTimeEnabled`, `expensesEnabled`, `stepUpEnabled`, `kitMoneyEnabled`, `perDiemEnabled`
- Condition data: `travelOutMins`, `travelBackMins`, `miles`, `mileageMethod`, `mileagePostcode`, `mileageRoundTrip`, `kitMoneyAmount`, `perDiemAmount`, `expenses[]`, `stepUpRole` / `stepUpBDR` / `stepUpOTCoef` / `stepUpOTRate`
- Notes: `note` (single string)

**The crucial detail: `crewId` is on the day itself.** This is the data-model load-bearing fact. The codebase stores **one day record per crew member per date**, not "one day record with crew overrides".

Per-crew-member-per-day overrides: **there is no separate override layer.** Each `(crewMember, date)` pair is its own row in `production.days`. The grid groups by date for display (see `byCrew` reducer at line 6079) but storage is flat. When two crew members differ on a single date — different wrap time, different conditions, day off — that's two completely independent day records with the same `date` but different `crewId`. See `TimesheetGrid.openDateEdit` (5048) where the editor picks `firstEntry` arbitrarily to pre-fill bulk-edit, confirming the flat-row model.

**The "default day"**: `production.defaultDay` + `day.defaultDayOverride` exist as soft defaults (see `resolveDay` at 794 and `DEFAULT_PRODUCTION_DAY` at 603), but in practice every day spread copies `DEFAULT_PRODUCTION_DAY` in at creation (5672, 5681, 5701, 5710, 7101, 7185). `defaultDayOverride` is referenced once in `resolveDay` but I see no writer that sets it — appears dormant.

**Interpretation.** This is the most important finding for V4 planning. The "mobile Best Boy" view's notion of "select a crew member → see their days" maps cleanly: filter `production.days` by `crewId`. Differences between crew on the same date are already first-class data. There's no migration needed for per-crew variance — the model already supports it.

---

## 2. `resolveDay` mechanics

**Lines 794–798:**
```js
function resolveDay(production, day, crew) {
  const defaultDay = production.defaultDay ?? {};
  const dayOverride = day.defaultDayOverride ?? {};
  return { ...DEFAULT_PRODUCTION_DAY, ...defaultDay, ...dayOverride, ...day };
}
```

Merge precedence (low → high): `DEFAULT_PRODUCTION_DAY` → `production.defaultDay` → `day.defaultDayOverride` → `day` (raw). The `crew` arg is unused inside `resolveDay`; it's accepted only for symmetry with `resolveCrewForDay` (1551), which is a separate step.

The pipeline is `calcForDisplay` (1603):
1. `resolveDay(production, day, crewMember)` → `resolved` day with defaults filled in
2. `resolveCrewForDay(resolved, crewMember)` → `effectiveCrew` (applies step-up overrides if `stepUpEnabled`)
3. `calculateDay(resolved, effectiveCrew, production)` → calc with lines + meta
4. `augmentCalc(...)` → adds extras (kit, per diem, expenses)
5. Optional TOC line if `prevDay` provided
6. Optional favourable rounding

`resolved` is the input to `calculateDay`. The boundary is clear: anything in `day` is raw stored data; `resolved` is the computed view used inside calc only. **Never persist `resolved`.** Persist `day`.

**Interpretation.** Solid. The new mobile mode reads `day` records straight, calls `calcForDisplay` per `(day, crewMember)` pair, and renders. No model surgery needed.

---

## 3. "Not working today" state

**There is no explicit "off today" flag.** The current data model represents "this crew member didn't work date X" as **the absence of a day record with that `crewId` and `date`**. The grid renders absent cells as blanks (see `GridCell` at 4986 — it receives `day` which may be undefined for a particular cell, and renders an "Add Day" CTA instead of values).

There is one half-step toward a concept: `dayType: "Rest Day"` (in `DAY_TYPES`) — a typed not-working state for *productions where every crew has the same off-day*. But there's no per-crew rest-day mechanism beyond simply not having a day record.

**Calc impact:** if a crew member has no day record for a date, that date contributes nothing to their totals. The grid's `byCrew` reducer (6079) groups by `crewId` and totals via `calcForDisplay` over the filtered entries — absent dates are naturally zero.

**Interpretation.** The mobile mode's "today: not working" state is just `crew.id` having no day record for `todayISO()`. No new flag needed. If the mockup shows an explicit "Off" toggle in mobile mode, the implementation can either:
- (a) delete the day record (clean but irreversible if user toggles back on — would need to remember previous values), or
- (b) introduce a new `day.absent` flag (small schema bump, opt-in via `migrateDay` default `false`).

Option (b) is cleaner for the "I'm sick today" toggle UX where the user might toggle back tomorrow. Decision: defer until mockup is concrete.

---

## 4. SoloDayPage coupling to `crew[0]`

Five references to `crew[0]` in or near `SoloDayPage`:
- Line 5674: `setForm({ ...d, ...makeBlankDay(crew[0].id), ...})` — inside a setForm reset inside DaysManager (not SoloDayPage), so this is grid-side
- Line 5676: `setFixedCrewId(!production.bestBoyMode ? crew[0].id : null)` — also DaysManager
- Line 6305: `soloMember = ... production.crew[0] : null` — in `ProductionSettingsSheet` for the "Your role on this job" disclosure
- Line 7100: `const blank = makeBlankDay(crew[0].id)` — SoloDayPage mount-time auto-create (mounts an initial day)
- Line 7184: `const blank = makeBlankDay(crew[0]?.id)` — SoloDayPage `addDay` handler
- Line 7253: `const soloCrew = crew[0] || null` — SoloDayPage prop for downstream views
- Line 7482: `fixedCrewId={crew[0]?.id ?? null}` — SoloDayPage passes to `DayEntryForm`

Inside `SoloDayPage` proper (function starts at 7075): **four `crew[0]` references** (7100, 7184, 7253, 7482). All four resolve to the same identity question: "who is this view editing?"

The assumption is **shallow**, not deep. None of the calc helpers (`calculateDay`, `resolveCrewForDay`, `calcForDisplay`) hardcode `crew[0]` — they take `crewMember` as a parameter. The `crew[0]` choice is purely a UI-level "default to the first / only crew member" convention. Parameterising SoloDayPage to accept a `crewMember` (or `crewId`) prop would be a 4-line change.

**Interpretation.** This is the V4 unlock. The mobile Best Boy mode's "switch which crew member you're viewing" is literally `SoloDayPage` with a different `crewMember` argument. Add a state at the parent level for "active mobile crew id", pass it in, and the existing per-day editor renders the right person's days. No calc changes, no new editor.

---

## 5. Best Boy grid feature inventory

Walking through `TimesheetGrid` (5033) + `DaysManager` (5660) + `DateEditModal` body (~5285) + the GridCell (4986):

- **Crew CRUD**: Add / remove / rename / reorder crew members (CrewManager at 3448, hung off Setup tab of best-boy productions)
- **Per-crew identity**: BDR, role (with dept), OT coefficient, OT rate override, VAT registered + VAT rate, Kit money enabled + amount, Driver flag
- **Date column header**: tap-to-bulk-edit all crew on that date (`onBulkEditDate` → `DateEditModal`), assign-all (`onAssignAll`), remove-all-on-date (`onRemoveDate`), duplicate-date (`onDuplicateDate`)
- **Per-cell day edit**: open `DayEditModal` for a single (crew, date) pair (`onEditDay`)
- **Add Day for a single crew on a date** (`onAddDay`)
- **Add Week** (`onAddWeek`), Remove Week (`onRemoveWeek`) — bulk operations
- **Day type per cell**: Shoot / Pre-light / Prep / Recce / Build / De-rig / Travel / Rest
- **Times** per cell: call, wrap, lunch start, lunch duration
- **2nd break** per cell: start, duration
- **CWD breaks** per cell: cwdBreak1Given, cwdBreak2Given toggles
- **Conditions** (V3-7 chips) per cell: pre-call, mileage (with postcode lookup + M25 check), travel time, step-up role, kit money, per diem, expenses, notes
- **Step-up role** per cell (overrides crew role + rate for the day)
- **Day flags** displayed in cell: OT, CWD, L1 (late 1st break), MSB (missed 2nd break), TOC (time off the clock) with breach state
- **Visual indicators**: weekend column tints (Sat tm-warn, Sun tm-pen), BH label
- **Penalties / wage breakdowns**: visible inline in DayEditModal calc table
- **Cancellation calc** access from grid Setup tab (`<Btn variant="ghost" size="sm" onClick={() => setShowCancelModal(true)}>Cancellation fees</Btn>`)
- **Notes** per cell (single free-text field)
- **Export per crew**: PDF timesheet via PrintView, text via `generateCrewText`, grid PDF (production-wide view)
- **Invoice generation**: per-crew invoice via `createNewInvoice` (per-crew billing)
- **Discounting / waiving**: per-line on each crew's invoice

That's the parity surface. Mobile mode needs an answer for each — but "delegate to grid for this advanced case" is a valid answer for many.

---

## 6. Multi-crew totals

`CalcBreakdownView` (~line 6390 region post-V3) operates on a single crew's days. The grid-level overview that aggregates across crew lives in the production-detail screen at line 6089: `const grandTotal = byCrew.reduce(...)` — sums per-crew calculated totals across `byCrew`. `byCrew` is `[{crew, entries: filtered days for that crew}]`.

Per-crew is the unit of summing; cross-crew totals are derived. The model doesn't have a "production-wide gross before per-crew split" notion — the per-crew totals ARE the truth, and grand total is their sum.

**Share / export output**:
- `triggerExport("timesheet", crewId, weekIdx)` and `triggerExport("grid", null, weekIdx)` are the two modes (6108).
- One PDF per crew (timesheet) OR one combined grid PDF.
- Crew picker (`showCrewPicker`) prompts when > 1 crew.
- Text export via `generateCrewText` is per-crew only.

**Interpretation.** No need to change the model. Mobile mode just needs a UI for: pick a crew → export their timesheet. The plumbing exists; the prompt step is what's mobile-unfriendly today.

---

## 7. Existing email / send infrastructure

**Mail infrastructure: `openInvoiceMailto` at line 3175.** Single function. Builds a subject + body string from the invoice, then `window.location.href = mailto:?subject=...&body=...`. Plain string body, no attachment, no transport — just opens the user's mail client. No history of "sent" beyond the invoice's own `status: 'sent'` + `dateSent` fields.

There is no equivalent helper for timesheets — only invoices have a mailto path today. Timesheet export is PDF-via-print or text-via-share-sheet (`shareTextOrCopy` helper).

**Crew member email field**: searched `crew.*email\|email:` — there is **no `email` field on the crew schema** (3450 inline blank, line 3198 in invoice context). Crew records have `name`, `role`, `bdr`, `otCoef`, `otRate`, `vatRegistered`, `vatRate`, `kitMoneyEnabled`, `kitMoneyAmount`, `isDriver` — no contact details.

The closest thing is `production.invoicingEmail` (1245, 1515, 2785) — but that's the production company's accounts email (where invoices go), not the per-crew member's personal email.

**Sent-timesheets history**: none. The invoice `status` machine exists for invoices only.

**Interpretation.** This is the biggest data-model gap for V4-4 (Send Timesheets). To send a timesheet to crew member X, we need:
- `crewMember.email` field (new) — small schema add
- A `sendTimesheetMailto(crewMember, days, production)` helper paralleling `openInvoiceMailto`
- Optionally a "sent on" timestamp per crew (similar to invoice's `dateSent`)
- The text body itself: `generateCrewText` already produces a good baseline; could reuse

Not blockers, but actual schema and helper additions. Worth scoping as part of V4-4 rather than discovering mid-build.

---

## 8. Unexpected findings

- **`defaultDayOverride` is dead code.** `resolveDay` reads it (796) but I can find no writer. Either a removed feature or a hook that was never wired up. Worth a follow-up audit to confirm and delete if truly unused.
- **The Btn `success` variant uses `bg-green-500`** (Btn at line 3251 area) — not tm-good. Audit P3 said this was acceptable but with v4 polishing it might be worth a final token sweep on Btn variants for full consistency.
- **`PrintView` at 2416 takes `crewMember` directly**, so per-crew PDF works fine. Mobile mode can reuse it.
- **The `crewId` field on day records is load-bearing for almost everything.** Migrations, day-creation flows, calc — they all assume `day.crewId` is set. The mobile mode's "I am crew member X looking at my days" filter is `production.days.filter(d => d.crewId === activeCrewId)`. This is robust and trivial.
- **Best-boy mode flips on automatically when `crew.length > 1`** (line 1242: `bestBoyMode: p.bestBoyMode ?? ((p.crew?.length ?? 0) > 1)`). This means adding a second crew member silently flips the production's mode. With v4 adding a third concept (mobile-best-boy vs grid-best-boy), we'll want to be careful that the auto-flip rule doesn't surprise users. Suggestion: keep `bestBoyMode` as "this production has multiple crew" and introduce `viewMode: 'grid' | 'mobile'` as a separate, explicit field that the user toggles. Both can exist; they're orthogonal.
- **`generateCrewText` is good as a per-crew text-export base**, but it doesn't include a "Hi <name>" salutation or any context that'd make a good email body. For V4-4, a thin wrapper that prefixes / suffixes the existing output would do.
- **The Day-edit modal (`DayEditModal`) is shared between solo and grid flows.** It accepts a `value` (day) and a `crewMember`. Already parameterised. Good.
- **No per-crew "active / inactive" or "archived" flag.** If a crew member quits mid-production, the only options today are leave them with no further days (clean) or delete them (loses their historical days because of the foreign-key `crewId`). For long-running productions this might bite.

---

## Summary: can V4-1 ship as proposed?

**Yes, with a tiny caveat.** Adding a `viewMode: 'grid' | 'mobile'` field to the production schema (defaulting to `'grid'` for existing best-boy productions, `'mobile'` for new ones / for productions migrated to the new flow) is purely additive — no migration touches existing day records, calc, or any other data. `bestBoyMode` continues to mean "this production has multiple crew" (data shape signal); `viewMode` carries the new "how do I want to look at it" signal. Both fields are orthogonal and small.

The single caveat: V4-4 (Send Timesheets) needs `crewMember.email` added to the crew schema. That's a separate small schema bump, but it doesn't need to land in V4-1 — only when V4-4 ships. Recommend scoping the `crewMember.email` add into V4-4's prep step rather than front-loading it into V4-1.

Everything else V4 needs — per-crew day filtering, per-crew totals, per-crew exports, per-day variance across crew, per-crew step-up / kit / VAT / driver flags — already exists in the data model and helpers. V4 is, as the prompt frames it, **a renderer swap**.
