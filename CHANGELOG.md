# Changelog

## 2026.11

Version numbers are dates now: 2026.11 is the eleventh release of 2026. The number that used to live in the what's-new popup is gone from it; the About screen owns the version.

### Ready for the September 2026 APA terms
The September 2026 rate card, resolved by each production's start date, so an August shoot stays on the old card and a September one picks up the new rates on its own. The prep day change is in: prep can be booked for 8 or 10 hours, with overtime only after 10 hours worked, and the booking control reaches all three day editors. Overtime grade boundaries now come from the terms by role rather than being inferred from your day rate, and the grading direction is pinned so a rate rise can never quietly demote a grade. Bank holidays follow the production's UK base nation, composed around the standard set. The September card announces itself once per production when a boundary is crossed, not on every open.

### Long form, in beta
The Pact/Bectu Scripted TV (2023) and Major Motion Pictures (2021) agreements, as a second engine beside APA, chosen once at creation and fixed for the job's life. A one-decision-per-screen setup wizard that survives process death, band and base nation editable afterwards in job settings. Days are the way in, exactly as APA users know them; weeks are the review layer, minted as days need them, with week-start locking once a timesheet has gone anywhere. The engine reproduces the agreements' own worked examples as executed fixtures, all eleven. Amounts the agreements flag rather than price, the not-claimable and agreed-locally cases, are resolved on the day where the decision belongs and never reach the invoice unpriced. Invoicing is by week from the week view, with send, select and resend, and billing status derived from the invoice itself so there is no second copy to drift. Kit, box rental (weekly on the week, daily override on the day), expenses, mileage and travel time all carry through. The published role registry is wired per agreement with a full-screen role picker, trainee grades autofill the flat recommendation, and the TV rigging class works 9 plus 1 by analogy. Camera wrap is a real boundary on film and TV both, with a NOW tap. Beta is labelled in the app, never on paper: nothing an office receives says beta.

### Custom day rates
A per-day-type agreed rate for non-shoot days, for when a production buys out the recce or pays a flat figure for prep. Set it from the day-rate route in any day editor, including the mobile Best Boy one; the routed type is always shown, the solo header chip reads the resolved type, and shoot days stay on APA.

### Standalone invoices
An invoice for work that was never tracked in the app: one blank line to start, the shared numbering sequence, client fields, VAT and the freeze-at-send rules all apply. Prints ungrouped, as a plain document.

### Still on set?
If your solo day was due to wrap a while back, no card is running and you never pressed wrap, the app asks once instead of guessing: still on set, or wrapped. Saying you wrapped starts from the planned time and settles the day exactly as typing the time would. Saying you are still on brings the lock-screen card back with a fresh window. Closing the prompt leaves the day alone and it will not ask again. The timing derives from the wrap time the app already knows, an hour after one you entered, two after a default, and the arithmetic is call-relative, so a 5pm call wrapping at 4am is asked the next morning, not at midnight.

Alongside it: the Best Boy dept wrap now flags your own row rather than whoever was added to the job first, and a wrap time spoken to Siri now settles the day exactly as a typed one does.

### Stats that say what they mean
The earnings surfaces went through a full truth pass this cycle.

- Where a day is covered by a sent invoice, job totals report what that invoice billed, discounts included. Billed money is read at invoice granularity and nowhere finer: an invoice does not record how a discount was split across days, so the app no longer pretends to know.
- Invoices from before the day-link existed have their coverage derived at read time from the shoot dates, under three guards, without ever writing to a frozen invoice. Under-claiming beats mis-attributing.
- Months show what the work was worth, bars and total on one basis, summing exactly, with anything you waived on its own line. No invoice can move money between months any more.
- A basis switch: months by date worked or by date paid. Under the paid basis unpaid claims sit in an awaiting-payment line rather than being guessed into a month. The all-time figure is identical under both, by construction.
- Every surface that groups money by time now says which basis it is on: by date worked on stats, by date paid on the invoices tab, by job start on the shoots list. Figures that show agreement value are marked as such, and the note explains the one rule.
- Ownership is one rule everywhere: the "this is me" override, then name match, then the single-crew fallback. Stats and the day editor can no longer disagree about whose records are yours.
- Windowed totals count only the invoices in the window, an invoice appears in the tax year it was sent, and the late-lunch count and late-lunch money read the same predicate.

### Sharing, one control per screen
Every screen now has exactly one share control, opening one sheet with the full option set. Share links work on the web build everywhere they exist on iOS, with a link-copied fallback where there is no share sheet. On a Best Boy job, one tap in the crew overview gathers the whole crew's shoot links into a single message, each name over its link, anyone without days named rather than silently missing. The Best Boy Export tab is grid-mode furniture and phone mode folds it away: per-crew exports live on the crew kebab, whole-production exports on Save Timesheets, both now week-scoped, and back returns to the job from every page instead of sometimes landing on the shoots list.

### The working on show
The day breakdown shows the sums behind the amounts, 146 mi becoming 146 × £0.50, on screen and on both pages of the invoice PDF. Fractional hours display to two decimals rather than a raw float, a third of an hour reads 0.43. The pre-call line states the window it actually charges: a 7am pre-call against an 8am call reads 07:00 to 08:00, not 05:00 to 08:00, and the money never moved.

### Fixes
- The mileage rate preference was being ignored, billing at the 50p default regardless of what you set. It had been dead for three months.
- The overtime coefficient comes from the rate card, not from reverse-engineering your rate, and the two crew editors that dropped the no-overtime flag on Directors and Producers now carry it.
- The grid crew editor crashed on open.
- The time wheel could open underneath the day pill.
- The email sign-off is your first name only.
- The call sheet reader shows its scan animation while it works.
- Long form polish: the week view keeps its section rhythm, back from the day editor goes to the week view, the job settings sheet scrolls, the role picker search bar clears the native nav bar, and a today card on the home screen navigates without writing anything.

### Groundwork, no visible surface
Four additive fields now recorded so a future year-in-review can exist: when the app was first run, when each day record was created, the observed moment a wrap was pressed, and whether a day arrived through a share link. Nothing reads them yet, nothing is backfilled, and none of them affect pay.

## 5.4.0

### Redesigned invoices and timesheets
Both documents were rebuilt against the approved design and now render as true vector through the native print pipeline, with no rasterisation anywhere - text stays sharp at any zoom and the files are smaller. Timesheets (the Best Boy grid and the solo sheet alike) gain SVG chips, summary cards, a reconciliation bar, a key and week grids. Invoices gain a segment bar, grouped line items and breakdown chips.

The day-by-day breakdown is now a structured, frozen field on the invoice record rather than prose pasted into the notes box. It is built from the same figures and the same previous-day chain as the text export, so the numbers agree by construction, and notes go back to being manual-only. Invoices you have already sent are untouched and keep the document they were sent with.
- The dormant html2canvas raster exporter has been deleted now the vector path is device-confirmed, taking 551 KB out of the bundle.
- Pagination reworked: the breakdown starts on page 2, overspill is shared between pages, and payment details never split across a break.
- Fixed the issued date never rendering on an invoice - it was bound to a field that did not exist.

### Share a shoot with a mate (new)
Turn a shoot into a link. Your mate taps it and it opens in their TimeMachine with the shoot pre-loaded, ready to confirm before anything is saved. There is no backend: the whole shoot rides inside the link itself, so nothing is stored on a server and the payload never reaches ours.

The wire format is frozen at v1 with a permanent pin suite, and the encoder is an allowlist - it names the shared fields explicitly and never spreads a record, so kit, expenses, notes, state flags and anything about the sender's identity or rates cannot cross by construction. The receiver's own rates apply. Links carry up to fourteen days, and worked days only: rest days and un-ticked days drop out. Best Boy shoots can share one crew member's days on their own.

### Poppy mode (new)
A second colour theme, pink, requested by and named after our trainee. Settings, Appearance. The whole app re-colours, including the native bars on iOS. Invoices and exported documents are deliberately unaffected and stay in the standard palette.

Getting there meant resolving the entire palette through CSS variables first, so the theme is one set of token values rather than a per-surface repaint, with a parity audit that fails the build if a raw colour escapes the token system.

There is a matching Poppy app icon under Settings, Appearance, App icon. Icon choice stays manual and deliberately does not follow the theme: iOS shows a system confirmation alert on every icon change, so switching automatically would fire an alert each time you changed theme. Turning Poppy on now shows a one-time note pointing at the icon, dismissible and shown once.

### A swipe-through tutorial (new)
Six animated cards covering the things people were missing: what gets worked out from your times, solo versus Best Boy, the Live Activity, share links, the call sheet reader and invoice tracking. Side arrows, horizontal swipe, tappable dots, and skip from any card.

It replaces the written manual that used to sit in Settings - the same content told better, and the manual was the part nobody read. The deck is version-gated on its own content edition, so new users see it on first launch and existing users see it once after the cards change, then not again until they change.

Every animation is CSS over the theme tokens, with no assets and no dependency on real screen markup, so a later redesign cannot make them wrong. All six stop under prefers-reduced-motion, leaving a composed still frame.

### Per-shoot Live Activity (new)
Some days you know will be short and simple, and a running total on the lock screen is just noise. Each shoot now has its own Live Activity toggle in the shoot's Mode settings, sitting under the global master switch in Settings.

The two are ANDed: the master switch still turns the feature off everywhere, and the per-shoot flag can only ever subtract from it, never force a card on. Shoots created before this release are unaffected - an absent flag reads as on, so nothing changes for them. Turning it off mid-day ends a running card on the next sweep, about a second later. The row is hidden on Best Boy shoots, where the card does not run at all, and greys out with an explanation when the master switch is off.

### Quick set (new)
Set one time across several crew at once, from an inline panel above the crew list with the time pre-filled. Two sparks went to lunch early - tick them, set it, done.

### Pay accuracy
Two over-billing corrections, both forward-only: nothing already stored is rewritten.
- **Day off is now a distinct day type.** Un-ticking a crew member from a day used to write a paid APA Rest Day at flat BDR, which was billed on timesheets, text exports and invoices while the day view showed £0. Day off joins the day types as a true £0 not-engaged state that produces no lines for any surface to sum, and resolves no times, so a phantom call and wrap can no longer leak into the following day's turnaround maths. Rest Day survives as a deliberate paid assignment and is now shown honestly as a paid day everywhere, rather than being an amount you could not see.
- **Roles on Best Boy crew are picked, not typed.** The free-text role box is now a picker with departments as headings and the rate card as the only rate source. Picking a role fills the base day rate and derives the overtime profile from it, which ends the phantom overtime that was being billed for Directors and Producers - roles that do not take overtime. A stored role that is not a canonical name is shown as custom and repaired when re-picked; an untouched record is left byte-for-byte alone.

Display corrections in the same area, none of which change a figure:
- A plain night now reads the way a day shoot does: a flat ten-hour minimum fee line plus a separate Night OT line for the paid hours beyond the floor, with the workings underneath. The engine is untouched and the two lines re-sum to the same total.
- The department defaults lunch header stopped wearing one crew member's late lunch as if the default lunch itself were late.
- The Best Boy crew list now resolves the full defaults cascade, so the variance highlight and its accordion appear on days created by next-day or bulk add.

### Call sheet reader
The reader itself is unchanged, but the app was describing it wrongly. It reads invoicing details from a shared call sheet - production company, job reference, invoicing email and CC, invoicing address, and the production title - and has never read call, lunch or wrap times. Both places that claimed otherwise now say what it actually does, and say how to start it: open a call sheet PDF, tap share, and pick TimeMachine from the iOS share sheet. iPhone 15 Pro and above, as before.

### Settings
Nine top-level groups become eight. The written manual is gone, with the tutorial replacing it, and What's new moved in beside the tutorial replay so the release notes live in one place rather than two. Expense presets fold into New-production defaults, with a line making clear they are the exception in that group: the expenses picker reads the preset list live, so editing a preset reaches shoots you have already started. Data and backup moves inside About and help, which is renamed Help and data so that export and reset are findable by the words people actually scan for; it stays collapsible rather than being flattened.

### Other fixes
- The Best Boy add-crew editor became a full page, with keyboard avoidance that lifts and shrinks the sheet rather than covering the fields.
- Live Activity card events are now drained before the reconcile sweep on launch and foreground, so a wrap tapped on the card is not undone by the sweep that follows.
- Opening a Best Boy shoot always lands on the day page; Setup no longer opens itself.
- The zero-length lunch option reads "Missed / CWD", and production form placeholders are hints rather than fake example values.
- A root error boundary, plus a sheet crash fixed by hoisting the keyboard hooks above an early return.

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
