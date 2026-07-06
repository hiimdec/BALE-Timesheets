# v5.2 kickoff

Handoff for the next working session. Everything here is verifiable against the repo — where this document and the code disagree, the code wins (CLAUDE.md rule; it applies to this file too).

## Current state

- **Shipped:** 5.1 (4) uploaded to TestFlight, awaiting review. Versions are lockstep — App 5.1 (4), widget 5.1 (4) — verified from the built products, not just settings. Build 3 was consumed by a rejected upload (ITMS-90683, since fixed); build 4 is the live candidate.
- **main:** at `7363cc8` (`chore(release): build 4 — and the phantom 5.0 widget version explained`). Clean apart from the untracked `TimeMachine_voice_and_tone.md` working doc.
- **Audits, all green at tip:** `audit:build` — byte-parity compare + textual diff + **171** kit assertions over the 84-scenario calc suite; `audit:storage` — **1,088** assertions; `audit:web` — web bundle loads with no Capacitor, no PDF libs, **no HealthKit reachable**, IS_NATIVE=false. Both Xcode schemes (App, TimeMachineWidgetExtension) compile with zero warnings.
- **Live:** timemachineapp.co.uk serves main's tip (Netlify auto-deploy). The raw web path's CDN dependencies are exact-pinned (React 18.3.1, Babel 7.26.4, Tailwind Play CDN 3.4.16); the native bundle vendors everything locally.
- **Pre-submission audit:** completed and triaged; every finding is either fixed (O1–O9) or filed with a trigger in MAINTENANCE.md / BACKLOG.md.

## Working method (the short version — CLAUDE.md is law)

- **Two-surface workflow.** The self-contained root `index.html` is the web app source; `dist/` is esbuild output for the Capacitor iOS wrap (gitignored, synced into `ios/App/App/public` by `npx cap sync ios`). Edit locally; **pushing to main deploys the website** — keep unreviewed work on branches.
- **Propose-first** on anything touching the pay/calc engine, stored-data shape, migrations, or money shown on a breakdown/invoice. Investigate, show current logic, propose, wait for sign-off. The calc engine is effectively frozen: features read `calcForDisplay` output, never reimplement it.
- **Three-audit gate** (`npm run build` then `audit:build`, `audit:storage`, `audit:web`) green after every change, plus an `xcodebuild` compile of both schemes for any Swift change. **One commit per fix**, message explains the why. When a change deliberately alters pinned behaviour, update the storage-audit pins in the same commit — never delete a pin to make a failure go away.
- **Frozen invoices.** Sent invoices are snapshots; nothing ever mutates them — corrections and additions are new documents referencing the original (the late-payment ruling below depends on this).
- **Migration landmine rule.** Bug-fixes may repair saved data; preference changes are defaults for new shoots only, never retroactive. Load-time normalisation lives in `migrateProduction` (idempotent, silent, converges in a single pass — pinned by HH2c); the versioned `MIGRATIONS[]` chain is only for one-time raw-data transforms. Rate snapshots on crew/day records are sovereign: only user-facing, event-driven flows may move them.
- **Ledger pattern for new storage.** Any new persisted store is its own `bigals_*` key — never fields on day records or productions. Ref-loaded once, write-through, capped and pruned. Precedents to copy: `bigals_la_applied_events`, `bigals_overdue_fired`, `bigals_health_steps`.

## Reference docs

- **MAINTENANCE.md** — dated/triggered parked work: the launch-day beta-copy swap list (fires on App Store approval), the 1 September 2026 static marketing rate-label update, the iOS-27 `requestConfirmation` fallback deletion.
- **BACKLOG.md** — the full 5.2-candidate rationale, the audit tidy list (K1–K10), and far-future tier notes (grandfathering commitment, the never-lock-existing-data cap rule).
- **APA_RULES.md** — authoritative pay rules. **CLAUDE.md** — operating rules. `memory/` (session-side) carries the same facts; the repo docs are the shared source.

## v5.2 scope

Four features, in rough dependency order. The first two are self-contained engineering; the last two are **propose-first money features whose design will arrive from the planning chat** — do not start building them from this document alone.

### 1. iCloud snapshot backup
**Why (BACKLOG.md):** device backup is restore-only and whole-device; deleting the app deletes the data. A real "your shoots survive anything" story needs an explicit snapshot.
**Grounding already established (O10, verified in code + Apple's documented semantics):** iOS data persists via `@capacitor/preferences` → `UserDefaults` → the app container's `Library/Preferences` plist. That location **is in the iCloud device-backup set by default** and **is not evictable** under storage pressure — so the floor is already safe; the gap is sync/restore ergonomics, not durability. Design sketch on file: periodic JSON snapshot (the existing backup-export shape) written to the app's iCloud Drive container via the Filesystem plugin — last-writer snapshot, explicit restore, no CloudKit schema; `NSUbiquitousKeyValueStore` ruled out (1MB cap). New persisted state (last-snapshot timestamp etc.) follows the ledger pattern.

### 2. Accountant export
**Why:** the tax-year handover is currently manual. **Shape agreed:** one CSV row per invoice — date, client, invoice number, gross, paid date, status — plus a totals summary and the tax-year mileage total. **Grounding:** reuses frozen invoice snapshots (never recomputed) and the existing CSV plumbing pinned by the NN-series assertions; UK tax-year boundaries (6 April) already exist in the stats windowing.

### 3. Late-payment module — propose-first, design incoming
**Why:** statutory late-payment rights are money crew routinely leave uncollected. **Ruled constraints already fixed:** interest at 8% + Bank of England base rate with the base rate as an **updateable value** (never hardcoded without an update path); fixed recovery fee £40 / £70 / £100 by invoice size; implemented as a **supplementary invoice referencing the frozen original — the original is never mutated** (this is the frozen-invoice law applied, not a new idea). Everything else — surfaces, flows, copy — waits for the planning chat's design.

### 4. Chase emails — propose-first, design incoming
**Why:** paired with late payment; three escalating templates (friendly nudge → firmer reminder → statutory notice referencing the Act and the supplementary invoice). Sentence case, British English, no em dashes in UI copy (ruled in O4); tone review before shipping, like the Legwork copy round. Design and copy arrive from the planning chat.

## First moves for the next session

1. Pull main, run the three-audit gate, confirm 1,088/171 and both schemes compile — establish the baseline before touching anything.
2. Check TestFlight/App Store review status: if 5.1 is approved, execute MAINTENANCE.md's launch-day swap list before anything else (it deploys the moment it lands on main).
3. Work v5.2 features on this branch (or per-feature branches off it); main stays release-only.
