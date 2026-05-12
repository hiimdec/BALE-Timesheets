# TimeMachine Changelog

All notable changes to TimeMachine are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
