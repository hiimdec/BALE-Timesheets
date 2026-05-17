# TimeMachine Changelog

All notable changes to TimeMachine are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.7.0] - 2026-05-17

Best Boy Mobile Refinement Sweep — a substantial rebuild of BB mobile mode plus architectural cleanup. 14 fix-ups across 4 weeks of refinement informed by real-shoot use. Same calc engine, cleaner data model, smarter UX.

### Added
- Auto-apply cascade — editing dept-default times propagates to all crew automatically. Crew with field-specific variances stay shielded.
- Drill-in breakdowns — tap any crew row in the overview for their full multi-day breakdown; tap any day row for per-crew breakdown on that date. Penalty lines red, OT lines orange, basic lines neutral.
- CWD breaks now markable in Best Boy mode (was solo-only). Chip appears only when applicable, turns red when any break is missed.
- Inline editing — extras chips expand inline below the chip row; multiple chips can be expanded simultaneously. Replaces bottom sheets. Mirrors solo mode.
- Variances accordion — per-person field overrides for a day surface in a collapsible VARIANCES section. Affected crew names highlighted fuchsia in the crew list.
- Money pill navigation — bottom pill steps left/right between days, with a "+" to add a new dense day.
- Wrap Now / Lunch Now buttons on BB dept-default cards capture current time (rounded to 5 minutes).
- "I am" picker — tell the app which crew member is you. Calc and money pill respect this for the running total.

### Changed
- Value-presence activation — toggles dropped from extras. Setting a value activates; clearing deactivates. No more "off but with a saved value" confusion.
- Chip parity solo ↔ BB — both modes use the same chip styling and behaviour. Set chips show value summaries in sky tint. Tapping a chip never loses data.
- Cascade for time fields — call, wrap, lunch start, lunch duration, and day type cascade from dept defaults using inheritance.
- Solo OT highlight — wrap card tints orange when entering OT, matching BB. Respects 11-hour-day production setting.
- Desktop chrome time inputs — time fields in BB mobile now editable on desktop Chrome.
- Color discipline locked — sky for active, fuchsia for variance, red for penalty, orange for OT/edited, green for sent/paid.
- Conditions row clarified — penalty conditions render red; state indicators render orange.
- Curtailed lunch indicator visible in invoice + breakdown export.

### Fixed
- Sun/BH double rate on curtailed lunch (was paying single BHR).
- OT visibility in summary rows now reflects calc state across multi-crew view.
- Curtailed 1st break calc per APA §6.2.
- Setup navigation back/home button behaviour.
- Solo lunch duration overflow.
- Spurious "OVERRIDDEN" badge no longer fires for inheriting crew.
- Crew-creation cascade — newly added crew now correctly cascade from dept defaults.
- Stub EDIT button removed from dept defaults.

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
