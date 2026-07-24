# TimeMachine — session handover

Written 24 July 2026, at the close of the launch-cycle working session. Aimed at a
fresh Claude Code session with no memory of that session. The repo is the source of
truth; where this file and the code disagree, the code wins.

## Current state (24 July 2026)

- **The app is LIVE on the App Store.** Version 5.3.0, build 9 (all four
  CURRENT_PROJECT_VERSION blocks in lockstep; the next build is 10).
  - App Store ID: `6775970098`
  - Listing URL, the ONLY form ever used anywhere:
    `https://apps.apple.com/app/id6775970098` (country-neutral; never `/gb/` or
    `/us/` — the neutral form redirects to the visitor's storefront).
- **The website is fully deployed** at timemachineapp.co.uk: launch copy (no
  beta/TestFlight framing except privacy's deliberate conditional paragraph), ten
  published articles with internal links, BreadcrumbList + BlogPosting JSON-LD,
  App Store nav CTA on every article, SoftwareApplication JSON-LD on the root,
  eased hero glow on every page, 15-URL sitemap.
- **Everything is merged and pushed**: local main == origin/main. No held
  branches remain; the branch-per-fix refs from the release cycle were deleted
  after merge.
- The web app at the root URL IS the deployed app (self-contained index.html);
  it now also carries the SEO head (tool-query title/meta, SoftwareApplication)
  and a non-affiliation line in onboarding.

## Working disciplines (non-negotiable, learned and enforced all cycle)

1. **Propose-first** on anything touching the pay/calc engine, stored-data
   shape, a data migration, or money displayed on a breakdown/invoice.
   Investigate, show the current logic, propose, WAIT for sign-off. No silent
   edits to the pay engine. (CLAUDE.md states this; it is real and enforced.)
2. **Three-audit gate after every change**, green before any commit:
   `npm run build`, then `audit:build` (byte-parity + 171 kit assertions + 65
   calc boundary pins), `audit:storage` (1171 regex pins over index.html and
   some Swift files), `audit:web` (no native/PDF libs leak into the web build).
   Swift-touching changes also compile BOTH xcodebuild schemes (App,
   TimeMachineWidgetExtension).
3. **One commit per fix/feature**, message carrying the reasoning. Storage-pin
   updates ride in the same commit as the change that motivated them; pin
   ANCHOR widenings are routine, pin ASSERTION changes only when the behaviour
   change was itself approved (say so in the commit).
4. **Storage/migration rules**: every persisted `bigals_*` key MUST join the
   adapter's KEYS warm list in the same commit (relaunch destroys the record
   otherwise — the T1 bug; M-series pins enforce it). Bug fixes may repair
   already-saved data; preference changes are defaults for NEW shoots only,
   never retroactive. Invoices are frozen records — snapshot at send, never
   mutated afterwards.
5. **main auto-deploys on push** (Netlify → timemachineapp.co.uk). Finished,
   verified releases only. Work on branches; merge to main only with explicit
   approval; a push IS a deploy.
6. **Copy voice**: British English, sentence case, no em dashes (app AND
   marketing), lowercase am/pm. BRAND.md = visual identity;
   TimeMachine_voice_and_tone.md = copy voice (overlapping — may be folded).
7. **Verify through the real pipeline**: the actual #invoice-print-view DOM for
   PDF work, the on-device export on native. The two invoice render paths
   (editor vs print) are DIFFERENT DOM.

## Key files

- `APA RULES.pdf` (repo root) — the AUTHORITATIVE pay rulebook. APA_RULES.md is
  a reconstruction with known contradictions (editorial pass still owed).
- `CALC_DECISIONS.md` — the calc rulings ledger: every ruling with its PDF
  citation and Derrick's decision date. B6/B8 are the flagged hardening backlog.
- `MAINTENANCE.md` — ALL parked work with triggers. Currently: Sept 2026 rate
  labels, iOS 27 requestConfirmation cleanup, Best Boy wrapped-flag gap,
  todayISO() UTC/BST skew, the LA single-slot staleDate hole, the LA
  midnight-discard event loss, and the Greggs/Leatherman trademark softening.
- `scripts/` — the audit tooling the gate runs. `storage-test.js` is the pin
  suite; `calc-boundary-assertions.js` holds the 65 expected-£ pins.
- `CHANGELOG.md` + in-app RELEASE_NOTES (index.html) — both updated per release.

## Parked items, with enough context to act on

Each has a full entry in MAINTENANCE.md; headlines:

- **Rate card 1 Sept 2026**: marketing pages carry "APA Sept 2025" markers that
  need updating when the new card lands; the app resolves cards by shoot start
  date, so add the new card rather than editing the old one.
- **Best Boy wrapped flag**: multi-crew days lack `day.wrapped`, so they count
  toward Stats the day AFTER instead of at wrap (solo days count at wrap since
  5.3.0). Fix = set a finished flag in the multi-crew wrap flow, then the
  existing bypass just works.
- **todayISO() is the UTC date**: everything keyed on it rolls over at 1am
  during BST, including the Live Activity sweep's today-matching. The Stats
  aggregation already normalised locally (its two sites only); fix app-wide in
  an LA-touching release.
- **LA single-slot staleDate hole**: platform limit, documented, self-heals on
  next foreground. Do not "fix" with rotation — it was evaluated and rejected.
- **LA midnight-discard**: cross-midnight pending events can be discarded at
  ingest; capture point instrumented in the diagnostics.
- **Diagnostics**: a flag-gated LA ring buffer ships in the app (Settings →
  Notifications & Live Activity → tap the "Live Activity" TITLE five times →
  Diagnostics logging toggle + Share). Default off. The arm readback line can
  say "empty — update did not take" on a LIVE card due to a benign publish
  race; a real husk shows repeating arm/disarm pairs with no confirm instead.
- **App Review lesson (five 2.5.1 rejections' worth)**: HealthKit surfaces must
  be identifiable on a FRESH install without completing a day. Guards: the
  Settings "Show step stats" subtitle names Apple Health; both Stats empty
  states carry an identification line; Legwork mounts without a counted day.
  Do not regress these. The write usage string in Info.plist is REQUIRED by
  the upload validator (ITMS-90683) even though the app never writes.

## Environment traps

- The repo must live on a LOCAL volume, never iCloud Drive (com.apple.provenance
  xattr breaks codesign — full explanation in CLAUDE.md).
- `dist/` is esbuild output for the Capacitor wrap, gitignored, never served to
  web. The web app is built from the root index.html directly.
- Netlify serves extensionless pretty URLs; canonicals use them. The local
  python dev server (`.claude/launch.json`, `raw-web` on :8799) needs explicit
  `.html` in URLs.
