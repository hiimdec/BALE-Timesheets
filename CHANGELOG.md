# Changelog

## 5.3.0

### Pay accuracy review
We've done a thorough review of how pay is calculated against the APA terms and corrected a number of edge cases. Most day-to-day calculations are unchanged; these fixes make sure the trickier days come out exactly right. Totals on days you've already logged recompute automatically; invoices you've already sent are frozen and stay as issued.
- Long continuous nights and Sunday or bank holiday continuous days now pay the full continuous-day structure, including overtime after nine hours.
- A missed first break on a night shoot is now charged, and Saturday early calls now get the early-call premium.
- Travel time is now worked out consistently on every day type - continuous, prep and pre-light days included - and always at single time.
- Fixed a handful of rounding slips at exact times (for example a lunch starting exactly on its deadline) and a double-count where a curtailed lunch met an hourly-paid day.

### Saved clients (new)
A full-screen clients manager replaces the flat list in Settings - search by name or email, most recently used first, tap to edit, swipe to delete, with a "used in N invoices" count on each client. Deleting a saved client never changes an invoice you've already created; invoices keep their own copy of the details.

### Visual
- Expandable sections now open with a quieter scale and fade, and the open section reads through tone rather than a border.

## 5.2.1

### Share-in shoot picker
- Sharing a call sheet in now offers only the shoots near today's date (within a week either side), nearest first, with the new shoot option pinned at the top - no more scrolling through every shoot you've ever made.
- Fixed the picker dismissing itself when you scrolled the list. Scrolling scrolls; swiping down on the title bar or tapping outside still closes it.

## 5.2

### Automatic iCloud backup (new)
The app keeps up to seven daily snapshots of your data in your own private iCloud container — written automatically when you close the app, visible to no one else, including us. Delete the app or move phones and a fresh install offers the newest snapshot back; Settings → Data & backup gains a quiet "Restore from iCloud" list and an honest status line ("Last backup: …" / unavailable when signed out). If iCloud is off, full, or offline, nothing breaks and nothing nags — the manual export remains the fallback, and it now carries the app's ledgers alongside your productions so a restore is complete.

### Late payment charges (new)
Statutory late-payment support under the Late Payment of Commercial Debts (Interest) Act 1998: simple daily interest at 8% plus the Bank of England base rate — the rate fixed at the statutory reference date, updateable in-app and overridable on the sheet — and the fixed recovery fee (£40 / £70 / £100 by invoice size). An overdue invoice shows the accruing figure in a banner at the top of its detail; the sheet lays out the full working (days overdue, rate, interest, fee, new total) before anything is written. The invoice stays one document: original lines untouched, a charges section beneath, updated total on screen and PDF alike. Charges are removable, survive marking paid, vanish with a deleted or redrafted invoice, and never re-fire the overdue reminder. Every owed-money surface follows: invoice lists, chase emails, the accountant export.

### Chase email (new)
"Chase this invoice" on an overdue invoice opens a prefilled, polite email with the invoice PDF attached — charges section included when present — quoting the current total. Delivered the same way invoice emails leave your phone: the Apple Mail composer, or the share sheet if you prefer another app.

### Accountant export (new)
Settings → Data & backup: pick a UK tax year (6 April to 5 April) and get two files for your accountant — a CSV of every issued invoice (date, client, number, gross, date paid, status) and a plain-text summary (totals, month-by-month invoiced and received, mileage logged and invoiced). Every figure exactly as invoiced, drafts excluded.

### Fixes
- Newly added records now survive a relaunch: a storage-boot gap could quietly lose recent ledgers (late-payment charges most visibly) on the next launch. Fixed, with a regression test that boots the app against seeded storage.
- Chase and feedback emails now open reliably on iPhone — the old handoff died silently on devices.
- PDF and email generation failures now say so with a toast instead of doing nothing.
- The manual backup export carries the app's ledgers (reminder history, applied events, charges) so restores are complete.

## 5.1

### September 2026 APA rates (new)
The September 2026 rate card is built in and takes effect from a shoot's start date — which now simply follows the first shoot day, so a September booking gets September rates from the moment you date it. Rates apply automatically in both directions when a shoot's dates move across the boundary, and only ever to table rates: anything you've negotiated or entered by hand is never touched. Booking a shoot that starts after 1 September shows a one-off heads-up that the new rates apply.

### Legwork (new)
Apple Health step stats on the Stats screen. Connect Apple Health and TimeMachine counts your steps between call and wrap — shoot days only, and only on this phone. Headlines: hardest working day (most steps) and stealing a wage (highest £ per 1,000 steps). Days where the phone barely moved are skipped with a caption rather than skewing the numbers. Read-only, processed on-device, and revocable at any time in the Health app or iOS Settings; a Settings toggle hides the block entirely.

### Live Activity
- Redesigned Dynamic Island: compact shows just the status dot; the long-press view is the production name, the day total, and a single call/OT line. The lock-screen card keeps the timer, OT projection and Lunch/Wrap buttons.
- The day total is now accurate the moment you press Wrap on the card, and corrects itself within seconds where possible.
- Setting a wrap time inside the app now ends the card the same way pressing Wrap on the card does, and editing a shoot's date from any screen starts or ends the card correctly.
- Fixed the production name clipping off the left edge of the lock-screen card.

### Shoots & stats
- Upcoming shoots now show their booked value (muted) instead of £0; month headers keep meaning earned money only.
- Opening a shoot lands on the day closest to today instead of the last day.
- The monthly average no longer counts the month in progress; the chart still shows it.

### Polish & fixes
- Fixed overdue-invoice reminders firing more than once for the same invoice — exactly one per invoice per due date now.
- Fixed Best Boy department defaults not applying to all crew for days created with "Add Day (All Crew)".
- Invoice list spacing: proper breathing room above each section header.

## 5.0

### AI Call-Sheet Reader (new)
Import a call sheet (PDF, photo, screenshot, or shared straight from Mail or WhatsApp) and TimeMachine auto-fills a new shoot's invoicing details: production company, job reference, invoicing email and CC, invoicing address, and the production title. Everything lands on a review screen where you confirm or correct each field before anything is saved. Runs entirely on-device with Apple Intelligence, so no internet and nothing leaves the phone. Input by file, Photos (multi-select), camera scan, or share-in. Each field shows a confidence state, and "select on sheet" lets you tap the document to correct a value. Requires iPhone 15 Pro or newer on iOS 26 with Apple Intelligence on; hidden on unsupported devices.

### Live Activity (new)
A live lock-screen and Dynamic Island card for the day you're shooting (solo mode): production name, running day total, call time (CALL / PRE-CALL), a live elapsed timer, and interactive Lunch now / Wrap now buttons (two-tap, so they can't fire by accident). Status chips for ON LUNCH and WRAPPED, plus a CWD chip past the continuous-working-day threshold. This release adds a live lunch countdown, an "OT from HH:MM" projection that shifts with CWD and curtailed lunch, and a "Curtailed?" button that logs a short lunch to the minute with a ~5-second undo. A one-card-per-day fix clears stale duplicate cards. Settings toggle to turn it off. Card needs iOS 16.2+, buttons iOS 17+.

### Siri voice (new)
"Hey Siri, wrap now in TimeMachine" or "lunch in TimeMachine" stamps the time into today's shoot with a spoken confirmation. Works on any iPhone. Phrases must include "TimeMachine"; set a personal Shortcut for a shorter trigger.

### Invoicing
- Skip-the-editor CSV export: on a solo day, Generate Invoice now respects your export format. CSV formats (Xero, QuickBooks, generic) export straight out after a quick confirm; TimeMachine format still opens the editor. CSV export stays manual and repeatable, and doesn't mark the invoice sent.
- Rounding controls consolidated into one selector (Exact / Favourable / APA) under Invoicing > Accounting, with a per-shoot override. Favourable is greyed out for CSV, which computes exact.
- Invoicing hide/show: a master toggle with three modes: full invoicing, CSV-export-only, or calculator-only. Never deletes invoices.

### App shell
- More native top and bottom bars, applied automatically on the iOS app.
- Create (+) in the top bar: new production on Shoots, new invoice on Invoices.
- The search button toggles to an X to dismiss search.
- New Production now has a close/discard button.
- The Invoices empty-state icon matches the Invoices tab.
- New alternate app icon.
- Beta: a top-bar layout toggle (centred vs left-aligned) in Settings, for feedback.

### Polish & fixes
- Overdue-invoice reminders now name the job instead of showing generic text.
- Fixed a planned-lunch logging bug where a new day's default (planned) lunch could be treated as already started, blocking "Lunch now" during the planned window.
- Kit chip relabelled "Kit".
- Fixed the celebration animation running too fast on 120Hz ProMotion screens.
- Added a slot-machine odometer roll to the day total.
