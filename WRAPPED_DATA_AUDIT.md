# Wrapped data audit

Phase 0 scoping for an end-of-year "TimeMachine Wrapped". Read-only audit of what
the current data model and the existing Apple Health integration can and cannot
tell us. No app code, schema, migration, calc or native code was changed.

Audited against the working copy on `develop` at `5dab959`, `APP_VERSION`
`2026.11`, `SCHEMA_VERSION` 4. `develop` has no upstream and has diverged from
`origin/main` (develop +144, origin/main +42, merge base `b2d5bcc`), so anything
here describes `develop`, not what is live.

Citations are file plus function or constant name. No line numbers, per the brief.
Unless stated otherwise, every citation is `index.html`.

**Everything below about native behaviour, including all HealthKit behaviour, is a
reading of the Swift and JS source. Nothing native was executed, built or observed
on a device or in the preview pane.**

---

## Summary

The work, time, break and travel material for a Wrapped is already there. The
money material is already there and is safe to read. The two real gaps are Health
distance and anything to do with app usage.

What is genuinely available now, on stored data, through functions that already
exist: shoot day counts, production counts, worked hours, longest and shortest
day, day type breakdown, distinct production companies, consecutive run length,
overtime, pre-call, call and wrap extremes, night shoots, weekend and bank
holiday days, break penalties, continuous working days, turnaround
contraventions, miles, travel minutes, and the full invoice money set including
sent-to-paid intervals.

Five findings shape any Wrapped design.

**One. Ownership is the single largest correctness risk, and it fails in both
directions.** `userCrewIdsInProduction` returns *every* crew id when
`production.bestBoyMode` is false, and returns an *empty* array when Best Boy
mode is on and `userPrefs.displayName` is blank. A user who turned Best Boy mode
off on a multi-crew job would have the whole crew's money and hours counted as
their own. A user who never set a display name silently loses every Best Boy
production. Naive summing gets earnings and hours wrong; day counts are partly
protected by set-dedupe on `productionId:date`, which makes the inconsistency
worse rather than better, because counts and money then disagree.

**Two. Health gives steps and nothing else.** `HealthStepsPlugin.swift` declares
exactly one quantity type, `stepCount`. Distance walking or running is not
requested, not read, and cannot be obtained without new Swift, a new Info.plist
purpose string is not needed but a new read type is, and a new App Store review
pass on the changed Health usage. Steps are cached per day record in
`bigals_health_steps`, keyed to the resolved call-to-wrap window, not to a
calendar day.

**Three. The existing stats screen is APA-only.** `StatsScreen` does
`if (agreementOf(p) !== 'apa') continue`. Every long-form Pact/Bectu production is
silently skipped. A Wrapped that reuses the stats aggregation inherits that hole.

**Four. Nothing records app usage.** There are no export counters, no email
counters, no backup counters, and no install date. `production.createdAt` is read
as a sort fallback in the productions list but is never written by any creation
path, so it is a phantom field. The only real wall-clock timestamp on any user
record is `invoice.createdAt`, stamped in `mintInvoiceShell`.

**Five. Money needs no recomputation.** Every money stat can be read straight off
frozen `invoice` fields. The frozen-record rule is not at risk.

A Wrapped built from this data can be generated entirely on device. Nothing in
the read paths involved touches the network.

---

## 1. Storage map

### Keys in use

All primary keys go through the `storage` adapter IIFE, whose `KEYS` array is the
warm list both the IndexedDB and Preferences backends seed from at boot.

| Key | Holds | In `KEYS` | In backup |
|---|---|---|---|
| `bigals_productions` | JSON array of production objects. The primary data. | yes | yes |
| `bigals_user_prefs` | JSON object of preferences and defaults. | yes | yes |
| `bigals_schema_version` | Integer as string. `SCHEMA_VERSION_KEY`. | yes | as `schemaVersion` |
| `bigals_pre_migration_backup` | Raw snapshot taken before a migration batch. `PRE_MIGRATION_BACKUP_KEY`. | yes | no |
| `bigals_invoice_charges` | Late-payment charges ledger, one record per invoice id. | yes | yes, via `BACKUP_LEDGER_KEYS` |
| `bigals_overdue_fired` | `{ [invoiceId]: { dueDate, firedAt } }`, capped at 200. | yes | yes, via `BACKUP_LEDGER_KEYS` |
| `bigals_la_applied_events` | Array of applied Live Activity event ids, sliced to the last 200. | yes | yes, via `BACKUP_LEDGER_KEYS` |
| `bigals_health_steps` | `dayRecordId -> { steps, windowStart, windowEnd, fetchedAt, settled }`. `HEALTH_STEPS_KEY`. | yes | no |
| `bigals_icloud_backup_meta` | `{ lastWriteDay, lastWriteAt, lastFilename }`. Single object, overwritten. | yes | no |
| `bigals_production`, `bigals_crew`, `bigals_days` | Legacy pre-array singletons, absorbed then removed by the one-time upgrade in the App root. | yes | no |

Three further keys sit deliberately outside `bigals_*`, so they join no warm
list, no migration and no backup envelope:

- `bigals_idb_force_off` (`FORCE_LS_KEY`), plain localStorage, the emergency
  IndexedDB off switch driven by `?idb=0`. Named `bigals_` but read directly from
  `localStorage`, not through the adapter.
- `tm_theme`, plain localStorage, a pre-paint mirror of `userPrefs.theme`.
- `tm_longform_wizard_draft` (`DRAFT_KEY`), the long-form creation wizard's
  crash-survival draft, expiring after three days.
- `__idb_ls_import_complete` (`IDB_IMPORT_MARKER_KEY`) and `bigals_native_migrated`
  (`MIGRATED_FLAG`) are backend-migration markers internal to the adapter.

None of the four non-record keys is relevant to Wrapped.

### Top-level record shapes

`bigals_productions` is a flat array. Everything else hangs off it:

```
production
  ├── crew[]        crew member records
  ├── days[]        day records, linked to crew by day.crewId
  ├── invoices[]    invoice records, each with lineItems[] and dayBreakdown[]
  ├── weeks[]       long form only
  ├── dayDefaults{} date -> per-date default overlay
  └── kitDeals[]    per-production negotiated kit totals
```

There is no separate expense collection. Expenses live on `day.expenses`, one
array per day record, shaped by `migrateExpenseEntry`.

### Schema version and migrations

`SCHEMA_VERSION = 4`. `runMigrations` runs once per page load before
`ReactDOM.createRoot`, reads `getStoredSchemaVersion` (0 means never set), calls
`takePreMigrationSnapshot`, applies each numbered `MIGRATIONS[v]` in order, then
stamps the version. Any throw calls `restoreFromPreMigrationSnapshot`. A failed
snapshot write aborts before any migration runs.

| v | What it did |
|---|---|
| 1 | Ran `migrateProduction` over every stored production, normalising the whole record to the current shape. |
| 2 | Added an explicit `wrapped` boolean to every day, backfilled from date: strictly past means wrapped, today and future mean not. `migrateDay` carries the same backfill as a safety net for imported records. |
| 3 | Cleared the legacy flat Bectu `otRate` stamped on rigger crew (Master 102, Advanced and Standby 78) so the APA path applies, but only where the value still equalled that default, preserving genuine custom rates. |
| 4 | Expenses rework. Rewrote every day's expenses to `{id, presetId, name, amount, detail}`, folded the legacy `perDiemAmount` scalar into a `builtin-perdiem` instance, and materialised the about-to-be-removed `resolveDay` expenses and per-diem cascade onto each day's own array using `production.dayDefaults`, before the cascade was deleted. |

Note that a great deal of shape normalisation is *not* in `MIGRATIONS` at all. It
runs on every load through `migrateProduction`, which is passed to
`useStoredState` for `bigals_productions`. That function backfills `dayDefaults`
from existing crew records, collapses time fields that equal their date default
to `undefined` so the cascade fires, promotes client fields up from invoices, and
performs the G3 `startDate` snap. It is idempotent and re-asserted every load.
For Wrapped this matters: **the array in memory is not the array on disk**, and
the in-memory one is the one to read.

`userPrefs` gains new keys by merge-over-`DEFAULT_USER_PREFS` on read in
`useStoredState`, not by migration. Most preference additions therefore carry no
schema bump.

### Native versus web paths

`storage` selects a backend once:

- Native (Capacitor present and `isNativePlatform()`): `@capacitor/preferences`,
  warmed from `KEYS` at boot into a synchronous in-memory cache.
- Web with IndexedDB and no force-off: IndexedDB, the Phase 2 default, also
  warmed from `KEYS`.
- Web otherwise: plain `localStorage` pass-through.

The synchronous cache is why the `KEYS` warm-list rule in `CLAUDE.md` is
load-bearing. `get()` reads the cache, so a persisted key missing from `KEYS`
reads `null` on every launch and `useStoredState` writes its default over the
durable record.

### Practical size limits

Not measured, so partly unknown, but the code names its own concerns:

- The invoice builder comments that `logoBase64` is deliberately *not*
  snapshotted per invoice, citing roughly 500KB per copy against "iOS Safari 5MB
  localStorage cap" (`mintInvoiceShell`). One logo lives in `userPrefs`, once.
- The IndexedDB boot path treats a `navigator.storage.estimate()` quota under
  50MB as a private-browsing tell, and calls 5MB "the legacy localStorage cap".
- IndexedDB and Capacitor Preferences are both far above the 5MB localStorage
  ceiling, so a multi-year store is not a problem on the default paths. The
  exposure is the `localStorage` fallback (force-off, IndexedDB absent, private
  browsing), where several years of day records plus frozen invoice snapshots
  could approach 5MB.

The largest per-record cost is frozen invoice data: every sent invoice carries
its own `lineItems` and `dayBreakdown`, and `dayBreakdown` carries a full copy of
each day's calc lines. Rough order of magnitude is a few KB per invoice. A heavy
user at, say, 40 invoices a year would add low hundreds of KB a year. **Exact
per-record byte sizes are unknown from the code alone**; nothing in the repo
measures them, and no size telemetry exists.

Wrapped adds no storage of its own if it is computed live.

---

## 2. Field inventory

"Reliable on old records" means: does a record created before the current version
reliably carry the field.

### Production (APA)

Set by `makeApaProduction`, `makeImportedProduction`. Normalised every load by
`migrateProduction`.

| Field | Type | Set in | Mutated in | Default | Reliable on old records |
|---|---|---|---|---|---|
| `id` | string | `makeApaProduction` | never | `uid()` | yes |
| `title` | string | `makeApaProduction` | job settings editor | `""` | yes |
| `prodCo` | string | `makeApaProduction` | job settings, and promoted from latest invoice `toName` by `migrateProduction` | `""` | yes, but may be empty; stats bucket empty as `(Unknown)` |
| `jobReference`, `invoicingEmail`, `ccEmail`, `toAddress` | string | `makeApaProduction` | job settings, promoted from invoices by `migrateProduction` | `""` | backfilled by `migrateProduction` |
| `crew[]` | array | `makeApaProduction` | crew editors | `[]` in Best Boy mode, one seeded member solo | yes |
| `days[]` | array | `makeApaProduction` | day editors | `[]` | yes |
| `invoices[]` | array | absent at creation | `mintInvoiceShell` | absent, read as `(p.invoices \|\| [])` | no, absence is normal |
| `defaultDay` | object | `makeApaProduction` | rarely | `DEFAULT_PRODUCTION_DAY` | yes |
| `dayDefaults{}` | object | `makeApaProduction` | day editors, backfilled by `migrateProduction` | `{}` | backfilled by `migrateProduction` on every load |
| `bestBoyMode` | boolean | `makeApaProduction` | Settings `Toggle` in job settings | `p.bestBoyMode ?? (crew.length > 1)` in `migrateProduction` | backfilled by `migrateProduction` |
| `iAmCrewId` | string or null | `makeApaProduction` | crew editor "this is me" | `null` | backfilled to `null` by `migrateProduction` |
| `viewMode` | string | `makeApaProduction` | view switcher | `'grid'` in `migrateProduction`, `'mobile'` at creation | backfilled |
| `startDate` | ISO date | `makeApaProduction` | derived every load by `deriveStartDate` via the G3 snap in `migrateProduction` | `todayISO()` | yes, and silently corrected to the earliest dated day |
| `isElevenHourDay` | boolean | `makeApaProduction` | job settings | `false` | backfilled |
| `roundingMode` | string | `makeApaProduction` | job settings | `roundingModeOf(userPrefs)` | backfilled by `roundingModeOf` |
| `mileageRatePerMile` | number | `seededMileageRate` | job settings | `userPrefs.defaultMileageRate` | no, absent falls back to 0.5 in `calculateDay` |
| `satRateMode`, `sunRateMode`, `satRateCustom`, `sunRateCustom` | string, number | job settings only | job settings | absent, `calculateDay` reads `?? "apa"` | no, absence is the default |
| `dayTypeRates{}` | object | job settings (custom day rates, 2026.11) | job settings | absent | no, new in this release |
| `kitDeals[]` | array | kit deal editor | kit deal editor | absent | no |
| `liveActivityEnabled` | boolean | `makeApaProduction` | job settings | `true`, normalised in `migrateProduction` | backfilled |
| `cancellationData` | object or null | cancellation sheet | cancellation sheet | `null` in `migrateProduction` | backfilled |
| `gridDates[]`, `weekStarts[]` | arrays | grid editor | grid editor | `[]` in `migrateProduction` | backfilled |
| `standalone` | boolean | standalone invoice creation | never | absent | no, absence means a real shoot |
| `createdAt` | string | **never written by any creation path** | never | absent | **no. Read as a sort fallback in the productions list `sortKey`, but no code writes it. Treat as absent.** |

### Production (long form, additive)

Set by `makeLongFormProduction`. An APA production never gains these.

| Field | Type | Set in | Default | Reliable |
|---|---|---|---|---|
| `agreement` | `'pact-tv'` or `'pact-film'` | `makeLongFormProduction` | absent means APA, via `agreementOf` | yes on LF records |
| `agreementVersion` | string | `makeLongFormProduction` | `''` | yes |
| `band` | number | `makeLongFormProduction`, TV only | 4 | TV only |
| `baseNation` | string | `makeLongFormProduction` | `'england-wales'` | yes |
| `ppStartDate` | ISO date | `makeLongFormProduction` | `todayISO()` | yes |
| `weekStartDay` | string | `makeLongFormProduction` | `'monday'` | yes |
| `scheduledFilmingDays` | number | `makeLongFormProduction`, only when > 0 | absent | no, written only when used |
| `weeks[]` | array | `makeLongFormProduction`, minted by `ensureLfWeek` | `[]` | yes |
| `jobWrapped` | boolean | job settings | absent, `!== true` reads as in progress | no |

### Day record (APA)

Set by `makeBlankDay`. Normalised by `migrateDay`, resolved for reading by
`resolveDay`.

**Critical for Wrapped: `makeBlankDay` deliberately omits `callTime`, `wrapTime`,
`dayType`, `lunchStartTime`, `lunchDurationMins`, `secondBreakStartTime`,
`mileagePostcode`, `mileageMethod` and `mileageRoundTrip`, so `resolveDay`
cascades them from `dayDefaults`. `migrateProduction` additionally deletes any
stored value equal to its date default. Reading these off the raw day record
returns `undefined` for a large share of real records. Always go through
`resolveDay`.**

| Field | Type | Set in | Mutated in | Default | Reliable |
|---|---|---|---|---|---|
| `id` | string | `makeBlankDay` | never | `uid()` | yes |
| `crewId` | string | `makeBlankDay` | never | `""` | yes |
| `date` | ISO date | `makeBlankDay` | date editor | `todayISO()` | yes |
| `dayType` | string | omitted; explicit only | day editor | cascade to `dayDefaults` then `DEFAULT_PRODUCTION_DAY.dayType` = `"Shoot"` | resolved, not stored. `migrateDay` coerces an unknown value to `"Shoot"` |
| `callTime`, `wrapTime` | `"HH:MM"` | omitted; explicit only | day editor, Live Activity ingest | cascade, then `"08:00"` / `"19:00"` | resolved, not stored |
| `wrapNextDay` | boolean | `makeBlankDay` | day editor | `false` | yes |
| `wrapped` | boolean | `makeBlankDay` | wrap action | `false` at creation | **backfilled by MIGRATIONS[2] and again by `migrateDay`**, past = true |
| `lunchStartTime` | `"HH:MM"` or null | omitted; explicit only | day editor, Live Activity ingest | cascade, then `"13:30"`. `null` means missed | resolved; `migrateDay` derives it from legacy `lunchState` when absent |
| `lunchDurationMins` | number | omitted; explicit only | day editor | cascade, then 60 | resolved |
| `lunchLogged` | boolean | `makeBlankDay` | lunch action | `false` | **backfilled by `migrateDay`**, past = true |
| `secondBreakStartTime` | `"HH:MM"` | omitted at blank, set by several editors | day editor | derived `lunchEnd + 5` in `migrateDay` | backfilled by `migrateDay` |
| `secondBreakDurationMins` | number | `makeBlankDay` | day editor | 0 | yes |
| `secondBreakLogged` | boolean | `makeBlankDay` | second break action | `false` | **backfilled by `migrateDay`** from duration > 0 |
| `cwdBreak1Given`, `cwdBreak2Given` | boolean | `makeBlankDay` | CWD editor | `true` | yes |
| `noMealProvided` | boolean | `makeBlankDay` | day editor | `false` | yes |
| `preCallTime` | `"HH:MM"` | `makeBlankDay` | day editor | `""`, value-presence cascade | yes |
| `truckCallTime` | `"HH:MM"` | legacy only | never | absent | legacy. `migrateDay` copies it to `preCallTime` and keeps it for rollback |
| `miles` | number | `makeBlankDay` | `MileageInput` | 0, value-presence cascade | yes |
| `mileagePostcode`, `mileageMethod`, `mileageRoundTrip` | string, string, boolean | `MileageInput` only | `MileageInput` | absent, `'manual'`, `true` | no on old records, absence is meaningful |
| `travelOutMins`, `travelBackMins` | number | `makeBlankDay` | day editor | 0, value-presence cascade as a pair | yes |
| `perDiemAmount` | number | `makeBlankDay` | zeroed by `migrateDayExpenses` | 0 | **retired. MIGRATIONS[4] folded any value into a `builtin-perdiem` expense and zeroed the scalar** |
| `kitMoneyAmount` | number | `makeBlankDay` | day editor | 0 | yes |
| `kitItems[]` | array of `{itemId, name, rate}` | `makeBlankDay` | kit toggles | `[]` | **no. Kit Inventory Stage 2. Every read is `(day.kitItems \|\| [])`** |
| `expenses[]` | array | `makeBlankDay` | expense editor | `[]` | **rewritten to the new shape by MIGRATIONS[4]** |
| `stepUpRole`, `stepUpBDR`, `stepUpOTCoef` | string, number, number | `makeBlankDay` | step-up editor | `""`, 0, 1 | yes |
| `note` | string | `makeBlankDay` | note editor | `""` | backfilled by `migrateDay` |
| `preCallEnabled`, `kitMoneyEnabled`, `perDiemEnabled`, `travelTimeEnabled`, `stepUpEnabled`, `mileageEnabled`, `expensesEnabled` | boolean | legacy | **deleted by `migrateDay`** | n/a | removed. Value presence drives activation |
| `lunchState`, `lunchCurtailMins`, `secondBreakState`, `secondBreakCurtailMins` | legacy | legacy | read once by `migrateDay` to derive times | n/a | legacy only |

### Day record (long form)

Set by `makeLongFormDay`. Distinct shape. `LF4` pins that it has **no `callTime`
and no `preCallTime`**.

| Field | Type | Default | Reliable |
|---|---|---|---|
| `id`, `crewId`, `date` | string | `uid()`, passed, passed | yes |
| `dayType` | `'shoot'`, `'travel'`, `'rest'` | `'shoot'` | migrated from the old single-field form by `migrateLongFormDay` via `LF_DAY_TYPE_MIGRATION`, which is documented as **not lossless** |
| `dayShape` | `'swd'`, `'scwd'`, `'cwd'` or absent | `'swd'` | as above |
| `unitCallTime` | `"HH:MM"` | `'08:00'` | yes |
| `individualCallTime` | `"HH:MM"` or null | `null`, meaning unit call applies | yes |
| `lunchTime` | `"HH:MM"` | `'13:00'` | yes |
| `cameraWrapTime` | `"HH:MM"` or null | `null` | yes |
| `wrapTime` | `"HH:MM"` | `'19:00'` | yes |
| `wrapped` | boolean | `date < todayISO()` | yes |
| `cameraOtCalledMins`, `dayAgreementClass`, `dayContractDailyRate`, `sixthSeventhOverride`, `lunchMinsTaken` | mixed | absent | **no, written only when used** |
| `lfMileage`, `lfTravel` | mixed | absent | no |

### Long-form week

`makeLongFormWeek`. Bounds derived by `lfWeekBounds` from `weekStartDay`.

| Field | Type | Default | Reliable |
|---|---|---|---|
| `id`, `crewId` | string | `uid()`, passed | yes |
| `startDate`, `endDate` | ISO date | derived | yes |
| `nightWork` | `{ settlement: null \| 'rest' \| 'paid' }` | `{ settlement: null }` | yes |

`status` and `invoiceId` were removed by the long-form branch of
`migrateProduction`. Billing status is derived by `weekBillingStatus` from the
invoice's `weekIds`.

### Crew member

Set inline in `makeApaProduction`, `makeImportedProduction`,
`makeLongFormProduction` and the add-crew handlers. Normalised by `migrateCrew`.

| Field | Type | Set in | Default | Reliable |
|---|---|---|---|---|
| `id` | string | creation | `uid()` | yes |
| `name` | string | creation | `userPrefs.displayName` or `"You"` | yes |
| `role` | string | creation | `userPrefs.defaultRole` or `"Lighting Technician"` | yes. `migrateCrew` renames `"Spark"` to `"Lighting Technician"`; `ROLE_DEFAULTS` keeps a `"Spark"` alias |
| `bdr`, `otCoef`, `otRate` | number | `seedRateFromPrefs` | resolved card values | yes. MIGRATIONS[3] cleared stale rigger `otRate` |
| `noOT` | boolean | role defaults, applied on role change | absent | no, absence means OT applies. Set for Director and Producer in `RATE_CARDS` |
| `vatRegistered`, `vatRate` | boolean, number | creation from `userPrefs` | `false`, 20 | yes |
| `kitMoneyEnabled`, `kitMoneyAmount` | boolean, number | creation from `userPrefs` | `false`, 0 | yes |
| `isDriver` | boolean | creation | `false` in `migrateCrew` | backfilled |
| `email` | string | creation | `''` in `migrateCrew` | backfilled |
| `agreementClass`, `contractDailyRate` | string, number | `makeLongFormProduction` | `'standard'`, 0 | long form only |

### Invoice

Minted by `mintInvoiceShell`. Normalised by `migrateInvoice`. **Frozen at send.**

| Field | Type | Set in | Mutated in | Default | Reliable |
|---|---|---|---|---|---|
| `id` | string | `mintInvoiceShell` | never | `uid()` | yes |
| `userCrewId` | string | `mintInvoiceShell` | never | passed | yes |
| `invoiceNumber` | string | `mintInvoiceShell` | never | `prefix + padded number` | yes |
| `invoiceDate` | ISO date | `mintInvoiceShell` | never | `todayISO()` | yes |
| `dueDate` | ISO date | `mintInvoiceShell` | never | `invoiceDate + userPrefs.paymentTermsDays` | yes |
| `createdAt` | **full ISO timestamp** | `mintInvoiceShell` | never | `new Date().toISOString()` | yes. **The only wall-clock time-of-day on any user record** |
| `dateSent` | ISO date | `markSent`, the email send handler, `resendInvoice` | cleared by revert-to-draft | absent until sent | yes once sent |
| `datePaid` | ISO date | `markPaid` | cleared by revert-to-sent | absent, `null` when reverted | yes once paid |
| `status` | `'draft'`, `'sent'`, `'paid'` | `mintInvoiceShell` | `markSent`, `markPaid`, reverts | `'draft'` | yes |
| `lineItems[]` | array | `buildInvoiceLineItems` or `buildLongFormInvoiceLines` | re-frozen by `resendInvoice` only | built | yes |
| `dayBreakdown[]` | array | `buildDayBreakdown` or `buildLongFormDayBreakdown` | re-frozen by `resendInvoice` only | built, `[]` for standalone | yes |
| `dayKeys[]` | array of `crewId:date` | `mintInvoiceShell` | never | mapped from `dayBreakdown` | **no on older records. `invoiceDayClaim` falls back to deriving keys from `dayBreakdown`** |
| `weekIds[]` | array | long-form invoice creation | `resendInvoice` | absent on APA | long form only |
| `toName`, `toEmail`, `toAddress`, `jobReference`, `ccEmail` | string | `clientFieldsFromProduction` | `resendInvoice` re-snapshots | from production | `ccEmail` backfilled to `""` by `migrateInvoice` |
| `jobTitle`, `jobRole`, `shootDateStart`, `shootDateEnd` | string | `mintInvoiceShell` | never | from production | **backfilled by `migrateInvoice`** from production title, role and day dates |
| `fromName`, `fromCompanyName`, `fromAddress`, `fromEmail` | string | `mintInvoiceShell` | never | from `userPrefs` | yes |
| `bankName`, `bankAccountName`, `bankAccountNumber`, `bankSortCode`, `bankIBAN`, `bankSWIFT` | string | `mintInvoiceShell` | never | from `userPrefs` | yes |
| `vatRegistered`, `vatRate`, `vatNumber` | boolean, number, string | `mintInvoiceShell` | never | crew then `userPrefs` | yes |
| `roundingMode`, `favourableRounding` | string, boolean | `mintInvoiceShell` | never | from production | backfilled by `roundingModeOf` in `migrateInvoice` |
| `linesEdited` | boolean | `mintInvoiceShell` | line editor, reset by `resendInvoice` | `false` | backfilled by `migrateInvoice` |
| `notes` | string | `mintInvoiceShell` | notes editor | `""` | yes |
| `showIndividualExpenses` | boolean | `mintInvoiceShell` | editor | `false` | yes |
| `standalone` | boolean | standalone path only | never | absent | no |
| `logoBase64` | string | legacy | **deleted by `migrateInvoice`** | n/a | removed |

### Invoice line item

Shape defined by `makeBlankInvoiceLine` and produced by `buildInvoiceLineItems`
and `buildLongFormInvoiceLines`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | `uid()` | |
| `label` | string | `""` | |
| `detail` | string | `""` | |
| `rate` | number or null | `null` | `null` is the fixed-fee signal to the renderer |
| `qty` | number | 1 | |
| `amount` | number | 0 | |
| `discountedQty` | number or null | `null` | must be present as `null`, not absent, or the waived and reduced badge logic misreads it. `0` marks a waived-auto line |
| `isExpense` | boolean | `false` | |
| `group` | string | absent on APA | long form page-1 grouping |
| `bucket` | string | absent | `'kit'` on Stage 2 itemised kit lines |

### Day breakdown entry, on the invoice

Produced by `buildDayBreakdown`. This is the frozen per-day snapshot.

`{ date, dayType, callTime, wrapTime, hours, stepUpRole, lines[], total }`, where
`lines[]` is `{ label, detail, rate, qty, amount }` and `hours` is
`calc.meta.workedHrs`.

### Expense entry

Shape set by `migrateExpenseEntry` and MIGRATIONS[4].

`{ id, presetId, name, amount, detail }`. `presetId` is `null` for a
hand-entered entry, or one of the built-in ids. Legacy entries had
`{ category, amount, description }` and were rewritten. Built-in presets live in
`DEFAULT_USER_PREFS.expensePresets`: `builtin-perdiem`, `builtin-parking`,
`builtin-congestion`, `builtin-food`.

### User prefs

`DEFAULT_USER_PREFS`. Merged over on read in `useStoredState`, so every key here
is reliable on any record, old or new.

Identity and defaults: `displayName`, `defaultDepartment`, `defaultRole`,
`defaultBDR`, `defaultOTCoef`, `lfDefaultRole`, `defaultMileageRate`,
`defaultKitMoneyEnabled`, `defaultKitMoneyAmount`, `defaultPerDiemEnabled`,
`defaultPerDiemAmount`.

Invoicing: `legalName`, `fromCompanyName`, `fromAddress`, `fromEmail`,
`bankName`, `bankAccountName`, `bankAccountNumber`, `bankSortCode`, `bankIBAN`,
`bankSWIFT`, `invoicePrefix`, `invoiceNextNumber`, `paymentTermsDays`,
`invoiceEmailMethod`, `invoiceExportFormat`, `invoicingEnabled`,
`overdueRemindersEnabled`, `logoBase64`, `vatRegistered`, `vatRate`, `vatNumber`.

Libraries: `kitInventory[]`, `clients[]`, `expensePresets[]`.

Appearance and behaviour: `theme`, `comparisonUnit`, `customComparison`,
`celebrationEnabled`, `celebrationEmoji`, `celebrationIntensity`,
`celebrationSpeed`, `hapticsEnabled`, `liveActivityEnabled`.

Seen-flags: `onboardingComplete`, `lastSeenAppVersion`, `seenIntro`,
`seenTutorialVersion`, `seenWhatsNewVersion`, `seenPoppyIconHint`.

Set outside `DEFAULT_USER_PREFS`: `healthStepsHidden`, written by `LegworkBlock`'s
`hide`. Additive, absent by default.

**No date field anywhere in `userPrefs`.** No install date, no first-run date.

---

## 3. Apple Health integration, current state

**Everything in this section is a code reading of `ios/App/App/HealthStepsPlugin.swift`,
`ios/App/App/Info.plist`, `ios/App/App/App.entitlements` and the JS in `index.html`.
No native execution, build or device observation took place.**

### What it does today

**Permissions requested.** Read-only. `HealthStepsPlugin.requestRead` calls
`store.requestAuthorization(toShare: nil, read: [stepType])`. The only quantity
type is `HKQuantityType.quantityType(forIdentifier: .stepCount)`. There are no
write types. The entitlement is the plain `com.apple.developer.healthkit`
boolean, with no clinical-records array and no background delivery. The plugin's
own header comment states this is an App Store review posture decision.

`Info.plist` carries both `NSHealthShareUsageDescription` ("TimeMachine reads your
step count to show how far you walk on shoot days, between call and wrap. Your
steps are processed on this phone and never leave it.") and
`NSHealthUpdateUsageDescription`, the latter only because Apple's upload validator
demands it whenever the Health authorization APIs are present; its text says the
app never writes.

**Metrics.** Step count. That is the entire surface.

**How and when data is fetched.** Four bridged methods: `isAvailable`,
`getRequestStatus`, `requestRead`, `querySteps`. The JS wrapper is the
`HealthSteps` object.

`querySteps(startEpoch, endEpoch)` runs an `HKStatisticsQuery` with
`.cumulativeSum` over `HKQuery.predicateForSamples` with
`[.strictStartDate, .strictEndDate]`, and resolves a rounded integer.

The fetch is driven by `refreshHealthSteps(dayEntries)`, called from
`LegworkBlock`'s `runRefresh`, which fires on mount, meaning **once per visit to
the stats screen**. There is no background fetch and no scheduled sweep.

`healthWindowForDay(production, day, crewMember)` builds each window from
`resolveDay`, so it uses the resolved call and wrap, in **local** time, with the
engine's overnight rule (explicit `wrapNextDay`, or wrap earlier than call). No
call time means the day is ineligible and returns `null`. No wrap time gives a
`call -> now` window flagged `settleable: false`.

**Persistence.** Yes, into our own storage, but only as a cache. `bigals_health_steps`
holds `dayRecordId -> { steps, windowStart, windowEnd, fetchedAt, settled }`.
`HEALTH_CACHE_CAP` is 400 entries, pruned oldest-`windowEnd`-first.
`HEALTH_SETTLE_MS` is 36 hours: an entry only freezes once fetched at least 36
hours after the window end, because a watch can sync a day's steps overnight.
Before that, every stats visit refetches. Any change to the resolved window drops
the entry and refetches, settled or not. Ids absent from the live day set are
pruned as orphans. The key is deliberately its own ledger, never fields on day
records, per the migration-landmine rule in the comment.

The cache is **not** in the backup envelope: `BACKUP_LEDGER_KEYS` covers only
`bigals_overdue_fired`, `bigals_la_applied_events` and `bigals_invoice_charges`.

**Permission denied, or no data.** iOS read authorisation is opaque by design, as
the plugin header states: a denied read returns empty data, indistinguishable
from no data. `querySteps` therefore resolves 0 in both cases.
`getRequestStatus` reports only whether the sheet still needs presenting
(`shouldRequest`, `unnecessary`, `unknown`), never what the user chose.
`LegworkBlock` builds its state machine on that: `shouldRequest` renders the
pre-ask card, `unnecessary` queries and renders, and universally zero data
renders a quiet line plus a hide affordance. If `isAvailable` reports false the
block renders an identification line rather than nothing, deliberately, because
returning `null` erased the whole section and contributed to the 2.5.1 iPad
review rejections.

**How the web build stays clean.** Every method on the `HealthSteps` object
returns its web-safe default **before** touching the Capacitor bridge unless
`IS_NATIVE`: `isAvailable` returns `false`, `getRequestStatus` returns
`'unknown'`, `requestRead` returns `false`, `querySteps` returns `0`. This is what
`npm run audit:web` (`scripts/native-audit/web-regression.js`) exists to enforce.
No HealthKit code, and no reference to it, reaches the web bundle.

### Can we query historic Health data for dates before permission was granted

**Yes, subject to one thing the repo cannot tell us.**

Nothing in our code imposes a date floor. `querySteps` takes arbitrary
`startEpoch` and `endEpoch` doubles and builds an unbounded sample predicate.
`HKStatisticsQuery` reads whatever the device's HealthKit store holds. Once the
user grants the read, that includes samples recorded before the grant. Health
read authorisation is not retroactive in the sense of hiding history: it gates
access to the store, not to a time window.

**How far back is unknown from the repo.** It is bounded by how much history the
user's own HealthKit database holds, which depends on their device history, iCloud
Health sync and whether they have ever used an iPhone or Watch that recorded
steps. Nothing in this codebase can establish that, and I have not run anything on
a device. For a Wrapped covering 2026, the practical question is whether the user
granted the permission at some point during 2026, not whether the samples exist.

### Available today with no new native work

The bridge exposes one primitive, a summed step count over an arbitrary epoch
window. Anything expressible as that is JS-only work.

| Stat | Available with no native work | Notes |
|---|---|---|
| Total steps in a date range | **Yes** | One `querySteps` call with the range's start and end epochs. Or sum the per-day cache. |
| Steps per day | **Yes** | Already done, but keyed to the **call-to-wrap window**, not the calendar day. Calendar-day steps need a midnight-to-midnight window, which is still just a `querySteps` call with different epochs. Both are JS-only. |
| Most and least active day | **Yes** | Max and min over the same per-day values. `LegworkBlock`'s `figures` already computes `hardest` as the max-steps day. Least active needs the min, which nothing computes today, but it is the same loop. |
| Walking or running distance | **No** | Requires `HKQuantityTypeIdentifier.distanceWalkingRunning`. Not in `pluginMethods`, not in `stepType`, not in the read set. |
| Distance in miles and km | **No** | Same. HealthKit returns an `HKQuantity` that converts to either unit trivially, but only once the type is read at all. |

### What would need new native work, and what it costs

Adding walking and running distance means, at minimum:

1. A second `HKQuantityType` in `HealthStepsPlugin.swift`, added to the read set
   in `requestRead` and to `getRequestStatus`.
2. A `queryDistance` method mirroring `querySteps`, resolving a double in metres
   (`HKUnit.meter()`), with unit conversion left to JS.
3. A JS bridge method on `HealthSteps` with the same `IS_NATIVE`-first guard, or
   `audit:web` fails.
4. A cache-shape decision on `bigals_health_steps`: either add a `distance` field
   to the existing entries, which changes a persisted shape, or a second key,
   which must join the `KEYS` warm list in the same commit.

Costs beyond the code: a new device build and Health permission walk, since
changing the read set makes `getRequestStatus` return `shouldRequest` again for
existing users, so everyone is re-prompted. The `NSHealthShareUsageDescription`
string would need rewording, because it currently promises only step count. That
string is user-facing and App Review reads it. This is a propose-first change
under `CLAUDE.md`, and it touches native code, so it is out of scope for Phase 0.

---

## 4. Ownership and multi-crew

Three functions decide whose records are the user's.

`resolveUserCrewId(production, userPrefs)`: the manual override
`production.iAmCrewId` wins if it still matches a crew member; otherwise it
auto-matches a single crew member by case-insensitive trimmed
`userPrefs.displayName`; otherwise `null`.

`getEffectiveUserCrewId(production, userPrefs)`: `resolveUserCrewId`, and if that
is null, falls back to `crew[0].id` when the production is not in Best Boy mode
and has exactly one crew member.

`userCrewIdsInProduction(production, userPrefs)`: **this is the one the stats
screen and `LegworkBlock` use**, and it behaves differently:

- If `production.bestBoyMode` is **false**, it returns **every crew id in the
  production**. It does not consult `displayName` or `iAmCrewId` at all.
- If Best Boy mode is **on**, it returns every crew id whose name matches
  `displayName`, which is normally one, and **an empty array when `displayName`
  is blank**.

### What happens when ownership is unset

Two distinct failures.

**Blank display name plus Best Boy mode.** `userCrewIdsInProduction` returns `[]`.
`StatsScreen` counts that production into `excludedCount` and skips it entirely.
The user loses the whole job from their totals. The stats screen surfaces this as
a hint; a Wrapped that did not would silently under-report. Note that
`iAmCrewId`, the manual override, is **not** consulted by
`userCrewIdsInProduction`, only by `resolveUserCrewId`. So a user who has
explicitly tapped "this is me" on a Best Boy job but has no display name is
**still** excluded from stats. That is a live inconsistency between the two
resolvers.

**Best Boy mode off on a multi-crew production.** `bestBoyMode` is a plain
`Toggle` in job settings, and `migrateProduction` only defaults it to
`crew.length > 1` when it is absent. A user who turns it off on a job where they
logged five people gets **all five people's day records counted as their own**.

### Which stats would be wrong if we naively summed everything

| Stat | Wrong how |
|---|---|
| **Earnings** | **Over-counted, potentially several-fold.** `StatsScreen` sums `e.calc.total` over `enrichedDays`, which is one entry per **day record**. In the Best-Boy-off case, every crew member's total for every date is added. |
| **Hours** | **Over-counted the same way.** `totalHours` sums `calc.meta.workedHrs` per day record. |
| **Day counts** | **Partly protected, and that is the problem.** `workingDaysSet`, `shootDaysSet` and `dayTypeMap` all key on `` `${production.id}:${date}` ``, so multiple crew on one date collapse to one entry. Counts stay right while money and hours multiply, so **derived figures disagree with each other**: `avgDayEarnings` (`totalEarnings / workingDaysSet.size`) and `avgShootLen` (`shootHours / shootDaysSet.size`) are both inflated by the crew count. |
| **Longest streak** | Correct. `workingDates` dedupes on bare `date`. |
| **Highest-earning day** | **Over-counted.** `earningsByDay[pKey].amount += e.calc.total` accumulates every counted crew member's total into one date bucket. |
| **Distinct productions** | Correct. `new Set(enrichedDays.map(e => e.production.id))`. |
| **Health steps** | Not over-counted in value, but wasteful and wrong in shape. `LegworkBlock`'s `dayEntries` uses the same `userCrewIdsInProduction`, so it would query one call-to-wrap window per crew member. Since the windows are usually identical, `total` and `n` in `figures` both inflate by the crew count while the per-day figures stay right. |

**Recommended handling for Wrapped: use `resolveUserCrewId` with a
`getEffectiveUserCrewId` fallback, resolve to at most one crew id per production,
and count productions that resolve to nothing separately so they can be surfaced
rather than silently dropped.** Do not reuse `userCrewIdsInProduction`.

---

## 5. Data completeness

Frequencies are **unknown**: there is no telemetry in this repo, no sample data
set, and no analytics. What follows is what the code makes possible and how each
case behaves, which is what can be established from source. Anywhere I say
"common" I mean structurally expected, not measured.

### Missing call or wrap times

Structurally very common **on the raw record and essentially absent after
resolution**. `makeBlankDay` omits `callTime` and `wrapTime` entirely, and
`migrateProduction`'s time-field collapse deletes any stored value that equals its
`dayDefaults` entry. So most day records genuinely have no `callTime` key.
`resolveDay` then supplies it from `dayDefaults[date]`, then
`production.defaultDay`, then `DEFAULT_PRODUCTION_DAY` (`"08:00"` / `"19:00"`).

Genuinely unresolvable times are rare, because the terminal fallback always
produces a value. The real case is a corrupt time string:
`migrateDay` and `resolveDay` both drop any non-empty string that fails
`parseHHMM`, citing an old `"NaN:NaN"` wrap from a fixed `onCallChange` bug.

`deriveBreakState` returns `null` when call or wrap will not parse, and
`calculateDay` then returns a zero day with the note "Missing or invalid
call/wrap time". Those days have `workedHrs: 0` and `total: 0`.

**Distortion:** a day resolving to the 08:00 to 19:00 default contributes 11
hours to a yearly total whether or not the user ever entered anything. That is
the app's designed behaviour and the invoice would say the same, so it is not
wrong, but a Wrapped headline of "you worked N hours" inherits every defaulted
day. **Safe handling: report hours from `calc.meta.workedHrs` as the invoice
would, and separately count days where the raw record carried no explicit
`callTime` and no `dayDefaults` entry, so a "mostly defaults" year can be
detected before it is celebrated.**

### Imported or backfilled days

Two import routes exist.

`makeImportedProduction` builds days from a decoded share link via
`makeBlankDay` plus explicit wire fields. The comment is explicit: records are
born at the current schema, **nothing wrapped or logged, times are the plan not
the record**. So `wrapped: false`, `lunchLogged: false`, `secondBreakLogged: false`.

`importBackup` restores a whole store, refuses a file whose `schemaVersion`
exceeds `SCHEMA_VERSION`, then runs `runMigrations`.

**Distortion:** an imported shoot that was never actually worked still carries
call, wrap and lunch times, so it counts fully into hours, days and money.
**Safe handling: there is no import marker on a day record. This is unrecoverable
from stored data.** See section 13.

### Unwrapped days

`day.wrapped` is a real field, backfilled by MIGRATIONS[2] and `migrateDay` from
`date < todayISO()`. `StatsScreen` counts a day dated today only when
`day.wrapped === true`, and tallies the rest as `notYetCountedDays`.

The important caveat is in the stats comment itself: **only the solo flows set
`day.wrapped`. Best Boy multi-crew days keep the date-based behaviour.** So
`wrapped` is a reliable signal on solo jobs and an approximation elsewhere.

**Distortion:** for a year already ended, negligible, since every day is in the
past and the backfill made them all `true`. **Safe handling: for a Wrapped run in
late December on the current year, exclude days dated after today outright and
apply the same `wrapped === true` rule to days dated today.**

### Future-dated days

Fully supported. Users pencil in bookings. `StatsScreen` excludes them with a
strict `day.date > today`, wrapped or not, and tallies them as not yet counted.

**Distortion:** a Wrapped generated in November for the calendar year would
otherwise include December bookings that have not happened. **Safe handling:
bound the window at `min(31 December, today)` and state the bound.**

### The same calendar date in two productions

Entirely possible: nothing prevents it, and a day-rate freelancer doing a half-day
on two jobs is a real scenario.

`StatsScreen` handles this **inconsistently on purpose and by accident**:
`workingDaysSet` and `shootDaysSet` key on `productionId:date`, so two productions
on one date count as **two** days. `workingDates`, used for the streak, keys on
bare `date`, so they count as **one**.

**Distortion:** "you worked 214 days this year" can exceed the number of calendar
dates worked. **Safe handling: pick one meaning and state it. For a Wrapped,
"days worked" reading as distinct calendar dates is the more intuitive claim, and
"jobs worked" can carry the double-booking separately.**

---

## 6. Year bounding and time handling

### How dates are stored

Every date on a record is a bare `"YYYY-MM-DD"` string with no time and no zone:
`day.date`, `invoice.invoiceDate`, `invoice.dueDate`, `invoice.dateSent`,
`invoice.datePaid`, `production.startDate`, `week.startDate`, `week.endDate`.

Times are separate `"HH:MM"` strings parsed by `parseHHMM` into a float hour.

The one exception is `invoice.createdAt`, a full ISO 8601 UTC timestamp from
`new Date().toISOString()`.

### Timezone assumptions

The codebase is deliberately string-first on dates, and where it must use `Date`
it pins noon:

- `dayOfWeek(iso)` builds `new Date(iso + "T12:00:00")`, local noon, so no DST
  shift can move the weekday.
- `addDays`, `daysBetweenISO`, `restHoursBetween` and `lfWeekBounds` all use the
  same `T12:00:00` anchor. There are 84 occurrences of `T12:00:00` in the file.
- Month walkers in `StatsScreen` and `aggregateMonthly` do **string** arithmetic
  on `"YYYY-MM"` keys, with an explicit comment recording the bug that motivated
  it: formatting a local-midnight `new Date(y, m, 1)` through UTC ISO read back
  the previous month east of UTC, duplicating the earliest month and dropping the
  latest.

### The one real timezone hazard

`todayISO()` is `new Date().toISOString().slice(0, 10)`, which is **UTC, not
local**. There are 25 occurrences of `toISOString().slice(0, 10)` in the file.

During BST, between local midnight and 01:00, `todayISO()` returns **yesterday's**
date. `StatsScreen` works around this by computing its own local `today` from
`getFullYear`, `getMonth` and `getDate`, with a comment saying the UTC form "made
it 1am during BST" and the workaround is deliberately scoped to the two
aggregation sites, and that `todayISO()` elsewhere is a `MAINTENANCE.md` item.

**Where a day could land in the wrong year:**

1. `makeBlankDay` defaults `date: todayISO()`. A day created just after local
   midnight during BST is stamped **yesterday**. In the UK this cannot cross a
   year boundary, because 1 January is GMT. **For a user in any zone ahead of
   UTC, it can:** a day created at 00:30 on 1 January in, say, UTC+9 is stamped
   31 December of the previous year. That day then belongs to the wrong Wrapped.
2. `mintInvoiceShell` sets `invoiceDate: todayISO()` and derives `dueDate` from
   it. Same exposure.
3. `markSent` and `markPaid` both stamp `todayISO()`. Same exposure.
4. MIGRATIONS[2] and `migrateDay` backfill `wrapped` from `d.date < todayISO()`.
   Wrong-side-of-midnight only, not a year issue.
5. `UK_BANK_HOLIDAYS` covers 2025 to 2029 inclusive. Fine for 2026, and a hard
   limit worth knowing: a Wrapped for 2030 would silently see zero bank holidays.

### What "in 2026" should mean

| Thing | Proposed meaning | Field |
|---|---|---|
| **Shoot day** | `day.date` starts with `"2026-"`. The day belongs to its call date, not its wrap date. | `day.date` |
| **A wrap past midnight** | Stays on the call date. `deriveBreakState` sets `wrapNextDay` from the explicit flag or `wrapH < callH`, and expresses the wrap as `wrapH + 24` on the **same** `day.date`. There is no second date record. A 04:00 wrap on 31 December 2026 is a 2026 day. |
| **Invoice** | `invoice.invoiceDate`, with `invoiceLedgerDate` falling back to `createdAt.slice(0,10)` for legacy records. This is what the accountant export already uses via `taxYearOf`. |
| **Payment** | `invoice.datePaid`. `paidMonthKey` uses the `datePaid > dateSent > invoiceDate > createdAt` fallback chain, which is right for bucketing but wrong for "paid in 2026" specifically. **For Wrapped, require a real `datePaid`; a paid invoice with no `datePaid` should be excluded from payment-timing stats rather than dated by a fallback.** |
| **Health query** | Local midnight to local midnight. `healthWindowForDay` already builds `new Date(day.date + 'T00:00:00').getTime()`, which is local midnight, and adds the resolved hours. A calendar-year steps total should be `new Date('2026-01-01T00:00:00')` to `new Date('2027-01-01T00:00:00')` on the same local basis. |

A note on the tax year, since the app already has the concept: `taxYearOf`
buckets to 6 April, and the stats screen offers a tax-year filter. **A calendar
Wrapped and the app's tax-year figures will not agree, and should not be presented
as if they should.**

---

## 7. Stat feasibility table

Legend: **NOW** = available now from stored data through existing functions.
**MINOR** = available with a small read-only derivation calling functions that
already exist, no engine edit, no schema change. **NEW TRACKING** = requires
recording something we do not record. **NOT REALISTIC** = not obtainable.

Everything marked NOW or MINOR assumes the ownership fix in section 4.

### Work

| Stat | Verdict | Source |
|---|---|---|
| Total shoot days | **NOW** | `calcForDisplay(...).meta.dayType === 'Shoot'`, deduped on date. `StatsScreen` does this as `shootDaysSet`. **Derivable, not stored.** |
| Total productions | **NOW** | `new Set(enrichedDays.map(e => e.production.id)).size`. **Derivable.** |
| Total hours | **NOW** | Sum of `calc.meta.workedHrs`. **Derivable.** |
| Total minutes | **NOW** | The same, times 60. **Derivable.** |
| Longest day | **NOW** | Max `calc.meta.workedHrs`. **Derivable.** Nothing computes it today. |
| Shortest day | **NOW** | Min the same, excluding zero-hour days (`Day off`, `Rest Day`, unparseable times). **Derivable.** |
| Average day length | **NOW** | `StatsScreen` has `avgShootLen` for Shoot days only. Overall is the same division. **Derivable.** |
| Distinct production companies | **NOW** | `new Set(production.prodCo.trim())`. `StatsScreen` buckets empty as `(Unknown)` in `earningsByProdCo`. **Stored.** |
| Longest consecutive run of shoot days | **NOW** | `StatsScreen`'s `longestStreak` walk over sorted `workingDates`. **Derivable.** |
| Day type breakdown | **NOW** | `StatsScreen`'s `daysByType`, from `calc.meta.dayType`. Nine types in `DAY_TYPES`. **Derivable.** |

### Time

| Stat | Verdict | Source |
|---|---|---|
| Total overtime | **NOW** | `calc.meta.otHrs` for hours; `categorizeBreakdownLine(l) === 'ot'` summed for money, as `StatsScreen`'s `otEarnings` does. `meta.waivedOtHrs` separately carries eleven-hour-day waived OT. **Derivable.** |
| Total pre-call time | **MINOR** | `resolveDay(...).preCallTime` minus resolved `callTime`, via `parseHHMM`. Nothing computes the aggregate. The pre-call money is on the calc lines. **Derivable.** |
| Early calls | **MINOR** | Derive from `parseHHMM(resolved.callTime)` in `[5, 7)`, matching `calculateDay`'s `isEarly`. **Do not read `meta.dayLabel`**: it is a single string with precedence night > Saturday > Sunday > early > late, so a Saturday early call reads `"Saturday"` and would be missed. **Derivable.** |
| Late wraps | **MINOR** | Derive from resolved `wrapTime` plus `wrapNextDay`. Note `calculateDay`'s `isLate` is a late **call** (11:00 to 17:00), not a late wrap. There is no stored notion of a late wrap. **Derivable, definition needed.** |
| Latest wrap | **MINOR** | Max of `wrapH + (wrapNextDay ? 24 : 0)` over resolved days. **Derivable.** |
| Earliest call | **MINOR** | Min `parseHHMM(resolved.callTime)`. **Derivable.** |
| Night shoots | **NOW** | `StatsScreen`'s `nightShootCount`, from `meta.dayLabel.includes('Night Shoot')`. Reliable here because night takes top precedence in that ternary. Underlying rule is `callH < 5 \|\| callH >= 17`. **Derivable.** |
| Weekend days | **NOW** | `dayOfWeek(day.date)` is 0 or 6. **Derivable.** |
| Bank holiday days | **NOW** | `calc.meta.isBankHoliday` and `meta.bankHolidayName`, nation-aware via `dayIsBH` and `production.baseNation`. `UK_BANK_HOLIDAYS` covers 2025 to 2029. **Derivable.** |

### Breaks

| Stat | Verdict | Source |
|---|---|---|
| Lunches recorded | **NOW** | `day.lunchLogged`, backfilled by `migrateDay` from the date. On pre-Live-Activity records the backfill means "past = logged", so it is an approximation, not an observation. **Stored, with a backfill caveat.** |
| Late breaks (first) | **NOW** | `penaltyFlags(calc).hasL1`, which uses `isLateFirstBreakLine`, an exact match on `"late 1st break"`. `StatsScreen` already has `lateLunchCount` and `lateLunchEarnings`. **Derivable.** |
| Late breaks (second) | **NOW** | `penaltyFlags(calc).hasL2`, label prefix `"late 2nd break"`. **Derivable.** |
| Missed breaks | **NOW** | `penaltyFlags(calc).hasMSB` for the second break. A missed first break is the CWD case below: `deriveBreakState` sets `lunchMissed` when duration is 0 or `lunchStartTime` is null, which becomes `continuousDay`. **Derivable.** |
| CWD days | **NOW** | `calc.meta.continuousDay`, exposed as `penaltyFlags(calc).hasCWD`. **Derivable.** |
| Total minutes the first break was delayed past the deadline | **MINOR** | `deriveBreakState(resolveDay(...))` returns `lunchStartAbs` and `lateThreshold` (`callH + 5.5`). Delay minutes are `(lunchStartAbs - lateThreshold) * 60`. **A ruling is needed:** the APA late-break penalty applies between +5.5 and +6.5; past `cwdThreshold` (+6.5) it becomes a continuous working day, not a late break. Whether CWD days contribute their delay to this total is a calc-adjacent judgement, and `CALC_DECISIONS.md` should carry it. **Derivable.** |
| Biggest single delay | **MINOR** | Max of the same. **Derivable.** |
| Average delay | **MINOR** | Mean of the same over qualifying days. **Derivable.** |
| Second break penalties | **NOW** | `hasL2` and `hasMSB`; the money is on the lines. `deriveBreakState`'s `sbState` gives `na`, `given`, `missed`, `late`, `curtailed` for finer grain. **Derivable.** |
| Turnaround contraventions | **NOW** | `calcForDisplay` appends a TOC line with `isTOC` and `isBreach`. `StatsScreen` already counts `tocBreachCount` as `lines.some(l => l.isTOC && l.isBreach)`. `calcTOC` sets `isBreach` at rest under 10 hours; any TOC line at all means rest under 11. **Derivable.** One caveat: `calcForDisplay` receives `prevDay` from `findPrevDay` over the same production only, so a turnaround **between two different productions** is never detected. |

### Travel

| Stat | Verdict | Source |
|---|---|---|
| Total miles | **NOW** | `resolveDay(...).miles`, summed. Value-presence cascade from `dayDefaults`. **Stored.** |
| Total travel minutes | **NOW** | `resolveDay(...).travelOutMins + travelBackMins`. **Stored.** |
| Furthest single job | **MINOR** | Max `resolved.miles` per day, or per production. Where `mileageMethod === 'postcode'`, `lookupPostcodeMiles` resolves an outcode against `POSTCODE_DISTANCES`, one-way road-miles from W1F 9SE, doubled for a round trip. So a "furthest" claim can be phrased either as miles driven or as distance from London, and the postcode is stored in `day.mileagePostcode`. **Stored, plus a lookup.** |

### Money, private only

All from frozen invoice fields. See section 9.

| Stat | Verdict | Source |
|---|---|---|
| Total invoiced | **NOW** | `invoiceSubtotal(inv.lineItems)` over invoices where `invoiceIsClaimed(inv)`, meaning status sent or paid. Net of VAT and of per-line discounts. **Stored.** |
| Invoice count | **NOW** | Count of the same. **Stored.** |
| Average days from sent to paid | **NOW** | `daysBetweenISO(inv.dateSent, inv.datePaid)` where both exist. **Stored.** |
| Fastest payment | **NOW** | Min of the same. **Stored.** |
| Slowest payment | **NOW** | Max of the same. **Stored.** |
| Still unpaid | **NOW** | `status === 'sent' && !datePaid`, which is `invoiceNeedsOverdueReminder`'s core test. **Stored.** |
| Went overdue | **NOW** | Two readings, both available. Live: `invoice.status === 'sent' && dueDate < today`, the existing overdue predicate. Historic, meaning "was overdue at some point even if later paid": `datePaid > dueDate`. The second is the better Wrapped stat and is a pure string comparison. Additionally `bigals_invoice_charges` records every invoice for which the user actually **generated** late-payment charges, via `computeLateCharges`, with `daysOverdue`, `interest` and `fixedFee`. **Stored.** |

### Health

| Stat | Verdict | Source |
|---|---|---|
| Total steps | **NOW** | Sum over `bigals_health_steps`, or one `querySteps` over the year. Native permission and data availability are a code reading only. |
| Steps per shoot day | **NOW** | Already the cache's unit: `refreshHealthSteps` stores one entry per day record over the resolved call-to-wrap window. `LegworkBlock` applies a 100-step floor as a "phone in the truck" guard. Cache capped at `HEALTH_CACHE_CAP` = 400 entries. |
| Most active day | **NOW** | `LegworkBlock`'s `figures.hardest` already computes the max-steps day. |
| Least active day | **MINOR** | Same loop, min instead of max. Nothing computes it. Needs a floor decision, since the 100-step exclusion would otherwise define the answer. |
| Total distance | **NEW TRACKING (native)** | Requires `distanceWalkingRunning` in `HealthStepsPlugin.swift`. See section 3. |

Two structural caveats on all Health stats. First, the 400-entry cap means a
multi-year store loses its oldest entries, pruned oldest-`windowEnd`-first, so a
Wrapped for a past year may find the cache already pruned; it would need to
refetch, which is possible but slow (see section 11). Second, days with no
resolvable `callTime` return `null` from `healthWindowForDay` and are never
queried at all.

### Admin

| Stat | Verdict | Source |
|---|---|---|
| PDFs exported | **NEW TRACKING** | No counter exists. `nativeRenderPrintViewPdfBase64Vector` and the web `window.print()` path record nothing. **Not recorded at all.** |
| Invoices emailed | **NEW TRACKING** | No counter. The send handler sets `status` and `dateSent` but does not distinguish emailed from manually marked sent. `invoice.dateSent` therefore counts "marked sent", not "emailed". **Not recorded at all.** |
| Backups exported | **NEW TRACKING** | No counter. `buildBackupPayload` stamps `exportedAt` into the **file**, not into storage. **Not recorded at all.** |
| Backups imported | **NEW TRACKING** | No counter. `importBackup` records nothing about having run. **Not recorded at all.** |
| iCloud backups | **PARTIAL** | `bigals_icloud_backup_meta` holds `{ lastWriteDay, lastWriteAt, lastFilename }`, overwritten daily. So the **most recent** automatic backup is known; the count is not. The plugin keeps the last 7 snapshot files, which is a floor on recency, not a history. |
| What time of day the user does admin | **MINOR, partial** | `invoice.createdAt` is a full ISO timestamp, the only one on any user record. `new Date(inv.createdAt).getHours()` gives a local hour, so "you mostly invoice at 11pm" is genuinely derivable **for invoice creation only**. Nothing else carries a time. **Partly stored.** |

### Milestones

| Stat | Verdict | Source |
|---|---|---|
| First shoot ever logged | **NOW, with a caveat** | Earliest `day.date` across all productions. But this is the earliest **shoot date**, not the earliest logging date, and a user can back-date a shoot. `deriveStartDate` uses the same rule for `production.startDate`. **Derivable. The true "first thing you logged" is not recorded.** |
| Date the user started using the app | **NEW TRACKING** | **Not recorded at all.** No install date anywhere. `userPrefs` has no date field. `production.createdAt` is read by the productions list `sortKey` but **written by no creation path**, so it is a phantom. `userPrefs.onboardingComplete` is a boolean with no timestamp. The only proxies are the earliest `invoice.createdAt` and the earliest `day.date`, both of which can predate or postdate install. |

### Long form, what Pact/Bectu records make available that APA does not

APA has no equivalent of any of these.

| Concept | Field or function | Verdict |
|---|---|---|
| Weekly structure | `production.weeks[]`, `makeLongFormWeek`, `lfWeekBounds`. Real week records with `startDate` and `endDate`, so "weeks worked" is a first-class count. | **NOW** |
| Night-work election | `week.nightWork.settlement`, `null`, `'rest'` or `'paid'`. A weekly decision APA has no concept of. | **NOW** |
| Camera wrap | `day.cameraWrapTime`. A real rate boundary on film, distinct from unit wrap. Enables "camera wrap versus your wrap" as a gap. | **NOW** |
| Unit call versus individual call | `day.unitCallTime` and `day.individualCallTime`, where `null` means the unit call applies. APA has one call. | **NOW** |
| Day shape | `day.dayShape`: `'swd'`, `'scwd'`, `'cwd'`. Continuous versus split working day as a booked property rather than a derived penalty. | **NOW** |
| Budget band and agreement | `production.band`, `production.agreement`, `production.agreementVersion`. | **NOW** |
| Scheduled versus actual filming days | `production.scheduledFilmingDays`, written only when set. | **MINOR**, absent on most records |
| Sixth and seventh day premium | `longFormCalcForDay` line kind `sixthSeventh`, with `day.sixthSeventhOverride`. | **NOW** |
| Achieved contracted hours | line kind `ach`, and `meta.dailyRateInclAch`. | **NOW** |
| Base nation | `production.baseNation`, driving nation-specific bank holidays. APA productions also carry this. | **NOW** |

**The blocker: `StatsScreen` skips every long-form production outright
(`if (agreementOf(p) !== 'apa') continue`), and so does `LegworkBlock`'s
`dayEntries`, indirectly, because it does not filter but `resolveDay` and
`calcForDisplay` are APA concepts. A Wrapped that wants long-form days needs a
second aggregation path over `longFormCalcForDay`, which is real work, not a
reuse.**

---

## 8. Existing stats screen

### What `StatsScreen` already computes

Filter is `'all'`, `'taxyear'` (6 April boundary) or `'ytd'`.

`enrichedDays` is the shared substrate: one entry per user day record, as
`{ day, resolved, production, crew, calc }` where `calc` has been through
`applyInvoicedToCalc`. It excludes long form, excludes productions where no user
crew resolves (tallied as `excludedCount`), and excludes future days and unwrapped
today-days (tallied as `notYetCountedDays`).

`stats` then computes: `totalEarnings`, `workingDaysCount`, `shootDaysCount`,
`totalHours`, `productionsWorkedCount`, `longestStreak`, `avgDayEarnings`,
`avgPerShoot`, `avgShootLen`, `highestDay` (with basic, OT, penalty, kit and
extras buckets), `daysByType`, `monthBreakdown`, `otEarnings`,
`lateLunchEarnings`, `lateLunchCount`, `tocBreachCount`, `nightShootCount`,
`busiestMonth`, `topProdCo`.

`aggregateMonthly` produces the monthly series for `MonthlyEarningsView`, from the
same `enrichedDays`.

`LegworkBlock` produces `total` steps, `n` eligible days, `skipped`, `hardest`
(most steps) and `wage` (best pay per 1,000 steps).

### Directly reusable for Wrapped

| Helper | Why it is reusable |
|---|---|
| `resolveDay` | Mandatory. Raw day records do not carry resolved times. |
| `calcForDisplay` | The single money and hours entry point. Read-only over the engine. |
| `penaltyFlags` | All break, CWD, TOC, night and bank-holiday booleans in one call. |
| `deriveBreakState` | The only source of delay minutes, thresholds and second-break state. Module scope, callable. |
| `categorizeBreakdownLine` | Buckets a line into basic, OT, penalty, kit or extras. |
| `productionInvoicedIndex` and `applyInvoicedToCalc` | The invoiced-earnings seam. Reuse rather than reimplement, or Wrapped and stats will disagree. |
| `invoiceDayKey`, `invoiceDayClaim`, `invoiceIsClaimed`, `invoiceSubtotal` | The money read path. |
| `taxYearOf`, `taxYearBounds`, `invoiceLedgerDate`, `daysBetweenISO`, `addDays` | Date arithmetic that is already TZ-safe. |
| `dayOfWeek`, `isBankHoliday`, `UK_BANK_HOLIDAYS` | Weekend and bank holiday. Note `CLAUDE.md` and `HANDOVER.md` both pin these as untouchable. |
| `aggregateMonthly` | If Wrapped wants a monthly shape, this already exists and is TZ-safe. |
| `refreshHealthSteps`, `healthWindowForDay`, `healthStepsCache` | The Health read path, including the settle and prune policy. |
| `computeProductionKitDiscount` | Needed or kit-deal jobs over-report. |

### Not reusable

`userCrewIdsInProduction`, for the reasons in section 4.

### Correctness issues I can see

These are read from source. None has been reproduced.

1. **Counts dedupe on `productionId:date`, money and hours do not.** `totalEarnings`
   and `totalHours` sum per **day record**; `workingDaysSet`, `shootDaysSet`,
   `dayTypeMap` and `uniqueDaysByMonth` all collapse to one entry per
   `productionId:date`. Whenever more than one day record is counted for one
   production-date, `avgDayEarnings` and `avgShootLen` are inflated. In practice
   this needs the ownership bug in section 4 to trigger, but the inconsistency is
   structural, not conditional.

2. **`iAmCrewId` is ignored by the stats ownership resolver.** `resolveUserCrewId`
   honours the manual override; `userCrewIdsInProduction`, which stats uses, does
   not. A user who set "this is me" on a Best Boy job but has a blank display
   name is excluded from their own stats.

3. **Two different day-identity rules in one function.** `workingDaysSet` keys on
   `productionId:date`; `workingDates`, used for `longestStreak`, keys on bare
   `date`. Both are defensible; having both means `workingDaysCount` and the
   streak can describe different things without saying so.

4. **`meta.dayLabel` is precedence-ordered, and one call site depends on that
   holding.** `nightShootCount` reads `dayLabel.includes('Night Shoot')`, which is
   safe because night is first in the ternary. Any future reordering silently
   changes the count. Per the pin lesson in `HANDOVER.md` about anchoring on
   copy, this is a copy-shaped dependency in live code, not just in a pin.

5. **`day.wrapped` is not set by the Best Boy flows.** The comment in
   `StatsScreen` says so explicitly and points at `MAINTENANCE.md`. So the
   today-day rule (`wrapped === true`) behaves differently on solo and multi-crew
   jobs. Already a known parked item.

6. **Turnaround is production-local.** `findPrevDay` searches within one
   production, so a wrap on job A followed by a call on job B the next morning
   never produces a TOC line. `tocBreachCount` therefore under-reports for a
   freelancer moving between jobs.

7. **Long form is silently skipped.** Documented as sweep gate S4 and deliberate,
   but for a Wrapped it means a long-form-heavy year reads as nearly empty.

8. **`prodCo` empty-bucketing.** `earningsByProdCo` buckets a blank company as
   `(Unknown)`, so `topProdCo` can legitimately return `(Unknown)`.

Two things I checked and found **not** to be bugs, so they should not be
"fixed": the streak's `new Date(workingDates[i]) - new Date(workingDates[i-1])`
parses both as UTC midnight, so consecutive dates differ by exactly 86400000
including across DST; and `applyInvoicedToCalc` deliberately leaves
`calc.meta.workedHrs` unscaled, which is documented, so hours stay engine hours
while money becomes invoiced money.

---

## 9. Money and frozen records

### Fields supporting each money stat

| Stat | Fields |
|---|---|
| Total invoiced | `invoice.lineItems[]`, summed by `invoiceSubtotal`, gated on `invoiceIsClaimed(inv)` |
| Invoice count | `invoice.status` |
| Sent to paid interval | `invoice.dateSent`, `invoice.datePaid` |
| Still unpaid | `invoice.status`, `invoice.datePaid` |
| Went overdue | `invoice.dueDate` against `invoice.datePaid` or today |
| Late charges actually raised | `bigals_invoice_charges`, one record per invoice id, holding `daysOverdue`, `principal`, `interest`, `fixedFee`, `newTotal` from `computeLateCharges` |
| Per-day attribution | `invoice.dayKeys[]` or `invoice.dayBreakdown[]`, via `invoiceDayClaim` |
| VAT | `invoice.vatRegistered`, `invoice.vatRate`. `invoiceSubtotal` is **net**, which is the right basis for an earnings claim |
| Per-day billed amount | `invoice.dayBreakdown[].total`, spread pro rata by `productionInvoicedIndex` |

### Does reading these require recomputing a frozen invoice

**No. Confirmed.**

Every field above is a plain read off the stored invoice object.
`invoiceSubtotal(lineItems)` sums frozen numbers. `productionInvoicedIndex`
reads `inv.lineItems` and `inv.dayBreakdown` and computes a ratio; it writes
nothing. `applyInvoicedToCalc` returns a **new** calc object with scaled line
amounts and leaves the invoice untouched.

There are exactly three places that rebuild invoice lines, and none is on a read
path: `createNewInvoice` and the long-form and standalone equivalents at mint
time, and `resendInvoice`, which is the deliberate, user-initiated re-freeze
described in its own comment ("the SAME invoice, re-frozen... a deliberate resend
re-runs the builders"). A Wrapped touches none of them.

One adjacent note, not a violation: the accounting CSV exports
(`INVOICE_EXPORT_FORMATS`) **do** recompute, by calling
`buildInvoiceLineItems({ ...production, roundingMode })`. That is documented at the
top of that block. **Wrapped must read `invoice.lineItems` directly and must not
borrow the export builders**, or it would report recomputed figures rather than
what was actually billed.

---

## 10. Missing data

### List one: recoverable later from existing data or from Health

These are not computed today but need no new recording. Historic years stay
complete.

| Thing | Recoverable from |
|---|---|
| Longest, shortest and average day | `calc.meta.workedHrs` over existing days |
| Earliest call, latest wrap | Resolved `callTime` and `wrapTime` |
| Total and average pre-call time | Resolved `preCallTime` against `callTime` |
| Break delay minutes, biggest and average | `deriveBreakState`'s `lunchStartAbs` and `lateThreshold` |
| Second break state detail | `deriveBreakState`'s `sbState` |
| Least active day | The existing steps cache, or a refetch |
| Calendar-day step totals, and any date-range total | `querySteps` with different epochs. No native work. |
| Total distance walked | **Health, but only after new native work.** The samples exist in HealthKit whether or not we ever read them, so this is recoverable **retrospectively** once `distanceWalkingRunning` is added. Adding the type later does not lose past years. |
| Weekend and bank holiday counts | `dayOfWeek` and `UK_BANK_HOLIDAYS`, for 2025 to 2029 |
| Furthest job, and distance from London | `day.miles`, `day.mileagePostcode`, `POSTCODE_DISTANCES` |
| Payment speed distribution | `dateSent` and `datePaid` |
| Overdue history | `dueDate` against `datePaid`, plus `bigals_invoice_charges` |
| Time of day the user creates invoices | `invoice.createdAt` |
| Long-form week counts, night-work elections, camera wrap gaps | The long-form records, once a second aggregation path exists |

### List two: only exists if we start recording from the next release

For each: what it unlocks, and what it costs.

| Thing | Unlocks | Cost |
|---|---|---|
| **Install or first-run date** | "You have been using TimeMachine for N days", and an honest "your first year" framing. Also lets Wrapped know whether a year is partial. | One `userPrefs` string, stamped once if absent. Merge-over-defaults, no migration. Very cheap. **Unrecoverable if skipped**: for existing users the true date is gone regardless, so the best that is ever possible is "since the next release". |
| **Day record creation timestamp** | "First thing you ever logged", "you log your days at 11pm", back-dated versus same-day logging, and a real distinction between a shoot that happened and a booking that was pencilled in. | One field on the day record. Additive, but it is a **stored-data-shape change**, so propose-first applies and `audit:storage` round-trip pins would need extending. **Unrecoverable if skipped.** |
| **Production creation timestamp** | "You took on N new jobs this year", separated from shoot dates. Would also make the existing phantom read in `sortKey` real. | One field, written by the three creation envelopes. `sortKey` already reads it, so nothing else changes. **Unrecoverable if skipped.** |
| **Import or share-link provenance on a day** | Distinguishing a day imported from someone else's call sheet from one the user logged. Lets Wrapped exclude never-worked imports. | One boolean or source string on the day record, set in `makeImportedProduction`. **Unrecoverable if skipped.** |
| **PDF export counter** | "You exported N timesheets and invoices." | One counter, and a decision about where it lives. A `userPrefs` counter is simplest; a ledger key would need `KEYS`. Two write sites (native vector path, web print path). **Unrecoverable if skipped.** |
| **Invoice email counter, or an emailed flag on the invoice** | "You emailed N invoices", separated from "marked as sent". | A counter, or a flag on the invoice. **A flag on an invoice is a frozen-record change and would need an explicit ruling**, since it mutates a sent invoice. A counter avoids that entirely and is the safer shape. **Unrecoverable if skipped.** |
| **Backup export and import counters** | "You backed up N times." | Two counters at `buildBackupPayload`'s manual caller and `importBackup`. Note the iCloud sweep already writes `lastWriteDay`, so an automatic-backup count is nearly free there. **Unrecoverable if skipped.** |
| **Health distance samples** | Total distance, distance per day, furthest walked. | New native work, a new read type, a re-prompt for every user, and a reworded usage string. See section 3. **Recoverable if skipped**, because the samples live in HealthKit, not in our store. This is the one Health item that does **not** need to be decided before the first Wrapped. |
| **Wrap action timestamp** | "Your latest ever wrap was at 4:12am" as an observed fact rather than a typed wrap time. Also a real signal for whether times were entered live or reconstructed. | One field, set where `wrapped` flips true. `day.wrapped` already exists; this adds the moment. **Unrecoverable if skipped.** |

---

## 11. Performance

### One full pass over the stored data

The dominant cost is `calcForDisplay`, once per user day record. That is
`resolveDay`, then `calculateDay`, then `augmentCalc`, then optionally `calcTOC`
against the previous day, then optional rate rounding. All synchronous, all pure
arithmetic and array building, no I/O.

`StatsScreen` already does exactly this pass on every stats visit, inside a
`useMemo`, and does it again inside `aggregateMonthly`. So the cost is not
hypothetical; it is the current cost of opening the stats screen, and it is
evidently acceptable, because that screen ships.

Order of magnitude, for a heavy user at 250 day records a year over five years:
1,250 `calcForDisplay` calls. Each builds a small lines array. **Not measured**,
but this is the same shape of work the stats screen already performs, and there
is no I/O in it. Fine on device.

Invoices are cheaper still: `invoiceSubtotal` over frozen numbers, plus one
`productionInvoicedIndex` per production. No engine calls.

### The Health queries are the real cost

`refreshHealthSteps` awaits `HealthSteps.querySteps` **sequentially** inside a
`for...of` loop. Every unsettled or window-mismatched day is one round trip
across the Capacitor bridge into an `HKStatisticsQuery`.

Two mitigations already exist. Settled entries (fetched at least 36 hours past
wrap, `HEALTH_SETTLE_MS`) are frozen and skipped. The cache is capped at 400
entries (`HEALTH_CACHE_CAP`).

The cap is also the problem for Wrapped. A year of 250 days sits inside the cap,
so a current-year Wrapped mostly reads warm cache. A Wrapped over several years,
or one run after the cache has been pruned, would trigger hundreds of sequential
native queries on a screen the user is waiting on. **This is not a code reading
of measured latency; I have not timed the bridge. But sequential-await over
hundreds of items is a structural risk regardless of per-call latency.**

Two ways out, both JS-only:

- Ask for **one** window rather than N. A calendar-year total is a single
  `querySteps(jan1, jan1NextYear)` call. Only per-day stats (most and least
  active, steps per shoot day) need per-day windows, and those can come from the
  existing cache alone, accepting that pruned days are simply absent.
- Compute Wrapped's Health section from `healthStepsCache()` **without** calling
  `refreshHealthSteps`, and let the existing stats visit keep the cache warm.

### Verdict

**Fine on device for the stored-data pass. Needs care, not caching, for Health.**
Caching a Wrapped summary would introduce a new persisted key, which means a
`KEYS` warm-list entry and a staleness rule, and it is not warranted: the
expensive part is avoidable by asking Health for fewer, wider windows.

---

## 12. Privacy posture

**Yes. A Wrapped built from everything in this audit can be generated with
nothing leaving the device.**

Every source named here is local:

- `bigals_productions`, `bigals_user_prefs` and the ledgers come from
  `localStorage`, IndexedDB or Capacitor Preferences, all on-device.
- `calcForDisplay` and everything under it is pure arithmetic in the page.
- `POSTCODE_DISTANCES` is a static object compiled into `index.html`, not a
  lookup service. `lookupPostcodeMiles` does an in-memory table read.
- `UK_BANK_HOLIDAYS` is a static object.
- HealthKit queries run in-process via `HKStatisticsQuery`. The plugin's header
  states "All queries run on-device; nothing leaves the phone", and the
  `NSHealthShareUsageDescription` makes the same promise to the user.
- The React, Tailwind and Babel CDN loads are page-load dependencies of the web
  build; they are not Wrapped, they carry no user data, and they are unchanged.

### What would break the claim

- **Any server-side rendering of a Wrapped image or card.** Rendering must go
  through the existing local paths: `window.print()` on web, or
  `NativePdfPlugin` on iOS.
- **A share link that encodes real figures.** The existing share-link codec
  (`SHARE_DAY_TYPES` and the `_shareB64url` helpers) puts shoot data into a URL.
  A URL is not an upload by itself, but the moment it is opened it reaches
  `timemachineapp.co.uk`, and per `share-link-format-v1` in memory the native and
  AASA gate is not built. **A shareable Wrapped is the single most likely way to
  break the no-upload claim and should be treated as a separate decision.**
- **Any analytics or crash reporter added later**, which would need to be
  explicitly excluded from Wrapped fields.
- **The iCloud snapshot sweep** already writes `buildBackupPayload` to the user's
  own ubiquity container. That is the user's iCloud, not ours, and it exists
  today independently of Wrapped, so it does not break the claim. Worth stating
  plainly if Wrapped copy ever says "nothing leaves your phone", because
  something already does, to the user's own iCloud, with their account.
- **Health distance, if added.** Still on-device, but it widens the Health read
  set and the usage string must say so.

---

## 13. Proposed additions for the next release, proposal only

Additive, local-only, no UI. **Proposal only. Nothing here has been implemented,
no migration has been written, no code has been changed.** Each of these touches
stored data or preferences, so each needs a propose-first ruling under
`CLAUDE.md` before any of it is built.

Ranked by value, meaning: how much a first Wrapped loses without it, weighted by
whether skipping it is permanent.

### 1. `userPrefs.firstRunAt`

- **Record:** `userPrefs`.
- **Type:** ISO timestamp string, stamped once when absent.
- **Unlocks:** "Using TimeMachine since March 2026", "your Nth year", and the
  ability to tell a partial first year from a full one, which changes what a
  Wrapped can honestly claim.
- **Migration required:** **No.** Merge-over-`DEFAULT_USER_PREFS` in
  `useStoredState` is the established pattern for additive prefs (`theme`,
  `invoiceEmailMethod`, `overdueRemindersEnabled` are all precedents). No
  `SCHEMA_VERSION` bump.
- **Pins or assertions that would move:** None expected. `audit:storage` asserts
  round-trip on `bigals_user_prefs`, and an added key round-trips. No calc pin
  touches prefs. **Would need confirming by running the gate, which this audit
  did not do.**
- **Unrecoverable if skipped:** **Yes**, permanently. Every release that ships
  without it costs another cohort their true start date.

### 2. `day.createdAt`

- **Record:** day record, APA and long form.
- **Type:** ISO timestamp string, set in `makeBlankDay` and `makeLongFormDay`.
- **Unlocks:** first thing ever logged, time-of-day logging habits, same-day
  versus back-dated logging, and a defensible way to tell a worked day from a
  pencilled booking that was never revisited.
- **Migration required:** **No migration needed to add it**, since every read
  would be `day.createdAt || null`. But it **is** a stored-data-shape change,
  so it is propose-first, and old records will never have it. Do **not** backfill
  it from `day.date`: that would fabricate a logging time from a shoot date.
- **Pins or assertions that would move:** `audit:storage` round-trip pins over
  day records would need the new key added to their expected shapes.
  `audit:build` calc pins should not move, because nothing in `calculateDay`,
  `resolveDay` or `deriveBreakState` reads it, and the 123 scenarios do not
  construct it. **The eleven long-form worked-example fixtures LF13a to LF13k
  construct day records directly and would need checking.** The real risk is
  `LF22d`, "no APA production gains a key", and that pin is about the **role set**,
  not the day shape, so it should not fire, but it is close enough to the concern
  that it must be verified rather than assumed.
- **Unrecoverable if skipped:** **Yes.**

### 3. `production.createdAt`

- **Record:** production.
- **Type:** ISO timestamp string, set in `makeApaProduction`,
  `makeLongFormProduction` and `makeImportedProduction`.
- **Unlocks:** "You took on 14 new jobs in 2026", counted by when the job started
  existing rather than by shoot date. Also makes the existing phantom read real:
  the productions list `sortKey` already falls back to `p.createdAt` and today
  always misses.
- **Migration required:** **No.** New productions get it; old ones do not, and
  `sortKey` already handles absence.
- **Pins or assertions that would move:** `audit:storage` production round-trip
  shapes. `LF22d` needs verifying for the same reason as above, and this one adds
  a key to an **APA production**, which is exactly the shape that pin guards, so
  **this is the proposal most likely to move a pin.** If it does, that is a
  genuine question for a ruling, not a pin to adjust, per the never-adjust-a-pin
  rule in `HANDOVER.md`.
- **Unrecoverable if skipped:** **Yes.**

### 4. `day.source`

- **Record:** day record.
- **Type:** string, absent by default. `'share-import'` set in
  `makeImportedProduction`; potentially `'call-sheet'` if the `CallSheet` reader
  ever writes records, which today it does not (Stage 1 is display-only).
- **Unlocks:** excluding never-worked imported days from yearly totals, and a
  true "days you logged yourself" figure. Directly addresses the unrecoverable
  gap in section 5.
- **Migration required:** **No.** Absence means user-entered, which is correct for
  every existing record.
- **Pins or assertions that would move:** The share-link assertions
  (`audit:share`) construct imported productions and would need the new key in
  their expected shapes. Calc pins unaffected: nothing in the engine reads it.
- **Unrecoverable if skipped:** **Yes**, for days imported before it lands.

### 5. `userPrefs.adminCounters`

- **Record:** `userPrefs`.
- **Type:** object of integers, for example
  `{ pdfExports, invoiceEmails, backupExports, backupImports }`.
- **Unlocks:** the entire Admin row of section 7, which is currently the emptiest
  category in the whole feasibility table.
- **Migration required:** **No.** Merge-over-defaults, same as every other prefs
  addition. One object rather than four top-level keys keeps the prefs surface
  tidy and makes a future fifth counter free.
- **Pins or assertions that would move:** None on calc. `audit:storage` prefs
  round-trip only.
- **Unrecoverable if skipped:** **Yes**, but only in the sense that the count
  starts from zero later. Unlike the dates above, a counter that starts a year
  late is still useful the year after.
- **Deliberate note:** counters, **not** flags on invoices. An `emailedAt` field
  on an invoice would mutate a frozen record, which `CLAUDE.md` forbids without a
  ruling. A counter in prefs sidesteps that entirely and is the reason to prefer
  this shape.

### 6. `day.wrappedAt`

- **Record:** day record.
- **Type:** ISO timestamp string, set where `wrapped` flips to `true`.
- **Unlocks:** an **observed** latest wrap rather than a typed one, and a signal
  for whether a day's times were logged live or reconstructed afterwards. Would
  also give the Best Boy `wrapped` gap in `MAINTENANCE.md` a real fix rather than
  a date heuristic.
- **Migration required:** **No.** Absence means "wrapped state came from the
  backfill, not from an observed action", which is exactly the truth for every
  existing record.
- **Pins or assertions that would move:** day-record round-trip shapes in
  `audit:storage`. The day-presence and day-off assertion suites construct day
  records and would need checking.
- **Unrecoverable if skipped:** **Yes.**

### Explicitly not proposed

- **Any Health field on a day record.** The `bigals_health_steps` ledger comment
  states the rule directly: never fields on day records, that is the migration
  landmine. If distance is ever added, it belongs in that ledger or its own key,
  and either way it joins `KEYS` in the same commit.
- **A cached Wrapped summary key.** Section 11 concludes the cost does not
  justify it, and it would add a persisted key with a staleness rule for no gain.
- **Anything on an invoice.** Frozen records. Counters in prefs achieve the same
  Wrapped stats without touching one.
