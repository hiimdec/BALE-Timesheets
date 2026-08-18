# TimeMachine — operating rules for Claude Code

This is the source of truth: the actual repo code (the local working copy, kept in sync with GitHub origin) wins over any summary, memory, or assumption. Verify against the code.

**Fresh session?** Read HANDOVER.md for the current release state (2026.11 (11) on `develop`; 5.3.0 (9) live on the App Store), the working disciplines in practice, and every parked item with context. MAINTENANCE.md holds the parked work; CALC_DECISIONS.md holds the calc rulings ledger.
## Build topology
The self-contained root `index.html` (React 18 + Tailwind + in-browser Babel via CDN) is the file the web app is built from. We edit it in the LOCAL working copy. It does not go live until it's committed and pushed to `main` on GitHub, which Netlify then auto-deploys to timemachineapp.co.uk.`/dist` is esbuild output for the Capacitor iOS wrap, gitignored. Not served to web.
Data: localStorage on web, @capacitor/preferences on native.
PDF: web = window.print(); iOS = native Swift plugin (NativePdfPlugin.swift), which renders the print DOM through WebKit's print pipeline to a vector A4 PDF. Timesheets and invoices both take this path; html2canvas/jsPDF are gone.
Invoices have two render paths: the on-screen editor view and the print/PDF view (#invoice-print-view). They are different DOM — changes to one do not imply the other.
Authoritative pay rules: APA_RULES.md.

## Non-negotiable rules
Propose-first on anything that touches the pay/calc engine, stored-data shape, a data migration, or money displayed on a breakdown/invoice. Investigate, show me the current logic, propose the change, and wait for sign-off. No silent edits to the pay engine.
Three-audit gate after every change: audit:build (byte-parity / no logic drift), audit:storage (migration + round-trip), audit:web (no native/PDF libs leaking into the web build). All green before a task is "done"; do not commit until green.
Verify through the real pipeline, not a proxy. On web that means the actual #invoice-print-view / #print-view DOM that print capture — not a static react-dom render. On native, the actual on-device export.
Invoices are frozen records: snapshot at send; never mutate a sent invoice, even if the underlying production changes.
Bug-fixes may repair data already saved. Preference changes are defaults for NEW shoots only — never retroactively rewrite a shoot the user already created.

## Reporting
Report each audit result plus a one-line summary per change. Flag before acting if a task would touch calc, stored data, or invoices.

---

# Environment notes

## Do NOT keep this project on iCloud Drive

This repo must live on a **local Mac volume** (e.g. `~/Developer/TimeMachine/…`),
**not** under `~/Library/Mobile Documents/com~apple~CloudDocs/…`.

**Why.** macOS 26 (Tahoe) attaches an immutable `com.apple.provenance`
extended attribute to anything stored on iCloud Drive. `xattr -c` silently
fails to remove it. During the iOS build, that xattr propagates into the
generated `App.app` bundle, and `codesign` then rejects the bundle with:

> `App.app: resource fork, Finder information, or similar detritus not allowed`

…breaking every `npx cap run ios` / Xcode build.

The fully reproducible symptom: clean rebuild, fresh DerivedData, build fails
at the CodeSign step on `App.app` with the message above.

**The fix.** Keep the working copy on the local disk. iCloud-backed clones are
fine for read-only inspection but cannot build iOS.

A workaround used during the iCloud period was to symlink
`ios/DerivedData` to `~/Library/Developer/Xcode/DerivedData/TimeMachine-CapBuild`
(local disk). That lets the build succeed because the produced `.app` lives
off iCloud — but other parts of the project tree (source files, Info.plist,
Assets.xcassets) still carry the provenance xattr, and a future Xcode/Capacitor
update could start failing on those too. Moving the entire project off iCloud
is the durable fix; the symlink is just a stop-gap until that move happens.
