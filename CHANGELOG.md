# Changelog

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
