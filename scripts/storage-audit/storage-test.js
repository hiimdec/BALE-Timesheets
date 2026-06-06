/*
 * storage-test.js — automated checks for the Preferences storage adapter.
 *
 *   $ node scripts/storage-audit/storage-test.js
 *
 * Loads the ACTUAL app code (index.html's babel script, JSX-transformed by the
 * same esbuild options the build uses) into a Node `vm` sandbox, twice over,
 * under controlled conditions, and asserts the storage adapter behaves:
 *
 *   A. WEB regression — window.Capacitor undefined → adapter is localStorage-
 *      only; the Preferences plugin is NEVER consulted; get/set/remove round-trip
 *      through localStorage exactly as before.
 *   B. NATIVE fresh install — empty Preferences + empty localStorage → clean
 *      start, migrated flag set, no data invented.
 *   C. NATIVE upgrade — empty Preferences + localStorage holding an older build's
 *      data → one-time copy lifts every key into Preferences; reads then come
 *      back synchronously.
 *   D. NATIVE already-migrated — Preferences authoritative; stale localStorage is
 *      IGNORED (never re-imported) and never shadows Preferences.
 *   E. NATIVE durability — rapid writes are ordered (last-write-wins) and flush()
 *      awaits them; this is what flush-before-reload and flush-on-background rely on.
 *
 * Exit code 0 = all pass, non-zero = a failure (details printed).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_HTML = path.join(ROOT, 'index.html');

// ---- fake-indexeddb factory + helpers ------------------------------------
// Each test that uses IDB needs an ISOLATED database (the fake-indexeddb
// module is a singleton, so two test runs would share state if we used the
// global). `freshIdb()` returns a brand-new IDBFactory each time.
function freshIdb() {
  // Clear the require cache so a clean factory is constructed per test.
  for (const k of Object.keys(require.cache)) {
    if (k.includes('fake-indexeddb')) delete require.cache[k];
  }
  const mod = require('fake-indexeddb');
  return { indexedDB: mod.indexedDB, IDBKeyRange: mod.IDBKeyRange };
}

// Wraps an IDBFactory so that put()s of specific keys silently store a
// different value. Used to simulate the LS→IDB import byte-compare failure.
function corruptingIdb(realIdb, corruptKeySet) {
  const wrapStore = (store) => new Proxy(store, {
    get(target, prop) {
      if (prop === 'put') {
        return (value, key) => {
          if (corruptKeySet.has(key)) return target.put(value + '__CORRUPT', key);
          return target.put(value, key);
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const wrapTx = (tx) => new Proxy(tx, {
    get(target, prop) {
      if (prop === 'objectStore') return (name) => wrapStore(target.objectStore(name));
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  const wrapDb = (db) => db ? new Proxy(db, {
    get(target, prop) {
      if (prop === 'transaction') return (storeName, mode) => wrapTx(target.transaction(storeName, mode));
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) : db;
  return {
    open(name, version) {
      const req = realIdb.open(name, version);
      return new Proxy(req, {
        get(target, prop) {
          if (prop === 'result') return wrapDb(target.result);
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
        set(target, prop, value) { target[prop] = value; return true; },
      });
    },
  };
}

// ---- tiny assert ----------------------------------------------------------
let failures = 0;
const results = [];
function check(name, cond, detail) {
  const ok = !!cond;
  if (!ok) failures++;
  results.push({ name, ok, detail: ok ? '' : (detail || '') });
}

// ---- recording localStorage stub -----------------------------------------
function makeLocalStorage(seed = {}, opts = {}) {
  const store = new Map(Object.entries(seed));
  const calls = { get: 0, set: 0, remove: 0 };
  // opts.throwOnSet: function (key) -> string|null. Return an error string to
  // throw a QuotaExceededError-like for that write; null to allow. Lets tests
  // simulate a near-cap user where specific keys can't be written.
  return {
    _store: store,
    _calls: calls,
    getItem(k) { calls.get++; return store.has(k) ? store.get(k) : null; },
    setItem(k, v) {
      calls.set++;
      if (opts.throwOnSet) {
        const reason = opts.throwOnSet(k);
        if (reason) { const e = new Error(reason); e.name = 'QuotaExceededError'; throw e; }
      }
      store.set(k, String(v));
    },
    removeItem(k) { calls.remove++; store.delete(k); },
    clear() { store.clear(); },
    key(i) { return Array.from(store.keys())[i] ?? null; },
    get length() { return store.size; },
  };
}

// ---- fake @capacitor/preferences (async, in-memory) -----------------------
function makePreferences(seed = {}, opts = {}) {
  const store = new Map(Object.entries(seed));
  const calls = { get: 0, set: 0, remove: 0 };
  // opts.rejectOnSet: function (key) -> string|null. Return a string to reject
  // the async set; null to allow. Simulates a Preferences write failure
  // (e.g. quota exceeded on iOS).
  return {
    _store: store,
    _calls: calls,
    async get({ key }) { calls.get++; return { value: store.has(key) ? store.get(key) : null }; },
    async set({ key, value }) {
      calls.set++;
      if (opts.rejectOnSet) {
        const reason = opts.rejectOnSet(key);
        if (reason) throw new Error(reason);
      }
      store.set(key, String(value));
    },
    async remove({ key }) { calls.remove++; store.delete(key); },
    async keys() { return { keys: Array.from(store.keys()) }; },
    async clear() { store.clear(); },
  };
}

// ---- fake @capacitor/app --------------------------------------------------
function makeAppPlugin() {
  const listeners = [];
  return {
    _listeners: listeners,
    addListener(event, cb) { listeners.push({ event, cb }); return { remove() {} }; },
    fire(event, payload) { listeners.filter((l) => l.event === event).forEach((l) => l.cb(payload)); },
  };
}

// ---- sandbox --------------------------------------------------------------
function makeSandbox({ capacitor, localStorage, indexedDB, IDBKeyRange }) {
  const noop = () => {};
  const el = () => ({
    style: {}, setAttribute: noop, appendChild: noop, removeChild: noop,
    addEventListener: noop, removeEventListener: noop, focus: noop, click: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  });
  const React = {
    createElement: () => null, Fragment: 'Fragment', createContext: () => ({ Provider: noop, Consumer: noop }),
    useState: (i) => [typeof i === 'function' ? i() : i, noop], useEffect: noop, useLayoutEffect: noop,
    useMemo: (f) => f(), useCallback: (f) => f, useRef: (i) => ({ current: i ?? null }),
    useReducer: (r, i, init) => [init ? init(i) : i, noop], useContext: () => null, memo: (f) => f,
    forwardRef: (f) => f, useImperativeHandle: noop, useId: () => 'id',
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Date, Math, JSON, RegExp, Number, String, Array, Object, Map, Set, WeakMap, Symbol,
    Promise, Error, TypeError, RangeError, parseInt, parseFloat, isNaN, isFinite,
    NaN, Infinity, undefined, Boolean, Proxy, Reflect, encodeURIComponent, decodeURIComponent,
    URL, URLSearchParams,
    React,
    ReactDOM: { createRoot: () => ({ render: noop, unmount: noop }), version: 'stub' },
    localStorage,
    navigator: { userAgent: 'storage-test', language: 'en-GB', onLine: true },
    location: { href: 'file:///t/index.html', reload: noop, protocol: 'file:' },
    document: {
      getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [],
      createElement: () => el(), addEventListener: noop, removeEventListener: noop,
      body: el(), head: el(), documentElement: el(), hidden: false, readyState: 'complete',
    },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: clearTimeout,
    alert: noop, prompt: () => '', confirm: () => true,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  if (capacitor) sandbox.Capacitor = capacitor; // window.Capacitor
  if (indexedDB) sandbox.indexedDB = indexedDB;
  if (IDBKeyRange) sandbox.IDBKeyRange = IDBKeyRange;
  return sandbox;
}

// ---- load the app script, exposing `storage` ------------------------------
let cachedCode = null;
async function transformedAppCode() {
  if (cachedCode) return cachedCode;
  const html = fs.readFileSync(SRC_HTML, 'utf8');
  const startMarker = '<script type="text/babel" data-type="module">';
  const s = html.indexOf(startMarker) + startMarker.length;
  const e = html.indexOf('</script>', s);
  const body = html.slice(s, e) +
    '\n;globalThis.__storage = storage;\n' +
    // Both web and native boots are async (since the IDB-prep boot-order
    // change). Expose migrationResult via a getter so tests reading it after
    // `await settle()` always see the latest assignment (the `let
    // migrationResult` is reassigned inside the async chain).
    'try { Object.defineProperty(globalThis, "__migrationResult", { get: () => migrationResult, configurable: true }); } catch (_) {}\n' +
    // Stage-1 Kit Inventory verification: expose importBackup and
    // DEFAULT_USER_PREFS so tests can exercise the backup round-trip path
    // (used by the L-suite to confirm kitInventory restores cleanly and old
    // backups without the key get the empty-array fallback).
    'try { globalThis.__importBackup = importBackup; } catch (_) {}\n' +
    'try { globalThis.__DEFAULT_USER_PREFS = DEFAULT_USER_PREFS; } catch (_) {}\n';
  const { code } = await esbuild.transform(body, {
    loader: 'jsx', jsx: 'transform', jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment', target: 'es2017',
  });
  cachedCode = code;
  return code;
}

async function runApp(sandboxOpts) {
  const code = await transformedAppCode();
  const sandbox = makeSandbox(sandboxOpts);
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'app-under-test.js', displayErrors: true });
  return sandbox;
}

// Let pending microtasks/timers (the async boot chain) settle.
function settle(ms = 30) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
async function main() {
  // ===== A. WEB regression =====
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle();
    const storage = sb.__storage;
    check('A1 web: adapter is non-native', storage && storage.isNative === false, `isNative=${storage && storage.isNative}`);
    // round-trip through localStorage
    storage.set('probe_key', 'probe_val');
    check('A2 web: set hit localStorage', localStorage._store.get('probe_key') === 'probe_val');
    check('A3 web: get reads localStorage', storage.get('probe_key') === 'probe_val');
    storage.remove('probe_key');
    check('A4 web: remove hit localStorage', !localStorage._store.has('probe_key'));
    check('A5 web: no Capacitor object present', sb.Capacitor === undefined);
    // boot ran migrations through localStorage (schema version set to current)
    check('A6 web: migrations ran via localStorage', localStorage._store.has('bigals_schema_version'),
      `keys=${Array.from(localStorage._store.keys())}`);
  }

  // ===== B. NATIVE fresh install =====
  {
    const localStorage = makeLocalStorage();           // empty
    const Preferences = makePreferences();             // empty
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    const sb = await runApp({ capacitor, localStorage });
    await settle();
    const storage = sb.__storage;
    check('B1 native fresh: adapter is native', storage && storage.isNative === true);
    check('B2 native fresh: no productions invented', storage.get('bigals_productions') === null,
      `got=${JSON.stringify(storage.get('bigals_productions'))}`);
    check('B3 native fresh: migrated flag set once', Preferences._store.get('bigals_native_migrated') === '1');
    check('B4 native fresh: background flush listener installed', App._listeners.some((l) => l.event === 'appStateChange'));
  }

  // ===== C. NATIVE upgrade — one-time localStorage → Preferences copy =====
  {
    const seededProductions = JSON.stringify([{ id: 'p1', title: 'Old Gig', days: [], crew: [] }]);
    const seededPrefs = JSON.stringify({ displayName: 'Dec', defaultBDR: 444 });
    const localStorage = makeLocalStorage({
      bigals_productions: seededProductions,
      bigals_user_prefs: seededPrefs,
      bigals_schema_version: '3',
    });
    const Preferences = makePreferences(); // empty — simulates first launch of new build
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    const sb = await runApp({ capacitor, localStorage });
    await settle();
    const storage = sb.__storage;
    check('C1 upgrade: productions copied to Preferences', Preferences._store.get('bigals_productions') === seededProductions,
      `prefs=${Preferences._store.get('bigals_productions')}`);
    check('C2 upgrade: prefs copied to Preferences', Preferences._store.get('bigals_user_prefs') === seededPrefs);
    check('C3 upgrade: schema version copied', Preferences._store.get('bigals_schema_version') === '3');
    check('C4 upgrade: synchronous read returns copied data', storage.get('bigals_productions') === seededProductions);
    check('C5 upgrade: migrated flag set', Preferences._store.get('bigals_native_migrated') === '1');
    check('C6 upgrade: localStorage left intact as fallback', localStorage._store.get('bigals_productions') === seededProductions);
  }

  // ===== D. NATIVE already-migrated — stale localStorage ignored =====
  {
    const prefsProductions = JSON.stringify([{ id: 'p2', title: 'Current Gig', days: [], crew: [] }]);
    const staleLocal = JSON.stringify([{ id: 'pX', title: 'STALE should be ignored', days: [], crew: [] }]);
    const localStorage = makeLocalStorage({ bigals_productions: staleLocal });
    const Preferences = makePreferences({
      bigals_productions: prefsProductions,
      // Seed the current schema version so boot's runMigrations() is a no-op and
      // leaves the value byte-identical — otherwise migrations legitimately
      // rewrite it (which would be the correct behaviour, just not what this
      // particular "stale localStorage is ignored" assertion is checking).
      bigals_schema_version: '3',
      bigals_native_migrated: '1',
    });
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    const sb = await runApp({ capacitor, localStorage });
    await settle();
    const storage = sb.__storage;
    check('D1 migrated: reads Preferences not localStorage', storage.get('bigals_productions') === prefsProductions,
      `got=${storage.get('bigals_productions')}`);
    check('D2 migrated: stale localStorage NOT copied over Preferences', Preferences._store.get('bigals_productions') === prefsProductions);
  }

  // ===== E. NATIVE durability — ordered writes + flush =====
  {
    const localStorage = makeLocalStorage();
    const Preferences = makePreferences({ bigals_productions: '[]', bigals_native_migrated: '1' });
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    const sb = await runApp({ capacitor, localStorage });
    await settle();
    const storage = sb.__storage;
    // rapid-fire writes to the same key
    storage.set('bigals_productions', 'v1');
    storage.set('bigals_productions', 'v2');
    storage.set('bigals_productions', 'v3');
    check('E1 durability: cache reflects last write immediately', storage.get('bigals_productions') === 'v3');
    await storage.flush();
    check('E2 durability: flush persists last-write-wins', Preferences._store.get('bigals_productions') === 'v3',
      `persisted=${Preferences._store.get('bigals_productions')}`);
    // simulate app backgrounding → should trigger a flush of any later write
    storage.set('bigals_user_prefs', '{"x":1}');
    App.fire('appStateChange', { isActive: false });
    await settle();
    check('E3 durability: background flush persisted the write', Preferences._store.get('bigals_user_prefs') === '{"x":1}');
  }

  // ===== F. PRE-MIGRATION BACKUP PRUNE — safe deletion semantics =====
  // The prune lives inside runMigrations' early-return branch (no migration
  // needed). It must NEVER fire in the same run that wrote a snapshot, and
  // must fire when a backup from a prior launch has survived a cold relaunch.
  {
    // F1 — NO-OP LAUNCH WITH BACKUP PRESENT (native): backup pruned.
    const stalePrefsBackup = JSON.stringify({ productions: '[]', schemaVersion: '2' });
    const Preferences = makePreferences({
      bigals_productions: '[]',
      bigals_schema_version: '3',
      bigals_native_migrated: '1',
      bigals_pre_migration_backup: stalePrefsBackup,
    });
    const localStorage = makeLocalStorage();
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    await runApp({ capacitor, localStorage });
    await settle();
    check('F1 prune: stale backup removed on no-op launch (native)',
      !Preferences._store.has('bigals_pre_migration_backup'),
      `still=${Preferences._store.get('bigals_pre_migration_backup')}`);
    check('F1 prune: productions data untouched',
      Preferences._store.get('bigals_productions') === '[]');
    check('F1 prune: schema_version unchanged',
      Preferences._store.get('bigals_schema_version') === '3');
  }
  {
    // F2 — MIGRATION LAUNCH WITH STALE BACKUP (native): backup is REFRESHED
    //       (the new snapshot), NOT removed by the prune (prune branch doesn't
    //       fire on a migration launch). Verifies the "never deletes a backup
    //       created in the same run" guarantee.
    const stalePrefsBackup = JSON.stringify({ productions: '"OLD STALE — should be overwritten by fresh snapshot"', schemaVersion: '0' });
    const Preferences = makePreferences({
      bigals_productions: '[]',
      bigals_schema_version: '2',  // one below target → migrate 3 runs
      bigals_native_migrated: '1',
      bigals_pre_migration_backup: stalePrefsBackup,
    });
    const localStorage = makeLocalStorage();
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    await runApp({ capacitor, localStorage });
    await settle();
    const backupAfter = Preferences._store.get('bigals_pre_migration_backup');
    check('F2 prune: backup STILL PRESENT after migration (not deleted)',
      backupAfter !== undefined && backupAfter !== null,
      `gone or missing=${backupAfter === undefined ? 'undefined' : backupAfter}`);
    check('F2 prune: backup REFRESHED (no longer the stale one)',
      backupAfter !== stalePrefsBackup,
      `still equals stale (snapshot was NOT refreshed)`);
    let parsedBackup;
    try { parsedBackup = JSON.parse(backupAfter); } catch {}
    check('F2 prune: fresh backup carries the pre-migration schema version',
      parsedBackup && parsedBackup.schemaVersion === '2',
      `parsed.schemaVersion=${parsedBackup && parsedBackup.schemaVersion}`);
    check('F2 prune: migration ran (schema bumped to current)',
      Preferences._store.get('bigals_schema_version') === '3');
  }
  {
    // F3 — NO-OP LAUNCH WITH NO BACKUP (native): no-op, no error.
    const Preferences = makePreferences({
      bigals_productions: '[]',
      bigals_schema_version: '3',
      bigals_native_migrated: '1',
      // no pre_migration_backup key
    });
    const localStorage = makeLocalStorage();
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    const sb = await runApp({ capacitor, localStorage });
    await settle();
    check('F3 prune: no-op launch with no backup is safe (no throw)',
      !!sb.__storage);
    check('F3 prune: backup key never appeared',
      !Preferences._store.has('bigals_pre_migration_backup'));
  }
  {
    // F4 — WEB: same prune behaviour through localStorage.
    const localStorage = makeLocalStorage({
      bigals_productions: '[]',
      bigals_schema_version: '3',
      bigals_pre_migration_backup: '{"productions":"[]","schemaVersion":"2"}',
    });
    await runApp({ capacitor: undefined, localStorage });
    await settle();
    check('F4 prune: stale backup removed on no-op launch (web)',
      !localStorage._store.has('bigals_pre_migration_backup'),
      `still=${localStorage._store.get('bigals_pre_migration_backup')}`);
  }

  // ===== G. ABORT PATH — snapshot write failure on a migration launch =====
  // Simulates a near-cap user: localStorage throws QuotaExceededError on the
  // pre-migration snapshot write. Migration must NOT touch productions data,
  // schema_version must NOT advance, and migrationResult.error must surface.
  {
    const preserved = JSON.stringify([{ id: 'p1', title: 'Pre-update data, must not be touched' }]);
    const localStorage = makeLocalStorage(
      { bigals_productions: preserved, bigals_schema_version: '2' },
      { throwOnSet: (k) => k === 'bigals_pre_migration_backup' ? 'QuotaExceededError: quota' : null },
    );
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle();
    check('G1 abort: productions data UNTOUCHED when snapshot fails',
      localStorage._store.get('bigals_productions') === preserved,
      `productions=${localStorage._store.get('bigals_productions')}`);
    check('G1 abort: schema_version stayed at old value',
      localStorage._store.get('bigals_schema_version') === '2',
      `schema_version=${localStorage._store.get('bigals_schema_version')}`);
    check('G1 abort: snapshot backup NOT written',
      !localStorage._store.has('bigals_pre_migration_backup'));
    const mr = sb.__migrationResult;
    check('G1 abort: migrationResult.error set (B1 banner will surface)',
      mr && typeof mr.error === 'string' && mr.error.length > 0,
      `migrationResult=${JSON.stringify(mr)}`);
    check('G1 abort: migrationResult.error mentions safety snapshot',
      mr && /safety snapshot/i.test(mr.error || ''),
      `error=${mr && mr.error}`);
    check('G1 abort: app loaded (sandbox completed, no crash)',
      !!sb.__storage);
  }

  // ===== I. NATIVE ASYNC WRITE-FAILURE ROUTING (B3) =====
  // The native adapter's set() / remove() resolve synchronously into an
  // in-memory cache, then persist Preferences in the background. A background
  // failure used to be logged to console and silently set lastError. We now
  // expose setAsyncErrorHandler so the React layer can surface it in the
  // same red banner useStoredState already feeds.
  {
    const Preferences = makePreferences(
      { bigals_productions: '[]', bigals_schema_version: '3', bigals_native_migrated: '1' },
      { rejectOnSet: (k) => k === 'bigals_user_prefs' ? 'QuotaExceededError: native quota' : null },
    );
    const localStorage = makeLocalStorage();
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    const sb = await runApp({ capacitor, localStorage });
    await settle();
    const storage = sb.__storage;
    check('I0 setAsyncErrorHandler exists on native adapter',
      typeof storage.setAsyncErrorHandler === 'function');
    // Capture errors the way Root() does — call setAsyncErrorHandler with a
    // collector instead of the real setNativeStorageError.
    const captured = [];
    storage.setAsyncErrorHandler((info) => captured.push(info));
    // Trigger a write that the Preferences mock will reject.
    storage.set('bigals_user_prefs', '{"x":1}');
    await settle();
    check('I1 native: in-memory cache reflects the rejected write (sync semantics)',
      storage.get('bigals_user_prefs') === '{"x":1}',
      `cache=${storage.get('bigals_user_prefs')}`);
    check('I1 native: handler invoked with the failed write',
      captured.length === 1 && captured[0].key === 'bigals_user_prefs' && captured[0].op === 'set',
      `captured=${JSON.stringify(captured)}`);
    check('I1 native: handler error message preserved',
      captured.length === 1 && /native quota/i.test(captured[0].error && captured[0].error.message || ''),
      `error=${captured[0] && captured[0].error}`);
    // Sanity: a write that does NOT fail must NOT trigger the handler.
    storage.set('bigals_productions', '["allowed"]');
    await settle();
    check('I2 native: successful writes do not trigger the handler',
      captured.length === 1,
      `captured len=${captured.length}`);
    // Unregister: setting null must clear the handler.
    storage.setAsyncErrorHandler(null);
    storage.set('bigals_user_prefs', '{"y":2}');
    await settle();
    check('I3 native: handler unregistration silences notifications',
      captured.length === 1,
      `captured len after unregister=${captured.length}`);
  }

  // ===== H. VERSION-MARKER WRITE FAILURE — soft error =====
  // Migration body succeeded but the version-marker write fails. Data is
  // at the new schema; surface a non-fatal error so the user knows the
  // marker will retry on next launch. (Our migrations are idempotent.)
  {
    const localStorage = makeLocalStorage(
      { bigals_productions: '[]', bigals_schema_version: '2' },
      // Refuse only the final schema-version bump (snapshot doesn't write
      // that key, so this isolates the marker-write failure).
      { throwOnSet: (k) => k === 'bigals_schema_version' ? 'QuotaExceededError: quota' : null },
    );
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle();
    const mr = sb.__migrationResult;
    check('H1 marker-fail: migrationResult.error set (soft)',
      mr && typeof mr.error === 'string' && /version marker/i.test(mr.error || ''),
      `error=${mr && mr.error}`);
    check('H1 marker-fail: migrationResult still says ran=true',
      mr && mr.ran === true,
      `ran=${mr && mr.ran}`);
    check('H1 marker-fail: app loaded (no crash)',
      !!sb.__storage);
  }

  // ===== J. INDEXEDDB BACKEND — opt-in adapter =====

  // J1 — BOOT-ORDER GATE (critical): seed IDB with a populated production
  // store at the current schema_version, boot via the async path, assert
  // productions came through intact and runMigrations DID NOT migrate.
  // This is the safety property the whole boot reorder existed to enable:
  // a regression here would silently wipe user data.
  {
    const idbEnv = freshIdb();
    const seededProductions = JSON.stringify([{ id: 'p1', title: 'Pre-existing on IDB', days: [], crew: [] }]);
    // Pre-populate fake IDB by writing directly through the factory.
    await new Promise((resolve, reject) => {
      const req = idbEnv.indexedDB.open('timemachine', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(seededProductions, 'bigals_productions');
        tx.objectStore('kv').put('3', 'bigals_schema_version');
        tx.objectStore('kv').put('1', '__idb_ls_import_complete');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    const localStorage = makeLocalStorage({ bigals_idb_optin: '1' });
    const sb = await runApp({ capacitor: undefined, localStorage, indexedDB: idbEnv.indexedDB, IDBKeyRange: idbEnv.IDBKeyRange });
    await settle(100); // give preload + boot a beat
    const storage = sb.__storage;
    check('J1 boot-order: adapter is IDB-backed',
      storage.backend === 'indexeddb',
      `backend=${storage.backend}`);
    check('J1 boot-order: productions came through preload unmodified',
      storage.get('bigals_productions') === seededProductions,
      `got=${storage.get('bigals_productions')}`);
    check('J1 boot-order: schema_version untouched (no spurious migration)',
      storage.get('bigals_schema_version') === '3',
      `schema=${storage.get('bigals_schema_version')}`);
    const mr = sb.__migrationResult;
    check('J1 boot-order: runMigrations took no-op (early return)',
      mr && mr.ran === false,
      `migrationResult=${JSON.stringify(mr)}`);
  }

  // J2 — LS→IDB import success: seed LS with productions, empty IDB,
  // assert the rollback-safe import copies LS → IDB, verifies byte-equal,
  // sets the marker, and leaves LS untouched.
  {
    const idbEnv = freshIdb();
    const seededProductions = JSON.stringify([{ id: 'pX', title: 'On localStorage, awaiting import', days: [], crew: [] }]);
    const localStorage = makeLocalStorage({
      bigals_idb_optin: '1',
      bigals_productions: seededProductions,
      bigals_schema_version: '3',
    });
    const sb = await runApp({ capacitor: undefined, localStorage, indexedDB: idbEnv.indexedDB, IDBKeyRange: idbEnv.IDBKeyRange });
    await settle(100);
    const storage = sb.__storage;
    // Adapter cache must now see the imported value.
    check('J2 import: cache reflects imported productions',
      storage.get('bigals_productions') === seededProductions,
      `cache=${storage.get('bigals_productions')}`);
    // Verify IDB itself holds the value AND the marker.
    const idbProd = await new Promise((res) => {
      const req = idbEnv.indexedDB.open('timemachine', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readonly');
        const r = tx.objectStore('kv').get('bigals_productions');
        r.onsuccess = () => { db.close(); res(r.result); };
      };
    });
    check('J2 import: IDB now holds the imported productions',
      idbProd === seededProductions,
      `idb=${idbProd}`);
    const idbMarker = await new Promise((res) => {
      const req = idbEnv.indexedDB.open('timemachine', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readonly');
        const r = tx.objectStore('kv').get('__idb_ls_import_complete');
        r.onsuccess = () => { db.close(); res(r.result); };
      };
    });
    check('J2 import: marker SET (import complete)',
      idbMarker === '1',
      `marker=${idbMarker}`);
    check('J2 import: localStorage left intact as fallback',
      localStorage._store.get('bigals_productions') === seededProductions);
  }

  // J3 — Import verify-failure: corrupt the put() of one key so the
  // byte-compare on read-back fails. Marker MUST NOT be set; the error
  // must surface via the deferred-errors queue when a handler registers.
  {
    const idbEnv = freshIdb();
    const corruptingFactory = corruptingIdb(idbEnv.indexedDB, new Set(['bigals_productions']));
    const seededProductions = JSON.stringify([{ id: 'p1', title: 'Will be corrupted', days: [], crew: [] }]);
    const localStorage = makeLocalStorage({
      bigals_idb_optin: '1',
      bigals_productions: seededProductions,
      bigals_schema_version: '3',
    });
    const sb = await runApp({ capacitor: undefined, localStorage, indexedDB: corruptingFactory, IDBKeyRange: idbEnv.IDBKeyRange });
    await settle(100);
    // Read the marker directly from the underlying (real) factory.
    const idbMarker = await new Promise((res) => {
      const req = idbEnv.indexedDB.open('timemachine', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readonly');
        const r = tx.objectStore('kv').get('__idb_ls_import_complete');
        r.onsuccess = () => { db.close(); res(r.result); };
      };
    });
    check('J3 verify-fail: marker NOT set (next launch will retry)',
      idbMarker == null,
      `marker unexpectedly=${idbMarker}`);
    // The deferred-errors queue should hold the import-verify error.
    const errs = [];
    sb.__storage.setAsyncErrorHandler((info) => errs.push(info));
    await settle(10);
    check('J3 verify-fail: error surfaced via deferred queue when handler registers',
      errs.some(e => e.op === 'import-verify' || /verify|mismatch/i.test(e.error && e.error.message || '')),
      `captured=${JSON.stringify(errs.map(e => ({ key: e.key, op: e.op, msg: e.error && e.error.message })))}`);
    check('J3 verify-fail: localStorage still primary (untouched)',
      localStorage._store.get('bigals_productions') === seededProductions);
  }

  // J4 — WEB-FALLBACK: indexedDB unavailable → adapter is the LS
  // passthrough. App boots without touching IDB.
  {
    const localStorage = makeLocalStorage({
      bigals_idb_optin: '1',  // opt-in is set but IDB is undefined
      bigals_productions: '[]',
      bigals_schema_version: '3',
    });
    // Pass NO indexedDB into the sandbox — useIdb returns false because of
    // `typeof indexedDB === 'undefined'` short-circuit.
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    check('J4 fallback: adapter is localStorage when IDB is unavailable',
      sb.__storage.backend === 'localStorage',
      `backend=${sb.__storage.backend}`);
    check('J4 fallback: data accessible via LS passthrough',
      sb.__storage.get('bigals_productions') === '[]');
  }

  // ===== K. PHASE 2 — IndexedDB is the web default =====

  // K1 — Default landing: NO flag set, IDB available → adapter is IDB and
  // the LS→IDB import runs on first launch.
  {
    const idbEnv = freshIdb();
    const seededProductions = JSON.stringify([{ id: 'p1', title: 'Fresh user, IDB default', days: [], crew: [] }]);
    const localStorage = makeLocalStorage({
      // NO bigals_idb_optin, NO bigals_idb_force_off — fully default behaviour.
      bigals_productions: seededProductions,
      bigals_schema_version: '3',
    });
    const sb = await runApp({ capacitor: undefined, localStorage, indexedDB: idbEnv.indexedDB, IDBKeyRange: idbEnv.IDBKeyRange });
    await settle(100);
    check('K1 default: adapter is IDB without any opt-in flag',
      sb.__storage.backend === 'indexeddb',
      `backend=${sb.__storage.backend}`);
    check('K1 default: cache reflects LS data after import',
      sb.__storage.get('bigals_productions') === seededProductions,
      `cache=${sb.__storage.get('bigals_productions')}`);
    const idbProd = await new Promise((res) => {
      const req = idbEnv.indexedDB.open('timemachine', 1);
      req.onsuccess = () => {
        const db = req.result;
        const r = db.transaction('kv', 'readonly').objectStore('kv').get('bigals_productions');
        r.onsuccess = () => { db.close(); res(r.result); };
      };
    });
    check('K1 default: IDB holds the imported data',
      idbProd === seededProductions,
      `idb=${idbProd}`);
    const status = sb.__storage.getStatus();
    check('K1 default: getStatus reports indexeddb',
      status && status.backend === 'indexeddb',
      `status=${JSON.stringify(status)}`);
  }

  // K2 — Force-localStorage override (?idb=0 sticky flag): even when IDB
  // is available, the adapter stays on LS. Used as the in-the-wild OFF
  // switch when something goes wrong with IDB.
  {
    const idbEnv = freshIdb();
    const seededProductions = JSON.stringify([{ id: 'pX', title: 'Force-LS override path', days: [], crew: [] }]);
    const localStorage = makeLocalStorage({
      bigals_idb_force_off: '1',  // the sticky override flag
      bigals_productions: seededProductions,
      bigals_schema_version: '3',
    });
    const sb = await runApp({ capacitor: undefined, localStorage, indexedDB: idbEnv.indexedDB, IDBKeyRange: idbEnv.IDBKeyRange });
    await settle(50);
    check('K2 force-off: adapter is localStorage despite IDB being available',
      sb.__storage.backend === 'localStorage',
      `backend=${sb.__storage.backend}`);
    check('K2 force-off: data accessible via LS passthrough',
      sb.__storage.get('bigals_productions') === seededProductions);
    const status = sb.__storage.getStatus();
    check('K2 force-off: getStatus reports localStorage with override reason',
      status && status.backend === 'localStorage' && /override/i.test(status.backendReason || ''),
      `status=${JSON.stringify(status)}`);
    check('K2 force-off: IDB never touched (still empty)',
      await new Promise((res) => {
        const req = idbEnv.indexedDB.open('timemachine', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => {
          const db = req.result;
          const r = db.transaction('kv', 'readonly').objectStore('kv').get('bigals_productions');
          r.onsuccess = () => { db.close(); res(r.result == null); };
        };
      }));
  }

  // ===== L. STAGE-1 KIT INVENTORY ROUND-TRIP =====
  // userPrefs.kitInventory is a new top-level field in DEFAULT_USER_PREFS
  // (additive, no schema bump, no migration). The merge-over-defaults guard
  // inside importBackup means a Stage-1 backup (with items) restores them
  // verbatim and a pre-Stage-1 backup (no kitInventory key) imports cleanly
  // to an empty array.
  {
    // L1 — DEFAULT_USER_PREFS exposes the new key.
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const defaults = sb.__DEFAULT_USER_PREFS;
    check('L1 prefs: DEFAULT_USER_PREFS has a kitInventory key',
      defaults && Array.isArray(defaults.kitInventory),
      `kitInventory=${defaults && defaults.kitInventory}`);
    check('L1 prefs: default kitInventory is empty',
      defaults && Array.isArray(defaults.kitInventory) && defaults.kitInventory.length === 0,
      `length=${defaults && defaults.kitInventory && defaults.kitInventory.length}`);

    // L2 — Backup made WITH items restores them.
    const payload = JSON.stringify({
      version: 1,
      schemaVersion: 3,
      productions: [],
      userPrefs: {
        displayName: 'Test User',
        defaultBDR: 444,
        kitInventory: [
          { id: 'kit-a', name: 'Sennheiser MKH8060', defaultDailyRate: 75, defaultOn: true },
          { id: 'kit-b', name: 'Sound Devices MixPre-6', defaultDailyRate: 50, defaultOn: false },
        ],
      },
    });
    const r1 = sb.__importBackup(payload);
    check('L2 import-with-items: importBackup ok',
      r1 && r1.ok === true,
      `result=${JSON.stringify(r1)}`);
    const storedPrefsRaw = sb.__storage.get('bigals_user_prefs');
    const stored = JSON.parse(storedPrefsRaw || 'null');
    check('L2 import-with-items: kitInventory length restored',
      stored && Array.isArray(stored.kitInventory) && stored.kitInventory.length === 2,
      `length=${stored && stored.kitInventory && stored.kitInventory.length}`);
    check('L2 import-with-items: kitInventory[0] fields verbatim',
      stored && stored.kitInventory && stored.kitInventory[0] &&
        stored.kitInventory[0].id === 'kit-a' &&
        stored.kitInventory[0].name === 'Sennheiser MKH8060' &&
        stored.kitInventory[0].defaultDailyRate === 75 &&
        stored.kitInventory[0].defaultOn === true,
      `item0=${JSON.stringify(stored && stored.kitInventory && stored.kitInventory[0])}`);
    check('L2 import-with-items: other userPrefs survived the merge',
      stored && stored.displayName === 'Test User' && stored.defaultBDR === 444,
      `prefs=${JSON.stringify({ name: stored && stored.displayName, bdr: stored && stored.defaultBDR })}`);
  }
  {
    // L3 — Pre-Stage-1 backup (no kitInventory key) imports cleanly to [].
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const legacyPayload = JSON.stringify({
      version: 1,
      schemaVersion: 3,
      productions: [],
      userPrefs: {
        displayName: 'Legacy User',
        defaultBDR: 500,
        // NO kitInventory key at all — simulates a backup made before Stage 1.
      },
    });
    const r2 = sb.__importBackup(legacyPayload);
    check('L3 pre-stage-1: importBackup ok',
      r2 && r2.ok === true,
      `result=${JSON.stringify(r2)}`);
    const stored = JSON.parse(sb.__storage.get('bigals_user_prefs') || 'null');
    check('L3 pre-stage-1: kitInventory present as empty array (merge-over-defaults)',
      stored && Array.isArray(stored.kitInventory) && stored.kitInventory.length === 0,
      `kitInventory=${JSON.stringify(stored && stored.kitInventory)}`);
    check('L3 pre-stage-1: legacy fields preserved',
      stored && stored.displayName === 'Legacy User' && stored.defaultBDR === 500);
  }

  // K3 — IDB UNHEALTHY → LS-as-primary, not partial IDB. A broken
  // IDB factory whose open() rejects forces the adapter into degraded
  // mode; subsequent reads/writes route to localStorage transparently.
  {
    const brokenIdb = {
      open() {
        const req = {};
        // Fire onerror on the next microtask so onerror is registered first.
        setTimeout(() => {
          req.error = new Error('Simulated IDB open failure');
          if (typeof req.onerror === 'function') req.onerror({ target: req });
        }, 1);
        return req;
      },
    };
    const seededProductions = JSON.stringify([{ id: 'p1', title: 'IDB unhealthy → LS primary', days: [], crew: [] }]);
    const localStorage = makeLocalStorage({
      bigals_productions: seededProductions,
      bigals_schema_version: '3',
    });
    const sb = await runApp({ capacitor: undefined, localStorage, indexedDB: brokenIdb });
    await settle(100);
    const status = sb.__storage.getStatus();
    check('K3 unhealthy: getStatus reports localStorage (degraded)',
      status && status.backend === 'localStorage',
      `status=${JSON.stringify(status)}`);
    check('K3 unhealthy: degraded reason mentions the IDB failure',
      status && /IDB|IndexedDB|open/i.test(status.backendReason || ''),
      `reason=${status && status.backendReason}`);
    check('K3 unhealthy: reads return LS data',
      sb.__storage.get('bigals_productions') === seededProductions,
      `got=${sb.__storage.get('bigals_productions')}`);
    // Writes in degraded mode must land in LS, not get lost in an IDB write
    // chain that will never complete.
    sb.__storage.set('bigals_productions', '"changed-in-degraded-mode"');
    check('K3 unhealthy: writes routed to LS in degraded mode',
      localStorage._store.get('bigals_productions') === '"changed-in-degraded-mode"',
      `ls=${localStorage._store.get('bigals_productions')}`);
  }

  // ---- report ----
  console.log('');
  console.log('============================================================');
  console.log(' Storage adapter test — web regression + native logic');
  console.log('============================================================');
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : '   << ' + r.detail}`);
  }
  console.log('============================================================');
  if (failures === 0) {
    console.log(` ✅ PASS — all ${results.length} storage assertions passed.`);
  } else {
    console.log(` ❌ FAIL — ${failures} of ${results.length} assertions failed.`);
  }
  console.log('============================================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
