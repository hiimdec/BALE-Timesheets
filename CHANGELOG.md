# TimeMachine Changelog

All notable changes to TimeMachine are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.8.1] - 2026-06-02

Pay-calculation accuracy (overtime, pre-call, travel, riggers, wrap time), a single rounding choice, bidirectional invoice linking, fuller backups, and data-integrity fixes throughout.

### Added

- Client and job details (company, emails, project, reference) now flow between your project and its invoices — fill them once; sent invoices stay locked as issued.

### Changed

- Rounding is now a single choice — Exact, Favourable, or APA — instead of two separate switches that could conflict.
- Backups now include bank details, company info, settings and invoice numbering — so a restore, or moving to a new device, brings everything back.
- Favourable invoices now show clean whole-pound amounts on every line, including penalties.

### Fixed

- Overtime after midnight now correctly pays triple time through to wrap.
- Pre-call premiums (early starts) are always paid in full, even on short days.
- Corrected the travel-time threshold across all day types.
- Mileage lines now show the correct route and M25 status.
- Rigger rates now compute via the standard rules from the rate-card day rate.
- Fixed a wrap time that could go blank and zero the day total after changing the call time; the wrap now defaults to 11 hours after the call.
- Duplicating a shoot no longer copies its invoices.
- Data-integrity, input-validation and stability fixes throughout.

## [4.8.0] - 2026-06-01

The first iPhone (TestFlight) release, plus new invoicing and stats touches for everyone.

### Added

- **Mark-as-paid celebration** — a little emoji shower plays when you mark an invoice paid. Make it your own (or switch it off) in **Settings → Celebration**: choose the emoji (💵 Cash / 💰 Bag / Mix), how much falls (Light / Medium / Heavy), and how fast (Chill / Normal / Fast), with a Preview button to try it.
- **Per-shoot rounding** — set Favourable or APA rounding for each shoot in its own Shoot Settings. The global setting now only chooses the default for *new* shoots and never changes existing ones. Invoice line items, notes, and day totals all reconcile to a single figure under either mode.

### Changed

- **Crisper invoice PDFs on iPhone** — invoices export as sharp, selectable, correctly-paginated PDFs (matching the web/print layout) instead of a single flattened image.
- Under-the-hood improvements for App Store readiness and tidier example text.

### Fixed

- **Overtime Earned** now shows the correct total in Stats — it had been reading £0 for shoots with weekday overtime.
- **Imported shoots** now show their call/wrap times on the day and shoot views, and Stats averages count those days correctly.
- Sharing or emailing an invoice no longer attaches the PDF twice.

## [4.7.0] - 2026-05-28

Best Boy Mobile Refinement Sweep — a substantial rebuild of BB mobile mode plus architectural cleanup, followed by a post-ship calc-correctness sweep that closed every known APA divergence. The in-app `RELEASE_NOTES` block in `index.html` is the source of truth; this entry mirrors it.

### Added

- Separate legal name for invoices (Settings → Invoicing — Your details). The formal name on generated invoices is distinct from the casual display name used in the app header and stats. Falls back to display name when blank.
- Optional CC field when sending an invoice by email. Entered per-send, never persisted — type a CC recipient at send time and it's added to the `mailto cc`; the next invoice starts with an empty CC.
- Highest earning day card now shows a colour-coded Basic / OT / Penalties / Kit / Extras breakdown (non-zero buckets only) above the comparison.
- Live CLOCKED timer on the hero card freezes 4h past the planned wrap with a "Still on the clock? Wrap now" nudge — no more absurd 30h+ figures when someone forgets to hit Wrap Now. Hitting Wrap Now locks the real figure as before.
- Pre-call before 05:00 shows an informational note explaining it's outside standard APA territory (a pre-5am unit call would normally be a night shoot) and that triple time has been applied to the pre-05:00 portion.
- Auto-apply cascade — editing dept-default times propagates to all crew automatically. Crew with field-specific variances stay shielded.
- Drill-in breakdowns — tap any crew row for their full multi-day breakdown; tap any day row for per-crew breakdown on that date.
- CWD breaks markable in Best Boy mode (was solo-only). Chip turns red when any break is missed.
- Inline editing — extras chips expand inline below the chip row; multiple can be expanded simultaneously. Replaces bottom sheets, mirrors solo mode.
- Variances accordion — per-person field overrides for a day surface in a collapsible VARIANCES section. Affected crew names highlighted fuchsia.
- Money pill navigation — bottom pill steps left/right between days, with a "+" to add a new dense day.
- Wrap Now / Lunch Now buttons on BB dept-default cards capture current time (rounded to 5 minutes).
- "I am" picker — tell the app which crew member is you; calc and money pill respect it for the running total.

### Changed

- Value-presence activation — toggles dropped from extras. Setting a value activates; clearing deactivates. No more "off but with a saved value" confusion.
- Chip parity solo ↔ BB — both modes use the same chip styling and behaviour. Tapping a chip never loses data.
- Cascade for time fields — call, wrap, lunch start, lunch duration, and day type cascade from dept defaults using inheritance.
- Solo OT highlight — wrap card tints orange when entering OT, matching BB. Respects 11-hour-day production setting.
- Desktop chrome time inputs — time fields in BB mobile now editable on desktop Chrome / Safari / Firefox.
- Color discipline locked — sky for active, fuchsia for variance, red for penalty, orange for OT/edited, green for sent/paid.
- Conditions row clarified — penalty conditions render red; state indicators render orange.
- Curtailed lunch indicator visible in invoice + breakdown export.

### Fixed

#### Calc engine

- **Pre-call hours now paid correctly per APA §2.1.3** — hours before 05:00 charge 3× BHR (triple time), hours from 05:00 to main call charge OT rate. Pre-call also absorbs into unused basic-day hours (industry practice, mirrors travel-time absorption), with absorption eating from the call-time end so the triple-time premium is preserved as long as possible. Night shoots keep flat 2× BHR with no split per §2.1.5.
- **Night shoots no longer suppress break penalties** — £10 late 1st, curtailed 1st, missed meal £7.50, missed/late 2nd break, and CWD breaks all fire on night-call Shoot / Pre-light days. Time-based penalties charge at 2× BHR to match the flat night-shoot rate per §2.1.5.
- **Floor Runner / AD Trainee** now correctly treated as PMPA per APA Appendix 1 §(a) — no break penalties, no travel time, no triple time, OT at flat BHR on shoot days only. Matches Production Runner.
- **Discretionary days (Prep / Recce / Build / De-rig)** now pay flat 8h × rate on weekday, Sat and Sun/BH per APA §2.3 — taking lunch no longer inflates pay from 8h to 9h. OT threshold still shifts with lunch as expected.
- **Saturday Pre-light overpayment** closed — the basic line used a sliding `workedHrs`-up-to-`basicHrs` formula instead of flat 8h, so a 9h Sat Pre-light billed 9h × satRate. Now mirrors weekday Pre-light exactly (flat 8h, 9h when CWD). Discretionary Sat unaffected.
- **Sun / BH Pre-light and Discretionary regression** — pay was clipped to 8h after the flat-8 discretionary fix landed. Restored `Math.max(workedHrs - lunchDeduct, 8)` so a Sun Pre-light 08:00 → 21:00 with 1h lunch now correctly pays 12h × 2× BHR (was 8h × 2× BHR). Min-8 floor and "min 8h applied" note preserved.
- **TOC penalty capped at 1h × OT rate** per APA §5. A 7h rest used to bill 4h of TOC; now correctly bills 1h plus the existing BREACH warning when rest < 10h.
- **Sun/BH curtailed lunch** now pays double rate (was paying single BHR).
- **Curtailed 1st break calc** per APA §6.2.

#### UI / status copy

- **BWD-override roles (DoP, Art Director, Location Manager)** now see a day-detail UI that matches their pay. On Prep / Recce / Build / De-rig / Pre-light days, the lunch chip shows start→end times and the NOW button, the meal-provided toggle appears when lunch is missed, and the late / missed lunch StatusMsg fires — mirroring the Basic Working Day treatment `calculateDay` applies.
- **Curtailed 1st break when OT was crossed** no longer renders a misleading £0 line. The curtailment minutes now surface in the OT line's detail ("…incl. 20m curtailed lunch").
- **Stats days-by-type** now resolves the cascaded day type — days that inherit their type were all bucketing as "Unknown" and never counting as Shoot days, so shoot-day count and avg shoot length read zero. Day type is now read from `calc.meta` (booked type, not the BWD-override effective type).
- **CWD lunch-missed status message** no longer hardcodes "instead of 11h" — uses 12h on 11-hour-day productions so the comparison is accurate.
- **Bank holiday lookup table** now covers 2025 (was 2026 onwards) so backdated invoices for 2025-12-25 etc. get the correct Sun/BH treatment.
- **OT visibility** in summary rows reflects calc state across multi-crew view.
- **Setup navigation** back/home button behaviour.
- **Solo lunch duration** overflow.
- **Spurious "OVERRIDDEN" badge** no longer fires for inheriting crew.
- **Crew-creation cascade** — newly added crew now correctly cascade from dept defaults.
- **Stub EDIT button** removed from dept defaults.
- **Lunch status under the day card** no longer claims "Counts toward basic" on discretionary days — lunch is unpaid filler there, and the message was asserting an incorrect calc.

### Cleanup / polish

- **LUNCH card on the day-detail page** now mirrors the CALL / WRAP card structure — LUNCH label top-left, conditional status chip top-right (CWD / LATE / CURTAILED / ON TIME), centred `13:00 → 14:00` time pair, NOW button + duration select in a hairline-separated footer. The green "On time. Lunch ends X." banner is silenced; the chip is the only on-time affordance. Discretionary days keep the label-only header + footer treatment.
- **Breakdown bucket restructure** — meter and legend show five buckets (BASIC / OT / PEN / KIT / EXTRAS) with KIT narrowed to kit money only and a new EXTRAS bucket holding per diem, mileage, travel time, and expenses. Kit and the former Mileage bucket swap colours: KIT is now purple, EXTRAS is green. Line totals and calc engine unchanged — only categorisation and colour assignments.
- **Pre-call and step-up extras** now have an explicit Remove button inside their inline edit panels, fixing the mobile-only inability to clear a non-numeric extra. Pre-call clears both `preCallTime` and the legacy `truckCallTime`; step-up clears role + BDR + OT-coef + OT-rate together. Both solo and BB per-day surfaces; BB dept-defaults already had a Clear default button.
- **Dropped the unused `notApa` flag** from Best Boy and Trainee roles — it was never consumed by the calc engine. Per-crew BDR / OT rate still configurable.
- **Repo hygiene** — removed four orphan mockup HTML files (`Al Timesheet.html`, `Grid Overview.html`, `mockup-1-single-timesheet-v5.html`, `mockup-2-multiweek-grid-v5.html`), an orphan `favicon-48.png`, and 8 redundant `--tm-*` CSS variables that duplicated values already defined in the Tailwind config.

### Removed

- 7 boolean activation flags from day records: `preCallEnabled`, `kitMoneyEnabled`, `perDiemEnabled`, `travelTimeEnabled`, `stepUpEnabled`, `mileageEnabled`, `expensesEnabled`. Value presence drives activation now.
- "Apply to N crew" chip — auto cascade replaces it.
- `applyDayDefaultsToAllCrew`, `hasUnpropagatedDefaults`, `getSharedPenaltyLabels` helpers (dead code).

### Migration notes

On first load of an existing production:

- 7 legacy `*Enabled` flags deleted from records
- Records with previously "off but saved value" now activate (data preserved; clear manually if not wanted)
- Crew time fields matching dept defaults collapsed to inherit
- CWD break flags default to "given"

All migrations idempotent and one-shot. No user action needed.

## [0.1.0] - 2026-05-12

### Added

- Initial pre-release of TimeMachine
- APA-compliant time tracking — call, wrap, lunch deadlines, continuous workday (CWD)
- Per-day breakdown with itemised lines: BDR, overtime, penalties, extras
- Multi-day production support with week navigation
- Solo mode (you) and Best Boy mode (multi-crew)
- Invoice generation with PDF export and line-item editing
- Mileage auto-calc from UK postcode lookup (with M25 warning)
- Pre-call time support — truck driving, pre-light, prep (paid at BHR)
- Per diems, kit money, step-up rates, and expenses
- Bank holiday detection through 2035 (Scotland + England & Wales)
- Cancellation fee calculation per APA agreed-fee rules
- Travelling day type with full day-rate logic
- Day-type support: Shoot, Pre-light, Prep Day, Recce, Build Day, De-rig, Travel Day, Rest Day
- Overtime coefficients: Grade I (1.5×), II (1.25×), III (1.0×)
- Saturday / Sunday rate overrides
- Night shoot detection and pricing
- 11-hour day recognition
- VAT support (per crew member or global)
- Local-only storage — no servers, no analytics, no accounts
- Privacy policy and data export / reset controls
- iOS web-app support with safe-area insets

### Known limitations

- iOS native app pending (Phase 3)
- No cloud sync (post-launch consideration)
- Postcode dataset covers UK outcodes only (no full postcode precision)
