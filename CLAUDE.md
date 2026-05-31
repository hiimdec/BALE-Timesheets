# TimeMachine — environment notes for collaborators (human + AI)

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
