# Backlog — 5.2 candidates and beyond

Ordered notes, not commitments. Each entry carries its rationale and any grounding already done, so future planning starts from facts rather than folklore.

## 5.2 candidates

### iCloud backup — grounding verified, design note
**Where data lives today (verified in code):** on iOS the storage bridge persists through `@capacitor/preferences`, i.e. `UserDefaults` — physically the app container's `Library/Preferences` plist. Two consequences, both verified against Apple's documented backup semantics:

- **It IS in the iCloud device-backup set.** `Library/Preferences` is included in iCloud Backup and encrypted local backups by default (only `Caches`, `tmp`, and files explicitly excluded from backup are omitted). A user with device backup on already has a restorable copy — privacy.html already discloses this.
- **It is NOT evictable.** Storage-pressure purging applies to `Caches`/`tmp`, never `Library/Preferences`. No risk of iOS silently discarding productions.

**The gap:** device backup is restore-only and whole-device — it is not sync, and deleting the app deletes the data. A real "your shoots survive anything" story needs an explicit iCloud container. Design sketch for consideration: periodic JSON snapshot (the existing backup-export shape) written to the app's iCloud Drive container via the Filesystem plugin — no CloudKit schema, no sync conflicts (last-writer snapshot, restore is explicit), works offline, and `NSUbiquitousKeyValueStore` is ruled out (1MB cap). Effort: small plugin surface + Settings restore flow.

### Late-payment module
Statutory late-payment support for sent invoices, per the Late Payment of Commercial Debts (Interest) Act:
- **Interest:** 8% + Bank of England base rate. The base rate MUST be an updateable value (a dated constant in code with a Settings override, or fetched manually by the user — never hardcoded without an update path).
- **Fixed recovery fee:** £40 (< £1,000), £70 (£1,000–£9,999.99), £100 (≥ £10,000), by invoice size.
- **Implementation rule:** a supplementary invoice referencing the frozen original — the original is NEVER mutated (frozen-invoice law holds). The supplementary carries interest-to-date and the fixed fee as its own line items with its own number.
- **Chase emails:** paired escalating templates — friendly nudge → firmer reminder → statutory notice (the last referencing the Act and the supplementary invoice). Sentence case, British English; tone review before shipping.

### Accountant export
Tax-year CSV: one row per invoice — date, client, invoice number, gross, paid date, status — plus a totals summary block and the tax-year mileage total. Reuses the frozen invoice snapshots and the existing CSV plumbing (NN-series). UK tax year boundaries (6 April) already exist in the stats windowing.

### Wrapped — year in review
Shareable image card, December ship, **comedy stats only, no money** (money on a shareable image is a privacy foot-gun): days worked, OT hours, late lunches, earliest call, latest wrap, steps/km (Legwork data), most-frequent production. **Needs a mid-year start**: some stats (earliest call, steps) need the data retained from summer onward — confirm the retention story by ~September for a December ship.

## Audit tidy list (from the 5.1 pre-submission audit)

- K1: remove orphaned storage keys (`bigals_idb_optin` write-only; legacy `bigals_production`/`bigals_crew`/`bigals_days` names in the KEYS bootstrap list).
- K2: refresh stale comments describing superseded designs ("Apply to N crew" chip ~2751, accept/decline note ~24203, "BOOKED type" wording ~4589, storage-test TT12d count comment).
- K3: `package.json` version 1.0.0 → app version (cosmetic).
- K4: empty-state register convergence (one template; fold into the voice-and-tone pass).
- K5: role/rate fields on three surfaces (Settings §You, new-production defaults, production "Your role") — document precedence or unify.
- K6: "Set up invoicing" gate discoverability (the Invoices tab is visible; the name gate is only met inside it).
- K7: onboarding polish — step 3 header parity ("Step 3 of 3"), blank-name handling on step 1.
- K8: web empty-state "New production" button prominence.
- K9: handled — tracked in MAINTENANCE.md (1 Sept 2026 static marketing rate labels).
- K10: verify on device that the standalone calculator seed shows the table rate for a skip-setup user (believed fixed by I2's `seedRateFromPrefs` wiring; the prefs-verbatim sites that remain are the explicit "Reset to my default" buttons, which are by design).

## Far future — tier notes (sketch only, no commitment)

- **Free/lite:** calculator + a small number of shoots; the tool stays genuinely useful free — the beta promise ("free during beta") converts into a real free tier, and existing beta users are **grandfathered** into whatever they have today. That commitment is worth honouring loudly.
- **Pro:** unlimited shoots, invoicing suite (CSV exports, late-payment module, accountant export), Wrapped.
- **Best Boy:** the crew-management mode as its own tier (it is the only surface built for running *other people's* timesheets); a **weekly BB pass** idea — short-lived purchase covering a single job week — fits how dailies actually work better than a subscription.
- **Shoots-cap concern:** any free-tier cap must never lock users out of *existing* data (read-only past the cap, never deletion or ransom); caps apply to creating new shoots only.
