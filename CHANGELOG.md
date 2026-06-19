# Changelog

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
