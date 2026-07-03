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
    'try { globalThis.__DEFAULT_USER_PREFS = DEFAULT_USER_PREFS; } catch (_) {}\n' +
    // Saved Clients Stage 2: expose the pure derivation so the N-suite can
    // exercise dedupe / no-mutation / empty-name / idempotency / sent-frozen
    // invariants without standing up a full React tree.
    'try { globalThis.__deriveClientFromSentInvoice = deriveClientFromSentInvoice; } catch (_) {}\n' +
    // Saved Clients Stage 3: expose the picker's pure helpers so the O-suite
    // can verify prefix matching, inline-completion gating, and recents
    // selection without needing a DOM.
    'try { globalThis.__matchClientsByPrefix = matchClientsByPrefix; } catch (_) {}\n' +
    'try { globalThis.__pickInlineCompletion = pickInlineCompletion; } catch (_) {}\n' +
    'try { globalThis.__pickRecentClients = pickRecentClients; } catch (_) {}\n' +
    // Saved Clients Stage 4: expose the nudge derivation + applier so the
    // P-suite can verify divergence detection / null-on-name-mismatch /
    // null-on-empty / null-on-unlinked, plus the apply path's selective
    // patching (only the diverged fields change; other clients untouched).
    'try { globalThis.__detectClientUpdate = detectClientUpdate; } catch (_) {}\n' +
    'try { globalThis.__applyClientUpdate  = applyClientUpdate;  } catch (_) {}\n' +
    // Inline time wheel (T-suite): expose the pure column-index
    // helpers and the constant lists.
    'try { globalThis.__parseHHMMIndices  = parseHHMMIndices;  } catch (_) {}\n' +
    'try { globalThis.__indicesToHHMM     = indicesToHHMM;     } catch (_) {}\n' +
    'try { globalThis.__TIME_WHEEL_HOURS   = TIME_WHEEL_HOURS;   } catch (_) {}\n' +
    'try { globalThis.__TIME_WHEEL_MINUTES = TIME_WHEEL_MINUTES; } catch (_) {}\n' +
    // Custom comparison item (U-suite): expose the validator + the
    // effective getters so the suite can verify the gate (empty/zero
    // hidden, valid included), plus the base constants for surface
    // verification.
    'try { globalThis.__validCustomComparison = validCustomComparison; } catch (_) {}\n' +
    'try { globalThis.__getComparisonItems    = getComparisonItems;    } catch (_) {}\n' +
    'try { globalThis.__getComparisonSurface  = getComparisonSurface;  } catch (_) {}\n' +
    'try { globalThis.__COMPARISON_ITEMS      = COMPARISON_ITEMS;      } catch (_) {}\n' +
    'try { globalThis.__COMPARISON_SURFACE    = COMPARISON_SURFACE;    } catch (_) {}\n' +
    // Scroll-to-top button (V-suite): expose the pure visibility gate.
    'try { globalThis.__shouldShowScrollTop = shouldShowScrollTop; } catch (_) {}\n' +
    // Invoices list section reorg (W-suite): expose the partition +
    // ordering helpers so the suite can verify the split, sort
    // directions, paid-month fallback chain, per-month totals, and
    // the "(undated)" bucket placement without standing up React.
    'try { globalThis.__isOverdueSent       = isOverdueSent;       } catch (_) {}\n' +
    'try { globalThis.__unpaidSortKey       = unpaidSortKey;       } catch (_) {}\n' +
    'try { globalThis.__paidMonthKey        = paidMonthKey;        } catch (_) {}\n' +
    'try { globalThis.__partitionInvoiceList = partitionInvoiceList; } catch (_) {}\n' +
    // Monthly earnings (X-suite): expose aggregateMonthly + the
    // calc-line categoriser + the kit-discount + day-resolver helpers
    // so the suite can build fixtures that exercise the full path.
    'try { globalThis.__aggregateMonthly  = aggregateMonthly;  } catch (_) {}\n' +
    'try { globalThis.__categorizeBreakdownLine = categorizeBreakdownLine; } catch (_) {}\n' +
    'try { globalThis.__computeProductionKitDiscount = computeProductionKitDiscount; } catch (_) {}\n' +
    'try { globalThis.__todayISO = todayISO; } catch (_) {}\n' +
    // Expenses rework (EX-suite): expose calcForDisplay + the pure expense-entry
    // migration helpers so the suite can prove migration-invariance (calcForDisplay
    // byte-identical pre/post migrate) and the old→new / perDiem→instance mapping.
    'try { globalThis.__calcForDisplay = calcForDisplay; } catch (_) {}\n' +
    'try { globalThis.__migrateDayExpenses = migrateDayExpenses; } catch (_) {}\n' +
    'try { globalThis.__migrateExpenseEntry = migrateExpenseEntry; } catch (_) {}\n' +
    // Monthly earnings chart-view helpers (Y-suite): expose the pure
    // windowing / clamping / vs-last-year / average helpers so the
    // suite can verify the chart's data layer without rendering.
    'try { globalThis.__monthlyAddOffset    = monthlyAddOffset;    } catch (_) {}\n' +
    'try { globalThis.__monthlyTaxYearOf    = monthlyTaxYearOf;    } catch (_) {}\n' +
    'try { globalThis.__monthlyWindow       = monthlyWindow;       } catch (_) {}\n' +
    'try { globalThis.__clampMonthlyAnchor  = clampMonthlyAnchor;  } catch (_) {}\n' +
    'try { globalThis.__monthlyVsLastYear   = monthlyVsLastYear;   } catch (_) {}\n' +
    'try { globalThis.__monthlyPercentChange = monthlyPercentChange; } catch (_) {}\n' +
    'try { globalThis.__monthlyAverage      = monthlyAverage;      } catch (_) {}\n';
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
    check('C3 upgrade: schema version copied then migrated to current (v4 — expenses rework)', Preferences._store.get('bigals_schema_version') === '4');
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
      bigals_schema_version: '4',   // current → genuine no-op launch (prune fires)
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
      Preferences._store.get('bigals_schema_version') === '4');
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
      Preferences._store.get('bigals_schema_version') === '4');
  }
  {
    // F3 — NO-OP LAUNCH WITH NO BACKUP (native): no-op, no error.
    const Preferences = makePreferences({
      bigals_productions: '[]',
      bigals_schema_version: '4',   // current → no-op launch, no backup written
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
      bigals_schema_version: '4',   // current → no-op launch (prune fires)
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
        tx.objectStore('kv').put('4', 'bigals_schema_version');
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
      storage.get('bigals_schema_version') === '4',
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

  // ===== M. SAVED CLIENTS STAGE-1 ROUND-TRIP =====
  // userPrefs.clients is a new top-level field in DEFAULT_USER_PREFS
  // (additive, no schema bump, no migration). Same merge-over-defaults
  // guard as kitInventory: a backup WITH clients restores them verbatim
  // and a pre-Stage-1 backup (no clients key) imports cleanly to [].
  {
    // M1 — DEFAULT_USER_PREFS exposes the new key.
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const defaults = sb.__DEFAULT_USER_PREFS;
    check('M1 prefs: DEFAULT_USER_PREFS has a clients key',
      defaults && Array.isArray(defaults.clients),
      `clients=${defaults && defaults.clients}`);
    check('M1 prefs: default clients is empty',
      defaults && Array.isArray(defaults.clients) && defaults.clients.length === 0,
      `length=${defaults && defaults.clients && defaults.clients.length}`);

    // M2 — Backup made WITH clients restores them verbatim.
    const payload = JSON.stringify({
      version: 1,
      schemaVersion: 3,
      productions: [],
      userPrefs: {
        displayName: 'Test User',
        defaultBDR: 444,
        clients: [
          { id: 'cli-a', name: 'Acme Films',  address: '5 Margaret Street\nLondon W1W 8RG', email: 'accounts@acme.example' },
          { id: 'cli-b', name: 'Northsouth Productions', address: '', email: 'pay@northsouth.example' },
        ],
      },
    });
    const r1 = sb.__importBackup(payload);
    check('M2 import-with-clients: importBackup ok',
      r1 && r1.ok === true,
      `result=${JSON.stringify(r1)}`);
    const stored = JSON.parse(sb.__storage.get('bigals_user_prefs') || 'null');
    check('M2 import-with-clients: clients length restored',
      stored && Array.isArray(stored.clients) && stored.clients.length === 2,
      `length=${stored && stored.clients && stored.clients.length}`);
    check('M2 import-with-clients: clients[0] fields verbatim',
      stored && stored.clients && stored.clients[0] &&
        stored.clients[0].id === 'cli-a' &&
        stored.clients[0].name === 'Acme Films' &&
        stored.clients[0].address === '5 Margaret Street\nLondon W1W 8RG' &&
        stored.clients[0].email === 'accounts@acme.example',
      `client0=${JSON.stringify(stored && stored.clients && stored.clients[0])}`);
    check('M2 import-with-clients: clients[1] empty-address preserved',
      stored && stored.clients && stored.clients[1] &&
        stored.clients[1].id === 'cli-b' &&
        stored.clients[1].name === 'Northsouth Productions' &&
        stored.clients[1].address === '' &&
        stored.clients[1].email === 'pay@northsouth.example',
      `client1=${JSON.stringify(stored && stored.clients && stored.clients[1])}`);
    check('M2 import-with-clients: other userPrefs survived the merge',
      stored && stored.displayName === 'Test User' && stored.defaultBDR === 444,
      `prefs=${JSON.stringify({ name: stored && stored.displayName, bdr: stored && stored.defaultBDR })}`);
    // Sibling Stage-1 additive field also still present.
    check('M2 import-with-clients: kitInventory still defaulted (independent of clients)',
      stored && Array.isArray(stored.kitInventory) && stored.kitInventory.length === 0,
      `kitInventory=${JSON.stringify(stored && stored.kitInventory)}`);
  }
  {
    // M3 — Pre-Stage-1 backup (no clients key) imports cleanly to [].
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
        // NO clients key at all — simulates a backup made before Saved
        // Clients Stage 1. Also intentionally NO kitInventory key — both
        // additive fields should default to [] via the same guard.
      },
    });
    const r2 = sb.__importBackup(legacyPayload);
    check('M3 pre-stage-1: importBackup ok',
      r2 && r2.ok === true,
      `result=${JSON.stringify(r2)}`);
    const stored = JSON.parse(sb.__storage.get('bigals_user_prefs') || 'null');
    check('M3 pre-stage-1: clients present as empty array (merge-over-defaults)',
      stored && Array.isArray(stored.clients) && stored.clients.length === 0,
      `clients=${JSON.stringify(stored && stored.clients)}`);
    check('M3 pre-stage-1: legacy fields preserved',
      stored && stored.displayName === 'Legacy User' && stored.defaultBDR === 500);
    check('M3 pre-stage-1: kitInventory also defaults to empty (same guard)',
      stored && Array.isArray(stored.kitInventory) && stored.kitInventory.length === 0,
      `kitInventory=${JSON.stringify(stored && stored.kitInventory)}`);
  }

  // ===== EP. EXPENSE PRESETS — additive prefs store (no schema bump) =====
  // userPrefs.expensePresets is a new top-level DEFAULT_USER_PREFS field, additive
  // via merge-over-defaults (same guard as kitInventory / clients). Unlike those,
  // the default is NON-EMPTY — it ships 4 built-ins (Per Diem £35, Parking £0,
  // Congestion Charge £18, Food £0) with FIXED ids + locked names. A backup WITH
  // presets restores them verbatim; a pre-rework backup (no key) imports cleanly to
  // the built-in defaults WITHOUT wiping other prefs.
  {
    // EP1 — DEFAULT_USER_PREFS exposes the key with the 4 built-ins.
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const eps = sb.__DEFAULT_USER_PREFS && sb.__DEFAULT_USER_PREFS.expensePresets;
    check('EP1 prefs: DEFAULT_USER_PREFS has an expensePresets array',
      Array.isArray(eps), `expensePresets=${eps}`);
    check('EP1 prefs: ships exactly 4 built-ins (all isBuiltIn, all defaultOn:false)',
      Array.isArray(eps) && eps.length === 4 && eps.every(p => p.isBuiltIn === true && p.defaultOn === false),
      `len=${eps && eps.length}`);
    check('EP1 prefs: built-ins have fixed ids + locked names + the seeded amounts',
      Array.isArray(eps) &&
      eps[0].id === 'builtin-perdiem'    && eps[0].name === 'Per Diem'          && eps[0].defaultAmount === 35 &&
      eps[1].id === 'builtin-parking'    && eps[1].name === 'Parking'           && eps[1].defaultAmount === 0  &&
      eps[2].id === 'builtin-congestion' && eps[2].name === 'Congestion Charge' && eps[2].defaultAmount === 18 &&
      eps[3].id === 'builtin-food'       && eps[3].name === 'Food'              && eps[3].defaultAmount === 0,
      `eps=${JSON.stringify(eps)}`);
  }
  {
    // EP2 — Backup WITH presets (edited built-in amount + a custom) restores
    // verbatim AND does not wipe other prefs.
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const payload = JSON.stringify({
      version: 1, schemaVersion: 3, productions: [],
      userPrefs: {
        displayName: 'Test User', defaultBDR: 444,
        expensePresets: [
          { id: 'builtin-perdiem', name: 'Per Diem', defaultAmount: 50, defaultOn: true, isBuiltIn: true },
          { id: 'custom-x', name: 'Tolls', defaultAmount: 9.5, defaultOn: false, isBuiltIn: false },
        ],
      },
    });
    const r = sb.__importBackup(payload);
    check('EP2 import-with-presets: importBackup ok', r && r.ok === true, `result=${JSON.stringify(r)}`);
    const stored = JSON.parse(sb.__storage.get('bigals_user_prefs') || 'null');
    check('EP2 import-with-presets: array restored verbatim (edited built-in amount + custom)',
      stored && Array.isArray(stored.expensePresets) && stored.expensePresets.length === 2 &&
      stored.expensePresets[0].id === 'builtin-perdiem' && stored.expensePresets[0].defaultAmount === 50 && stored.expensePresets[0].defaultOn === true &&
      stored.expensePresets[1].id === 'custom-x' && stored.expensePresets[1].name === 'Tolls' && stored.expensePresets[1].defaultAmount === 9.5,
      `eps=${JSON.stringify(stored && stored.expensePresets)}`);
    check('EP2 import-with-presets: NO prefs wipe — other userPrefs survived the merge',
      stored && stored.displayName === 'Test User' && stored.defaultBDR === 444);
  }
  {
    // EP3 — Pre-rework backup (no expensePresets key) imports to the built-in
    // defaults via merge-over-defaults, without wiping legacy prefs.
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const legacy = JSON.stringify({
      version: 1, schemaVersion: 3, productions: [],
      userPrefs: { displayName: 'Legacy User', defaultBDR: 500 },
    });
    const r = sb.__importBackup(legacy);
    check('EP3 pre-rework: importBackup ok', r && r.ok === true, `result=${JSON.stringify(r)}`);
    const stored = JSON.parse(sb.__storage.get('bigals_user_prefs') || 'null');
    check('EP3 pre-rework: expensePresets defaults to the 4 built-ins (merge-over-defaults)',
      stored && Array.isArray(stored.expensePresets) && stored.expensePresets.length === 4 &&
      stored.expensePresets[0].id === 'builtin-perdiem',
      `eps=${JSON.stringify(stored && stored.expensePresets)}`);
    check('EP3 pre-rework: legacy fields preserved (no wipe)',
      stored && stored.displayName === 'Legacy User' && stored.defaultBDR === 500);
  }

  // ===== EX. EXPENSES REWORK — day-model migration invariance (lossless) =====
  // The day-model migration must be value-preserving: calcForDisplay byte-identical
  // pre/post migrate. Per-diem + ordinary expenses are SELF-COMPARING (augmentCalc
  // read-compat makes old-shape and migrated-shape render identically — no golden);
  // the cascade case asserts MIGRATIONS[4]'s materialisation reproduces the (removed)
  // resolveDay cascade total. Plus: perDiemAmount→instance, old→new field mapping,
  // idempotency (presetId-key discriminator). The build-vs-source 87-scenario audit
  // (L07/L08/L09) independently confirms source==built for the new code.
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const calcForDisplay = sb.__calcForDisplay;
    const migrateDayExpenses = sb.__migrateDayExpenses;
    const migrateExpenseEntry = sb.__migrateExpenseEntry;
    check('EX0 helpers exposed in sandbox',
      typeof calcForDisplay === 'function' && typeof migrateDayExpenses === 'function' && typeof migrateExpenseEntry === 'function');

    const crew = { id: 'c1', role: 'Spark', bdr: 444, otCoef: 1.5, noOT: false, pmpa: false };
    const prod = (days, dayDefaults = {}) => ({ id: 'p1', crew: [crew], iAmCrewId: 'c1', dayDefaults, days });
    const baseDay = { id: 'd1', crewId: 'c1', date: '2026-06-15', dayType: 'Shoot', callTime: '08:00', wrapTime: '19:00', lunchStartTime: '13:00', lunchDurationMins: 60 };
    const expLines = (r) => r.lines.filter(l => /per diem/i.test(l.label) || /^Expense:/.test(l.label)).map(l => `${l.label}|${l.detail}|${l.amount}`);
    const cfd = (day) => calcForDisplay(prod([day]), day, crew, null);
    const sameCalc = (a, b) => { const ra = cfd(a), rb = cfd(b); return Math.abs(ra.total - rb.total) < 1e-9 && JSON.stringify(expLines(ra)) === JSON.stringify(expLines(rb)); };

    // EX1 — old expense entry: calcForDisplay(old) ≡ calcForDisplay(migrate(old)).
    {
      const old = { ...baseDay, expenses: [{ id: 'e1', amount: 12, category: 'Parking', description: 'NCP' }] };
      const mig = migrateDayExpenses(old);
      check('EX1 old-expense: migrate is invariant under calcForDisplay (byte-identical lines + total)',
        sameCalc(old, mig), `old=${JSON.stringify(expLines(cfd(old)))} mig=${JSON.stringify(expLines(cfd(mig)))}`);
      check('EX1 old→new field mapping: category→name, description→detail, presetId:null, amount kept',
        mig.expenses[0].name === 'Parking' && mig.expenses[0].detail === 'NCP' && mig.expenses[0].presetId === null && mig.expenses[0].amount === 12);
    }
    // EX2 — perDiemAmount scalar → 'builtin-perdiem' instance; calc invariant.
    {
      const old = { ...baseDay, perDiemAmount: 30, expenses: [] };
      const mig = migrateDayExpenses(old);
      check('EX2 per-diem scalar→instance: calcForDisplay invariant', sameCalc(old, mig));
      check('EX2 per-diem conversion: one builtin-perdiem instance amount 30, scalar zeroed',
        mig.expenses.length === 1 && mig.expenses[0].presetId === 'builtin-perdiem' && mig.expenses[0].name === 'Per Diem' && mig.expenses[0].amount === 30 && mig.perDiemAmount === 0);
    }
    // EX3 — mixed (per-diem scalar + old expense): per-diem prepended (emitted first).
    {
      const old = { ...baseDay, perDiemAmount: 30, expenses: [{ id: 'e1', amount: 12, category: 'Parking', description: 'NCP' }] };
      const mig = migrateDayExpenses(old);
      const lines = expLines(cfd(mig));
      check('EX3 mixed: calcForDisplay invariant + per-diem instance prepended (emitted first)',
        sameCalc(old, mig) && lines[0].startsWith('Per Diem') && lines[1].startsWith('Expense: Parking'),
        `lines=${JSON.stringify(lines)}`);
    }
    // EX4 — idempotency via the presetId-key discriminator.
    {
      const old = { ...baseDay, perDiemAmount: 30, expenses: [{ id: 'e1', amount: 12, category: 'Parking', description: 'NCP' }] };
      const once = migrateDayExpenses(old);
      const twice = migrateDayExpenses(once);
      check('EX4 idempotent: re-migrate is a no-op (calc identical, same entry count, scalar stays 0)',
        sameCalc(once, twice) && twice.expenses.length === once.expenses.length && twice.perDiemAmount === 0);
      check('EX4 idempotent: migrateExpenseEntry no-ops a new-shape entry (presetId key present → same ref)',
        migrateExpenseEntry(once.expenses[0]) === once.expenses[0]);
    }
    // EX5 — CASCADE total-preservation: the MIGRATIONS[4] materialise step (replicated
    // inline, since the resolveDay cascade is now removed) reproduces the removed
    // cascade's total + lines, and an un-materialised empty day no longer inherits.
    {
      const def = { expenses: [{ category: 'Parking', description: 'NCP', amount: 12 }], perDiemAmount: 25 };
      const emptyDay = { ...baseDay, expenses: [], perDiemAmount: 0 };
      const base = cfd(emptyDay).total;   // post-removal: no inheritance
      check('EX5 cascade REMOVED: an empty day no longer inherits at calc time (no expense lines)',
        expLines(cfd(emptyDay)).length === 0);
      let day = emptyDay;
      if ((day.expenses?.length ?? 0) === 0 && (def.expenses?.length ?? 0) > 0) day = { ...day, expenses: def.expenses };
      if ((Number(day.perDiemAmount) || 0) === 0 && Number(def.perDiemAmount) > 0) day = { ...day, perDiemAmount: def.perDiemAmount };
      const mig = migrateDayExpenses(day);
      const migTotal = cfd(mig).total;
      check('EX5 cascade materialise: total = base + inherited (12 + 25) — pre-cascade total preserved',
        Math.abs(migTotal - (base + 12 + 25)) < 1e-9, `base=${base} migTotal=${migTotal} expected=${base + 37}`);
      const lines = expLines(cfd(mig));
      check('EX5 cascade materialise: inherited per-diem (25, first) + Parking expense (12, mapped) land on the day',
        lines[0] === 'Per Diem||25' && lines.some(l => l === 'Expense: Parking|NCP|12'),
        `lines=${JSON.stringify(lines)}`);
    }
  }

  // ===== N. SAVED CLIENTS STAGE-2 AUTO-SAVE ON SEND =====
  // Exercises the pure derivation `deriveClientFromSentInvoice` against
  // the user's Stage-2 spec (a)–(e). Each assertion simulates the
  // send-flow state transitions with plain JS to lock in the dedupe /
  // no-mutation / idempotency / frozen-record invariants.
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const derive = sb.__deriveClientFromSentInvoice;
    if (typeof derive !== 'function') {
      check('N0: deriveClientFromSentInvoice exposed in sandbox', false,
        `typeof=${typeof derive}`);
    } else {
      check('N0: deriveClientFromSentInvoice exposed in sandbox', true);

      // (a) Sending with a new client name creates exactly one client
      //     {name, address, email} and sets production.clientId.
      {
        let clients = [];
        let productionClientId = null;
        const frozen = { name: 'Acme Films', address: '5 Margaret St\nLondon W1W 8RG', email: 'accounts@acme.example' };
        const r = derive(frozen, clients);
        clients = r.nextClients;
        if (r.clientId !== null) productionClientId = r.clientId;
        check('Na1: new client appended (clients length 0 → 1)',
          clients.length === 1, `length=${clients.length}`);
        check('Na2: stored client name preserves user capitalisation, trimmed',
          clients[0] && clients[0].name === 'Acme Films',
          `name=${clients[0] && clients[0].name}`);
        check('Na3: stored client address verbatim',
          clients[0] && clients[0].address === '5 Margaret St\nLondon W1W 8RG');
        check('Na4: stored client email verbatim',
          clients[0] && clients[0].email === 'accounts@acme.example');
        check('Na5: production.clientId set to the new client id',
          productionClientId === clients[0].id,
          `clientId=${productionClientId}, newId=${clients[0] && clients[0].id}`);
        check('Na6: returned clientId === new client id',
          r.clientId === clients[0].id);
      }

      // (b) Sending with a name that matches an existing client by trim +
      //     case-insensitive comparison LINKS to it; creates NO duplicate;
      //     does NOT mutate the existing client's address / email.
      {
        const original = { id: 'cli-existing', name: 'Acme Films',
          address: '5 Margaret St\nLondon W1W 8RG', email: 'accounts@acme.example' };
        let clients = [original];
        let productionClientId = null;
        // Different case + leading/trailing whitespace + DIFFERENT address/email
        // (should be ignored — no silent overwrite).
        const frozen = { name: '  ACME films  ',
          address: '99 New Street\nOther Town', email: 'pay@elsewhere.example' };
        const r = derive(frozen, clients);
        clients = r.nextClients;
        if (r.clientId !== null) productionClientId = r.clientId;
        check('Nb1: no duplicate created (length stays 1)',
          clients.length === 1, `length=${clients.length}`);
        check('Nb2: links to the existing client id',
          productionClientId === 'cli-existing',
          `clientId=${productionClientId}`);
        check('Nb3: existing client name unchanged',
          clients[0].name === 'Acme Films');
        check('Nb4: existing client address UNCHANGED (no silent overwrite)',
          clients[0].address === '5 Margaret St\nLondon W1W 8RG',
          `address=${clients[0].address}`);
        check('Nb5: existing client email UNCHANGED (no silent overwrite)',
          clients[0].email === 'accounts@acme.example',
          `email=${clients[0].email}`);
        check('Nb6: nextClients is the same array reference (no rewrite)',
          r.nextClients === clients);
      }

      // (c) Empty name → no client created, no clientId set.
      {
        for (const empty of [
          { name: '',    address: 'x', email: 'y' },
          { name: '   ', address: 'x', email: 'y' },
          { name: null,  address: 'x', email: 'y' },
          { name: undefined, address: 'x', email: 'y' },
        ]) {
          let clients = [];
          const r = derive(empty, clients);
          check(`Nc[name=${JSON.stringify(empty.name)}]: clientId is null`,
            r.clientId === null,
            `clientId=${r.clientId}`);
          check(`Nc[name=${JSON.stringify(empty.name)}]: clients unchanged (length 0)`,
            r.nextClients.length === 0,
            `length=${r.nextClients.length}`);
        }
      }

      // (d) Idempotency — a second send for the SAME production (same
      //     toName/address/email post-freeze) must re-link to the same
      //     client and never duplicate. Also covers "another invoice on
      //     the same production" which has identical frozen client fields.
      {
        let clients = [];
        let productionClientId = null;
        // First send.
        const frozen1 = { name: 'Acme Films', address: '5 Margaret St', email: 'a@acme.example' };
        const r1 = derive(frozen1, clients);
        clients = r1.nextClients;
        productionClientId = r1.clientId;
        const firstClientId = productionClientId;
        // Second send (re-send same invoice, OR send another invoice on
        // the same production — both arrive with identical frozen fields).
        const r2 = derive(frozen1, clients);
        clients = r2.nextClients;
        productionClientId = r2.clientId;
        check('Nd1: second send keeps clients length at 1 (no duplicate)',
          clients.length === 1, `length=${clients.length}`);
        check('Nd2: second send re-links to the same client id',
          productionClientId === firstClientId,
          `first=${firstClientId}, second=${productionClientId}`);
        check('Nd3: r2.nextClients is the same array reference as input (no rewrite)',
          r2.nextClients === r1.nextClients);
        // And once more for good measure — third call still stable.
        const r3 = derive(frozen1, clients);
        check('Nd4: third call also re-links to the same id, still no duplicate',
          r3.clientId === firstClientId && r3.nextClients.length === 1);
      }

      // (e) Sent invoice's frozen fields are unchanged by the auto-save.
      //     The derivation reads from the frozen invoice fields; it must
      //     not mutate them. Simulate by snapshotting the input and
      //     comparing after.
      {
        const sentInvoice = {
          id: 'inv-1', status: 'sent',
          toName: 'Acme Films',
          toAddress: '5 Margaret St',
          toEmail: 'accounts@acme.example',
        };
        const before = JSON.stringify(sentInvoice);
        const clients = [];
        derive({ name: sentInvoice.toName, address: sentInvoice.toAddress, email: sentInvoice.toEmail }, clients);
        check('Ne1: sent invoice fields unchanged after derivation (frozen)',
          JSON.stringify(sentInvoice) === before,
          `before=${before}, after=${JSON.stringify(sentInvoice)}`);
        check('Ne2: input clients array unchanged when empty (no in-place push)',
          clients.length === 0);
        // Pre-existing clients array must not be mutated by derivation.
        const existing = [{ id: 'x', name: 'Other Co', address: 'a', email: 'e' }];
        const beforeClients = JSON.stringify(existing);
        derive({ name: 'Acme Films', address: 'b', email: 'f' }, existing);
        check('Ne3: pre-existing clients array NOT mutated in place',
          JSON.stringify(existing) === beforeClients,
          `before=${beforeClients}, after=${JSON.stringify(existing)}`);
      }
    }
  }

  // ===== O. SAVED CLIENTS STAGE-3 PICKER PURE HELPERS =====
  // The picker's UI orchestration (selection range, key handling) is
  // exercised by hand. The pure pieces — prefix matching, inline-
  // completion gating, recents — are verified here.
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const matchPrefix = sb.__matchClientsByPrefix;
    const pickCompl = sb.__pickInlineCompletion;
    const pickRecents = sb.__pickRecentClients;
    if (typeof matchPrefix !== 'function' || typeof pickCompl !== 'function' || typeof pickRecents !== 'function') {
      check('O0: Stage-3 helpers exposed in sandbox', false,
        `match=${typeof matchPrefix}, compl=${typeof pickCompl}, recents=${typeof pickRecents}`);
    } else {
      check('O0: Stage-3 helpers exposed in sandbox', true);

      const acme       = { id: 'cli-acme',  name: 'Acme Films',      address: 'a1', email: 'e1' };
      const acmeReels  = { id: 'cli-acmer', name: 'Acme Reels',      address: 'a2', email: 'e2' };
      const beatles    = { id: 'cli-beat',  name: 'Beatles Bros',    address: 'a3', email: 'e3' };
      const carlton    = { id: 'cli-car',   name: 'Carlton Studios', address: 'a4', email: 'e4' };
      const clients = [acme, acmeReels, beatles, carlton];

      // (a) Prefix matching — case-insensitive; preserves clients ordering.
      {
        const r = matchPrefix(clients, 'ac');
        check('Oa1: prefix "ac" returns 2 clients (Acme Films, Acme Reels)',
          r.length === 2 && r[0].id === 'cli-acme' && r[1].id === 'cli-acmer',
          `r=${JSON.stringify(r.map(c => c.id))}`);
        const r2 = matchPrefix(clients, 'AC');
        check('Oa2: prefix "AC" (uppercase) returns the same 2 clients',
          r2.length === 2 && r2[0].id === 'cli-acme' && r2[1].id === 'cli-acmer');
        const r3 = matchPrefix(clients, '  Ac  ');
        check('Oa3: prefix "  Ac  " (whitespace) is trimmed before match',
          r3.length === 2);
        const r4 = matchPrefix(clients, 'b');
        check('Oa4: prefix "b" returns 1 client (Beatles Bros)',
          r4.length === 1 && r4[0].id === 'cli-beat');
        const r5 = matchPrefix(clients, 'x');
        check('Oa5: prefix "x" returns no matches',
          r5.length === 0);
        const r6 = matchPrefix(clients, '');
        check('Oa6: empty prefix returns no matches (chips logic uses recents instead)',
          r6.length === 0);
        const r7 = matchPrefix(clients, '   ');
        check('Oa7: whitespace-only prefix returns no matches',
          r7.length === 0);
        const r8 = matchPrefix(null, 'ac');
        check('Oa8: null clients returns empty array (defensive)',
          Array.isArray(r8) && r8.length === 0);
        const r9 = matchPrefix(clients, null);
        check('Oa9: null typed returns empty array (defensive)',
          Array.isArray(r9) && r9.length === 0);
        const skewedClients = [...clients, { id: 'x', /* no name */ }];
        const r10 = matchPrefix(skewedClients, 'a');
        check('Oa10: name-less client entries are skipped',
          r10.every(c => c.id !== 'x'));
      }

      // (b) Inline completion gating — top match strictly longer; >= 2 chars.
      {
        // < 2 chars → null.
        check('Ob1: typed "" → no completion',
          pickCompl(clients, '') === null);
        check('Ob2: typed "a" (1 char) → no completion (gate < 2)',
          pickCompl(clients, 'a') === null);

        // 2+ chars + match strictly longer → completion.
        const c1 = pickCompl(clients, 'ac');
        check('Ob3: typed "ac" → completion to top match (Acme Films)',
          c1 && c1.client.id === 'cli-acme' && c1.tail === 'me Films',
          `c1=${JSON.stringify(c1)}`);
        const c2 = pickCompl(clients, 'AC');
        check('Ob4: typed "AC" (uppercase) → same Acme Films completion (case-insensitive)',
          c2 && c2.client.id === 'cli-acme' && c2.tail === 'me Films');
        const c3 = pickCompl(clients, 'acm');
        check('Ob5: typed "acm" (3 chars) → completion (tail "e Films")',
          c3 && c3.client.id === 'cli-acme' && c3.tail === 'e Films');

        // Top match length == typed → no completion.
        check('Ob6: typed full name → no completion (tail would be empty)',
          pickCompl(clients, 'Acme Films') === null);
        check('Ob7: typed full name in different case → no completion',
          pickCompl(clients, 'ACME FILMS') === null);

        // No prefix match → null.
        check('Ob8: typed "xyz" → no completion',
          pickCompl(clients, 'xyz') === null);

        // Empty clients → null.
        check('Ob9: empty clients → no completion',
          pickCompl([], 'ac') === null);
      }

      // (c) Recents — most-recently-added first (end of array reversed),
      //     capped at limit (default 3).
      {
        const r1 = pickRecents(clients);
        check('Oc1: recents default limit = 3',
          r1.length === 3);
        check('Oc2: recents are end-of-array first (Carlton, Beatles, Acme Reels)',
          r1[0].id === 'cli-car' && r1[1].id === 'cli-beat' && r1[2].id === 'cli-acmer',
          `r=${JSON.stringify(r1.map(c => c.id))}`);
        const r2 = pickRecents(clients, 2);
        check('Oc3: recents respects custom limit',
          r2.length === 2 && r2[0].id === 'cli-car' && r2[1].id === 'cli-beat');
        const r3 = pickRecents([acme]);
        check('Oc4: ≤3 clients total → returns all of them',
          r3.length === 1 && r3[0].id === 'cli-acme');
        const r4 = pickRecents([]);
        check('Oc5: empty clients → empty recents',
          Array.isArray(r4) && r4.length === 0);
        const r5 = pickRecents(null);
        check('Oc6: null clients → empty recents (defensive)',
          Array.isArray(r5) && r5.length === 0);
        const r6 = pickRecents([acme, null, beatles, undefined, carlton]);
        check('Oc7: null/undefined entries are skipped',
          r6.length === 3 && r6.every(c => c && c.id),
          `r=${JSON.stringify(r6.map(c => c && c.id))}`);
      }

      // (d) Accept → field-write mapping — verify the (client → field)
      //     contract is intact. The picker's caller does the writes; here
      //     we simulate the mapping for prodCo (Basics) and for the invoice
      //     editor's editClientField writes.
      {
        const c = { id: 'cli-test', name: 'Test Co', address: 'Address 1', email: 'pay@test.example' };

        // (d-Basics) accept fills prodCo + toAddress + invoicingEmail + clientId.
        let production = { id: 'p1', prodCo: '', toAddress: '', invoicingEmail: '' };
        const basicsAccept = (cl) => {
          production = {
            ...production,
            prodCo: cl.name,
            toAddress: cl.address || '',
            invoicingEmail: cl.email || '',
            clientId: cl.id,
          };
        };
        basicsAccept(c);
        check('Od1 (Basics): name → prodCo',
          production.prodCo === 'Test Co');
        check('Od2 (Basics): address → toAddress',
          production.toAddress === 'Address 1');
        check('Od3 (Basics): email → invoicingEmail',
          production.invoicingEmail === 'pay@test.example');
        check('Od4 (Basics): clientId set to client.id',
          production.clientId === 'cli-test');

        // (d-Invoice draft) accept routes through editClientField which
        // also mirrors to production via the INVOICE_TO_PRODUCTION_FIELD
        // map. clientId is set on the production directly. We simulate
        // both sides here.
        let invoice2 = { id: 'inv1', status: 'draft', toName: '', toAddress: '', toEmail: '' };
        let production2 = { id: 'p1', prodCo: '', toAddress: '', invoicingEmail: '', clientId: undefined };
        const INVOICE_TO_PRODUCTION_FIELD = { toName: 'prodCo', toAddress: 'toAddress', toEmail: 'invoicingEmail' };
        const editClientField = (k, v) => {
          invoice2 = { ...invoice2, [k]: v };
          if (invoice2.status === 'draft' && INVOICE_TO_PRODUCTION_FIELD[k]) {
            production2 = { ...production2, [INVOICE_TO_PRODUCTION_FIELD[k]]: v };
          }
        };
        const invoiceAccept = (cl) => {
          editClientField('toName',    cl.name);
          editClientField('toAddress', cl.address || '');
          editClientField('toEmail',   cl.email   || '');
          if (invoice2.status === 'draft') {
            production2 = { ...production2, clientId: cl.id };
          }
        };
        invoiceAccept(c);
        check('Od5 (Invoice): name → invoice.toName',
          invoice2.toName === 'Test Co');
        check('Od6 (Invoice): address → invoice.toAddress',
          invoice2.toAddress === 'Address 1');
        check('Od7 (Invoice): email → invoice.toEmail',
          invoice2.toEmail === 'pay@test.example');
        check('Od8 (Invoice): draft mirror → production.prodCo',
          production2.prodCo === 'Test Co');
        check('Od9 (Invoice): draft mirror → production.toAddress',
          production2.toAddress === 'Address 1');
        check('Od10 (Invoice): draft mirror → production.invoicingEmail',
          production2.invoicingEmail === 'pay@test.example');
        check('Od11 (Invoice): production.clientId set to client.id',
          production2.clientId === 'cli-test');

        // Sent invoice: editClientField doesn't mirror; clientId is also
        // not touched (the picker is `inactive` in that case so accept
        // never fires — verified here at the simulation layer).
        let invoiceSent = { id: 'inv2', status: 'sent', toName: 'OLD', toAddress: 'X', toEmail: 'old@x.x' };
        let productionSent = { id: 'p2', prodCo: 'OLD', toAddress: 'X', invoicingEmail: 'old@x.x', clientId: 'OLD-ID' };
        const beforeSentInv = JSON.stringify(invoiceSent);
        const beforeSentProd = JSON.stringify(productionSent);
        // Picker is inactive on sent invoices → accept never fires.
        check('Od12 (Inactive): sent invoice fields unchanged when picker is inactive',
          JSON.stringify(invoiceSent) === beforeSentInv);
        check('Od13 (Inactive): production unchanged when picker is inactive on sent',
          JSON.stringify(productionSent) === beforeSentProd);
      }
    }
  }

  // ===== P. SAVED CLIENTS STAGE-4 NUDGE PURE HELPERS =====
  // The nudge's UI (input blur + dismiss flag) is wired by the inline
  // hook useClientUpdateNudge. The pure pieces — divergence detection
  // (`detectClientUpdate`) and the selective patch (`applyClientUpdate`) —
  // are verified here against the Stage-4 spec.
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const detect = sb.__detectClientUpdate;
    const apply  = sb.__applyClientUpdate;
    if (typeof detect !== 'function' || typeof apply !== 'function') {
      check('P0: Stage-4 helpers exposed in sandbox', false,
        `detect=${typeof detect}, apply=${typeof apply}`);
    } else {
      check('P0: Stage-4 helpers exposed in sandbox', true);

      const saved = {
        id: 'cli-acme',
        name: 'Acme Films',
        address: '5 Margaret Street\nLondon W1W 8RG',
        email: 'accounts@acme.example',
      };
      const baseProd = (over = {}) => ({
        id: 'p1',
        prodCo: 'Acme Films',
        toAddress: '5 Margaret Street\nLondon W1W 8RG',
        invoicingEmail: 'accounts@acme.example',
        clientId: 'cli-acme',
        ...over,
      });

      // (a) Divergence detection — address only, email only, both, neither.
      {
        // Address diverged (email matches) → { address, email: null }.
        const r1 = detect(
          baseProd({ toAddress: '99 New Street\nLondon WC1 1AA' }),
          saved
        );
        check('Pa1: address diverged → returns {clientId, address, email:null}',
          r1 && r1.clientId === 'cli-acme' && r1.address === '99 New Street\nLondon WC1 1AA' && r1.email === null,
          `r=${JSON.stringify(r1)}`);

        // Email diverged (address matches) → { address: null, email }.
        const r2 = detect(
          baseProd({ invoicingEmail: 'pay@acme.example' }),
          saved
        );
        check('Pa2: email diverged → returns {clientId, address:null, email}',
          r2 && r2.clientId === 'cli-acme' && r2.address === null && r2.email === 'pay@acme.example',
          `r=${JSON.stringify(r2)}`);

        // Both diverged → both populated.
        const r3 = detect(
          baseProd({ toAddress: 'NEW', invoicingEmail: 'pay@acme.example' }),
          saved
        );
        check('Pa3: both diverged → returns {clientId, address, email}',
          r3 && r3.clientId === 'cli-acme' && r3.address === 'NEW' && r3.email === 'pay@acme.example',
          `r=${JSON.stringify(r3)}`);

        // Neither diverged → null.
        const r4 = detect(baseProd(), saved);
        check('Pa4: neither diverged → null (no nudge)',
          r4 === null, `r=${JSON.stringify(r4)}`);

        // Trim normalization — trailing/leading whitespace counts as same.
        const r5 = detect(
          baseProd({ toAddress: '  ' + saved.address + '  ', invoicingEmail: '  ' + saved.email + '  ' }),
          saved
        );
        check('Pa5: whitespace-only differences are trimmed → no nudge',
          r5 === null, `r=${JSON.stringify(r5)}`);
      }

      // (b) Name change SUPPRESSES the nudge entirely (Stage 2 self-heals).
      {
        const r1 = detect(
          baseProd({ prodCo: 'Acme Films Holdings', toAddress: 'NEW' }),
          saved
        );
        check('Pb1: production prodCo renamed → null (suppressed)',
          r1 === null, `r=${JSON.stringify(r1)}`);

        const r2 = detect(
          baseProd({ prodCo: '', toAddress: 'NEW' }),
          saved
        );
        check('Pb2: production prodCo cleared → null (suppressed)',
          r2 === null);

        // Case + whitespace differences in the name DO match (no suppression).
        const r3 = detect(
          baseProd({ prodCo: '  ACME films  ', toAddress: 'NEW' }),
          saved
        );
        check('Pb3: prodCo trim+case-insensitive matches → nudge fires',
          r3 && r3.clientId === 'cli-acme' && r3.address === 'NEW',
          `r=${JSON.stringify(r3)}`);
      }

      // (c) Empty edits don't trigger (we never sync a cleared field to the
      //     template via the nudge — that's a deletion-shaped action).
      {
        const r1 = detect(
          baseProd({ toAddress: '' }),
          saved
        );
        check('Pc1: empty address (saved has a value) → no address divergence',
          r1 === null, `r=${JSON.stringify(r1)}`);

        const r2 = detect(
          baseProd({ invoicingEmail: '' }),
          saved
        );
        check('Pc2: empty email (saved has a value) → no email divergence',
          r2 === null);

        const r3 = detect(
          baseProd({ toAddress: '   ', invoicingEmail: '   ' }),
          saved
        );
        check('Pc3: whitespace-only address + email → null (treated as empty)',
          r3 === null);

        // BUT: empty address + diverged email → email-only nudge.
        const r4 = detect(
          baseProd({ toAddress: '', invoicingEmail: 'pay@elsewhere.example' }),
          saved
        );
        check('Pc4: empty address + diverged email → email-only nudge',
          r4 && r4.address === null && r4.email === 'pay@elsewhere.example',
          `r=${JSON.stringify(r4)}`);
      }

      // (d) Unlinked productions (no clientId) → null.
      {
        const r1 = detect(
          baseProd({ clientId: null,      toAddress: 'NEW' }),
          saved
        );
        check('Pd1: production with clientId=null → null',
          r1 === null);
        const r2 = detect(
          baseProd({ clientId: undefined, toAddress: 'NEW' }),
          saved
        );
        check('Pd2: production with clientId=undefined → null',
          r2 === null);
        const r3 = detect(
          baseProd({ clientId: 'cli-OTHER', toAddress: 'NEW' }),
          { ...saved, id: 'cli-OTHER' }
        );
        check('Pd3: production with mismatched clientId points to DIFFERENT saved client → name still matches → fires for THAT client',
          r3 && r3.clientId === 'cli-OTHER',
          `r=${JSON.stringify(r3)}`);
        // No savedClient → null (defensive).
        check('Pd4: null savedClient → null',
          detect(baseProd(), null) === null);
        check('Pd5: null production → null',
          detect(null, saved) === null);
      }

      // (e) Locked / sent invoices: at the simulation layer, the UI gate is
      //     "readOnly inputs never blur-fire" — the nudge stays inert. We
      //     model the gate here by simulating that armed=false → pending=null.
      {
        // The hook's armed-flag gate: if armed is false, pending stays null
        // regardless of divergence. We verify the gate by inspection — the
        // hook computes `pending = armed && !dismissed ? detect(...) : null`.
        // For the LOCKED case (sent invoice), readOnly inputs don't trigger
        // onBlur, so armed never becomes true, so pending is always null.
        // This is a structural property: the helper itself doesn't know
        // about lock state; the gate is upstream. Cover it here with a
        // mini-simulation of the gate.
        const computePending = ({ armed, dismissed, production, saved }) =>
          armed && !dismissed ? detect(production, saved) : null;
        const lockedProd = baseProd({ toAddress: 'NEW' });
        check('Pe1: locked surface (armed=false) → pending=null',
          computePending({ armed: false, dismissed: false, production: lockedProd, saved }) === null);
        check('Pe2: dismissed (armed=true, dismissed=true) → pending=null',
          computePending({ armed: true, dismissed: true, production: lockedProd, saved }) === null);
        check('Pe3: editable + armed → pending populated when diverged',
          computePending({ armed: true, dismissed: false, production: lockedProd, saved }) !== null);
      }

      // (f) applyClientUpdate produces the right nextClients and leaves
      //     OTHER clients untouched (by reference).
      {
        const other1 = { id: 'cli-other-1', name: 'Other One',   address: 'a1', email: 'e1' };
        const other2 = { id: 'cli-other-2', name: 'Other Two',   address: 'a2', email: 'e2' };
        const target = { id: 'cli-acme',    name: 'Acme Films',  address: 'OLD ADDR', email: 'OLD EMAIL' };
        const clients = [other1, target, other2];

        // Address-only update.
        {
          const r = apply(clients, { clientId: 'cli-acme', address: 'NEW ADDR', email: null });
          check('Pf1: address-only update → target.address overwritten',
            r[1].id === 'cli-acme' && r[1].address === 'NEW ADDR');
          check('Pf2: address-only update → target.email preserved',
            r[1].email === 'OLD EMAIL');
          check('Pf3: address-only update → other clients identical by reference',
            r[0] === other1 && r[2] === other2);
          check('Pf4: result is a NEW array (not the input)',
            r !== clients);
          // Input array not mutated in place.
          check('Pf5: input clients array NOT mutated (target.address still OLD)',
            clients[1].address === 'OLD ADDR');
        }

        // Email-only update.
        {
          const r = apply(clients, { clientId: 'cli-acme', address: null, email: 'NEW EMAIL' });
          check('Pf6: email-only update → target.email overwritten',
            r[1].email === 'NEW EMAIL');
          check('Pf7: email-only update → target.address preserved',
            r[1].address === 'OLD ADDR');
        }

        // Both update.
        {
          const r = apply(clients, { clientId: 'cli-acme', address: 'A', email: 'E' });
          check('Pf8: both update → both fields overwritten',
            r[1].address === 'A' && r[1].email === 'E');
        }

        // No matching id → returned by reference (no rewrite).
        {
          const r = apply(clients, { clientId: 'cli-MISSING', address: 'A', email: 'E' });
          check('Pf9: no matching id → returns the SAME array reference (no rewrite)',
            r === clients);
        }

        // Null update → returned unchanged.
        {
          const r = apply(clients, null);
          check('Pf10: null update → returns the SAME array (no-op)',
            r === clients);
        }

        // Update with no fields (both null) → no-op patch.
        {
          const r = apply(clients, { clientId: 'cli-acme', address: null, email: null });
          // The map still runs; the patched client is a new object equal to
          // target. Not the same reference, but address/email preserved.
          check('Pf11: empty fields update → preserves both address and email values',
            r[1].address === 'OLD ADDR' && r[1].email === 'OLD EMAIL');
        }

        // Empty list / null list defensive.
        check('Pf12: empty clients → empty result',
          Array.isArray(apply([], { clientId: 'x', address: 'a', email: 'e' })) &&
          apply([], { clientId: 'x', address: 'a', email: 'e' }).length === 0);
        check('Pf13: null clients → empty result (defensive)',
          Array.isArray(apply(null, { clientId: 'x', address: 'a', email: 'e' })) &&
          apply(null, { clientId: 'x', address: 'a', email: 'e' }).length === 0);
      }

      // (g) Round-trip: detect → apply → detect again returns null.
      {
        const target = { id: 'cli-acme', name: 'Acme Films', address: 'OLD', email: 'old@acme.example' };
        const list = [target];
        const prod = {
          prodCo: 'Acme Films',
          toAddress: 'NEW',
          invoicingEmail: 'new@acme.example',
          clientId: 'cli-acme',
        };
        const pending = detect(prod, target);
        check('Pg1: divergence detected initially',
          pending !== null && pending.address === 'NEW' && pending.email === 'new@acme.example');
        const nextList = apply(list, pending);
        const updatedSaved = nextList[0];
        check('Pg2: saved client now has the production\'s address/email',
          updatedSaved.address === 'NEW' && updatedSaved.email === 'new@acme.example');
        const pending2 = detect(prod, updatedSaved);
        check('Pg3: detect against updated client → null (round-trip resolved)',
          pending2 === null);
      }
    }
  }

  // ===== Q. TIMEINPUT IS EXACT-PASS-THROUGH (no 5-minute snap) =====
  // The blur-snap could quietly erase owed overtime (e.g. a wrap two
  // minutes into an OT increment rounded back to the boundary). The
  // TimeInput component now passes the user's entered/blurred value
  // straight through; this suite is the regression guard.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');
    // The whole project (source + audit modules) must contain zero
    // references to the old rounder. If a future change re-introduces
    // it under any name, the test will need an explicit decision.
    const roundHits = (html.match(/roundTo5/g) || []).length;
    check('Q1 source: roundTo5 helper is gone from index.html',
      roundHits === 0,
      `roundHits=${roundHits}`);

    // Locate the TimeInput definition and inspect it surgically.
    // Accepts either an arrow-function-assigned `const TimeInput =`
    // or a named declaration `function TimeInput(...)` — the wheel
    // implementation uses the latter so it can hold internal hooks.
    const tiArrowAt = html.indexOf('const TimeInput =');
    const tiFnAt    = html.indexOf('function TimeInput(');
    const tiStart   = tiArrowAt !== -1 ? tiArrowAt :
                      tiFnAt    !== -1 ? tiFnAt    : -1;
    check('Q2 source: TimeInput definition still present', tiStart !== -1);
    // Body slice is generously sized; the assertions below only care
    // about pattern presence/absence within TimeInput's lexical scope.
    const tiBody = (tiStart !== -1 ? html.slice(tiStart, tiStart + 8000) : '');

    // TimeInput must not declare any blur-rounding logic.
    check('Q3 TimeInput body: no roundTo5 reference',
      !/roundTo5/.test(tiBody));
    // TimeInput must not pin step="300" anymore (off-grid times would
    // otherwise render as step-invalid, and step did nothing on iOS).
    check('Q4 TimeInput body: no step="300" attribute',
      !/step="300"/.test(tiBody),
      `tiBody.includes("step=\\"300\\"")=${/step="300"/.test(tiBody)}`);
    // No handleBlur transform: there must be no `Math.round(.../5)*5`
    // — the snap-to-5-minutes pattern — anywhere in TimeInput's body.
    // (The inline wheel that lives in the touch branch uses
    // Math.round(scrollTop / itemH) to convert scroll position to a
    // column index; that's not a value snap and is allowed.)
    check('Q5 TimeInput body: no Math.round(.../5)*5 entered-value snap',
      !/Math\.round\([^)]*\/\s*5\s*\)\s*\*\s*5/.test(tiBody));

    // Behaviour check — simulate the contract directly. With the snap
    // gone, TimeInput is a thin pass-through wrapper:
    //   value in  → value rendered
    //   onChange  → fires with exactly what the input element produced
    //   onBlur    → if the caller passed one, it fires; no internal
    //               transform-onChange is generated
    // Model that contract here so a regression that re-introduces ANY
    // form of internal value mutation fails this test.
    {
      const observed = [];
      const onChange = (e) => observed.push({ kind: 'change', value: e.target.value });
      const onBlur   = (e) => observed.push({ kind: 'blur',   value: e.target.value });
      // Simulate: user types/picks 07:23 (off-grid).
      onChange({ target: { value: '07:23' } });
      // Simulate: user blurs the field WITHOUT editing further.
      // The component must NOT synthesise a second onChange with a
      // rounded value (which is what the removed handleBlur did).
      onBlur({ target: { value: '07:23' } });
      check('Q6 contract: an off-grid 07:23 entered stays 07:23',
        observed[0] && observed[0].value === '07:23');
      check('Q7 contract: blur of an off-grid 07:23 does NOT fire a second onChange with a rounded value',
        observed.filter(o => o.kind === 'change').length === 1,
        `change-count=${observed.filter(o => o.kind === 'change').length}, observed=${JSON.stringify(observed)}`);
      check('Q8 contract: caller-supplied onBlur still fires with the unchanged value',
        observed.find(o => o.kind === 'blur') && observed.find(o => o.kind === 'blur').value === '07:23');
    }

    // A second off-grid sample — the rounder used to round 07:22 → 07:20
    // (down) and 07:23 → 07:25 (up). Confirm neither happens here.
    {
      const observed = [];
      const onChange = (e) => observed.push(e.target.value);
      onChange({ target: { value: '07:22' } });
      onChange({ target: { value: '21:48' } });
      check('Q9 contract: 07:22 passes through unchanged (rounds to neither 07:20 nor 07:25)',
        observed[0] === '07:22');
      check('Q10 contract: 21:48 passes through unchanged',
        observed[1] === '21:48');
    }
  }

  // ===== R. "NOW" WRITERS STAMP EXACT TIME (no 5-minute rounding) =====
  // After removing the TimeInput blur-snap (Q-suite), the four live-
  // capture "now" writers were still applying Math.round(mins/5)*5,
  // which silently lost owed overtime on captures like 19:02. They now
  // emit the exact getHours()/getMinutes(). This suite is the
  // regression guard: zero rounders anywhere in the source, plus a
  // direct functional check of every writer's source body with a
  // mocked Date.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // R1 — source-wide: no Math.round(...)/5)*5 pattern anywhere. The
    // single regression catch-all for these writers AND any future
    // sibling that creeps in. Strict pattern: Math.round followed by a
    // / 5 (with optional whitespace) before the closing paren.
    const roundRe = /Math\.round\([^)]*\/\s*5\s*\)\s*\*\s*5/g;
    const roundHits = (html.match(roundRe) || []).length;
    check('R1 source: zero Math.round(.../5)*5 occurrences anywhere',
      roundHits === 0,
      `roundHits=${roundHits}`);

    // Extract each writer's body from source so we can compile + eval
    // it with a controlled Date. The bodies are arrow functions, so
    // wrapping them in a thunk that captures a mocked `Date` exercises
    // the exact source code.
    const sliceBetween = (src, startNeedle, endNeedle) => {
      const i = src.indexOf(startNeedle);
      if (i === -1) return null;
      const j = src.indexOf(endNeedle, i);
      if (j === -1) return null;
      return src.slice(i, j + endNeedle.length);
    };

    // computeNowHHMM (DayEntryForm) — returns the HH:MM string directly.
    const computeNowHHMM_src = sliceBetween(html,
      'const computeNowHHMM = () => {', '};');
    check('R2 source: computeNowHHMM body extracted',
      computeNowHHMM_src && computeNowHHMM_src.length > 0);

    // nowHHMM (BestBoyMobileDayView handleLunchNow / handleWrapNow).
    const nowHHMM_src = sliceBetween(html,
      'const nowHHMM = () => {', '};');
    check('R3 source: nowHHMM body extracted',
      nowHHMM_src && nowHHMM_src.length > 0);

    // For doWrap / doLunch, the writers mutate state via setDays /
    // showToast. We don't need to exercise those — we just need to
    // verify the time-string they BUILD. Pull the construction line
    // for each.
    const doWrapHasWrapStr   = /const wrapStr = `\$\{String\(now\.getHours\(\)\)\.padStart\(2, ['"]0['"]\)\}:\$\{String\(now\.getMinutes\(\)\)\.padStart\(2, ['"]0['"]\)\}`/.test(html);
    const doLunchHasLunchStr = /const lunchStr = `\$\{String\(now\.getHours\(\)\)\.padStart\(2, ['"]0['"]\)\}:\$\{String\(now\.getMinutes\(\)\)\.padStart\(2, ['"]0['"]\)\}`/.test(html);
    check('R4 source: doWrap builds wrapStr from now.getHours()/Minutes() directly (no rounding)',
      doWrapHasWrapStr);
    check('R5 source: doLunch builds lunchStr from now.getHours()/Minutes() directly (no rounding)',
      doLunchHasLunchStr);
    // Confirm wrapStr and lunchStr are not built via a rounded-mins
    // pathway: there should be no `const rounded =` declaration within
    // the WrapNowBtn / LunchNowBtn function bodies.
    const wrapNowBody  = sliceBetween(html, 'function WrapNowBtn(',  'function LunchNowBtn(') || '';
    const lunchNowBody = sliceBetween(html, 'function LunchNowBtn(', '\n    }\n\n    function ') || '';
    check('R6 WrapNowBtn body: no `const rounded =` declaration',
      !/const rounded =/.test(wrapNowBody));
    check('R7 LunchNowBtn body: no `const rounded =` declaration',
      !/const rounded =/.test(lunchNowBody));

    // Compile + eval the two `() => string` writers (computeNowHHMM,
    // nowHHMM) against a mocked Date. Each gets its own Function so
    // there's no leakage. The mocked Date returns the (h, m) we set.
    const makeMockDate = (h, m) => function MockDate() {
      this.getHours = () => h;
      this.getMinutes = () => m;
    };
    const evalReturning = (src, MockDate) => {
      // src is `const NAME = () => { ... };` — wrap to invoke the body
      // immediately. Replace the inner `new Date()` with the mock.
      const body = src.replace(/^const \w+ = \(\) => /, '').replace(/;\s*$/, '');
      // body is now `{ ... }`. Wrap in a thunk where `Date` = MockDate.
      const fn = new Function('Date', `return (() => ${body})();`);
      return fn(MockDate);
    };

    // Test vectors covering the brief: off-grid 19:02, off-grid 07:23,
    // on-grid 19:05, midnight 00:00, end-of-day 23:59, plus a few
    // padding-edge values.
    const vectors = [
      { h: 19, m:  2, expect: '19:02', label: '19:02 (off-grid, exact)' },
      { h:  7, m: 23, expect: '07:23', label: '07:23 (off-grid, hour padding)' },
      { h: 19, m:  5, expect: '19:05', label: '19:05 (already on 5-min grid)' },
      { h:  0, m:  0, expect: '00:00', label: '00:00 (midnight)' },
      { h: 23, m: 59, expect: '23:59', label: '23:59 (end of day)' },
      { h:  9, m:  0, expect: '09:00', label: '09:00 (single-digit hour padded)' },
      { h: 12, m:  7, expect: '12:07', label: '12:07 (off-grid, would have been 12:05)' },
    ];

    let n = 0;
    for (const v of vectors) {
      const Mock = makeMockDate(v.h, v.m);
      try {
        const compute = evalReturning(computeNowHHMM_src, Mock);
        check(`R8.${++n} computeNowHHMM(${v.label}) → '${v.expect}'`,
          compute === v.expect, `got=${compute}`);
      } catch (e) {
        check(`R8.${++n} computeNowHHMM(${v.label}) eval`, false, e.message);
      }
    }

    n = 0;
    for (const v of vectors) {
      const Mock = makeMockDate(v.h, v.m);
      try {
        const computed = evalReturning(nowHHMM_src, Mock);
        check(`R9.${++n} nowHHMM(${v.label}) → '${v.expect}'`,
          computed === v.expect, `got=${computed}`);
      } catch (e) {
        check(`R9.${++n} nowHHMM(${v.label}) eval`, false, e.message);
      }
    }

    // For doWrap / doLunch, exercise the wrapStr / lunchStr building line
    // directly against the same mocked Date — same formula as the
    // returning helpers, just bound to a `now` const for the surrounding
    // state writes.
    const buildHHMMFromNow = (MockDate) => {
      const fn = new Function('Date', `
        const now = new Date();
        return \`\${String(now.getHours()).padStart(2, '0')}:\${String(now.getMinutes()).padStart(2, '0')}\`;
      `);
      return fn(MockDate);
    };
    n = 0;
    for (const v of vectors) {
      const Mock = makeMockDate(v.h, v.m);
      const out = buildHHMMFromNow(Mock);
      check(`R10.${++n} doWrap/doLunch wrapStr formula(${v.label}) → '${v.expect}'`,
        out === v.expect, `got=${out}`);
    }
  }

  // (Letter "S" retired — the native 5-min time-picker plugin's
  // bottom-sheet UX tested worse than the standard input, so the
  // whole branch was reverted. The custom inline wheel that landed
  // in its place is covered by the T-suite below.)

  // ===== U. CUSTOM COMPARISON ITEM — userPrefs.customComparison =====
  // Stats/display-only addition. Hidden from the comparison pool
  // entirely until both label is non-empty AND price > 0. Field
  // absence is treated as hidden (defensive — no SCHEMA bump).
  // SCHEMA_VERSION stays 3.
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const valid    = sb.__validCustomComparison;
    const getItems = sb.__getComparisonItems;
    const getSurf  = sb.__getComparisonSurface;
    const baseItems = sb.__COMPARISON_ITEMS;
    const baseSurf  = sb.__COMPARISON_SURFACE;

    check('U0 helpers + constants exposed in sandbox',
      typeof valid === 'function' && typeof getItems === 'function' &&
      typeof getSurf === 'function' && Array.isArray(baseItems) &&
      Array.isArray(baseSurf));

    // U1 — default-shaped customComparison ({ label: "", price: 0 })
    // is hidden. No item appended to either list.
    {
      const prefs = { customComparison: { label: '', price: 0 } };
      check('U1a default-empty customComparison → validCustomComparison null',
        valid(prefs) === null);
      check('U1b default-empty → getComparisonItems unchanged from base',
        getItems(prefs).length === baseItems.length);
      check('U1c default-empty → getComparisonSurface unchanged from base',
        getSurf(prefs).length === baseSurf.length);
    }

    // U2 — Whitespace-only label is treated as empty (trim).
    {
      const prefs = { customComparison: { label: '   ', price: 5 } };
      check('U2 whitespace-only label → hidden',
        valid(prefs) === null && getItems(prefs).length === baseItems.length);
    }

    // U3 — Zero / negative / non-numeric price is treated as
    // non-positive → hidden.
    {
      const cases = [
        { label: 'X', price: 0 },
        { label: 'X', price: -1 },
        { label: 'X', price: 'free' },
        { label: 'X', price: null },
        { label: 'X', price: undefined },
        { label: 'X', price: NaN },
      ];
      let allHidden = true, badCase = null;
      for (const c of cases) {
        if (valid({ customComparison: c }) !== null) {
          allHidden = false; badCase = c; break;
        }
      }
      check('U3 non-positive price → hidden (0 / negative / non-numeric / null / undefined / NaN)',
        allHidden, `badCase=${JSON.stringify(badCase)}`);
    }

    // U4 — Field absence (no customComparison key at all) is treated
    // defensively as hidden. SCHEMA_VERSION stays 3.
    {
      check('U4a missing field → validCustomComparison null',
        valid({}) === null && valid(null) === null && valid(undefined) === null);
      check('U4b missing field → lists unchanged from base',
        getItems({}).length === baseItems.length &&
        getSurf({}).length === baseSurf.length);
    }

    // U5 — Valid customComparison (label + price > 0) appears in both
    // lists, neutral ⭐ emoji, trimmed label, numeric price.
    {
      const prefs = { customComparison: { label: '  rolls of film  ', price: 25.5 } };
      const c = valid(prefs);
      check('U5a valid → returned object has neutral ⭐ emoji',
        c && c.emoji === '⭐');
      check('U5b valid → label is trimmed verbatim',
        c && c.label === 'rolls of film');
      check('U5c valid → price coerced to number',
        c && c.price === 25.5);
      check('U5d valid → appended to getComparisonItems',
        getItems(prefs).length === baseItems.length + 1 &&
        getItems(prefs)[baseItems.length].label === 'rolls of film');
      check('U5e valid → label appended to getComparisonSurface',
        getSurf(prefs).length === baseSurf.length + 1 &&
        getSurf(prefs)[baseSurf.length] === 'rolls of film');
    }

    // U6 — Price as a numeric string ("3.50") still validates.
    {
      const c = valid({ customComparison: { label: 'coffees', price: '3.50' } });
      check('U6 numeric-string price → validated as 3.5',
        c && c.price === 3.5 && c.label === 'coffees');
    }

    // U7 — SCHEMA_VERSION still 3 (additive userPrefs field; merge-
    // over-defaults absorbs absence). Verified by checking the
    // DEFAULT_USER_PREFS exposure already used by the L / M / N suites.
    {
      const defaults = sb.__DEFAULT_USER_PREFS;
      check('U7a DEFAULT_USER_PREFS exposes customComparison',
        defaults && defaults.customComparison &&
        typeof defaults.customComparison === 'object');
      check('U7b default shape is { label: "", price: 0 } → hidden',
        defaults && defaults.customComparison &&
        defaults.customComparison.label === '' &&
        defaults.customComparison.price === 0 &&
        valid(defaults) === null);
    }

    // U8 — Backup round-trip: a backup written WITH a filled custom
    // item restores it (the field survives import); a backup written
    // WITHOUT the field falls back to the empty default via the
    // existing merge-over-defaults guard.
    {
      const payload = JSON.stringify({
        version: 1,
        schemaVersion: 3,
        productions: [],
        userPrefs: {
          displayName: 'Test User',
          customComparison: { label: 'cups of tea', price: 2.5 },
        },
      });
      const r = sb.__importBackup(payload);
      check('U8a backup-with-customComparison: import ok',
        r && r.ok === true);
      const stored = JSON.parse(sb.__storage.get('bigals_user_prefs') || 'null');
      check('U8b backup-with-customComparison: round-trips verbatim',
        stored && stored.customComparison &&
        stored.customComparison.label === 'cups of tea' &&
        stored.customComparison.price === 2.5);
      check('U8c backup-with-customComparison: validates → included',
        valid(stored) !== null &&
        getItems(stored).length === baseItems.length + 1);
    }
    {
      // Fresh sandbox to test legacy backup (no customComparison key).
      const localStorage2 = makeLocalStorage();
      const sb2 = await runApp({ capacitor: undefined, localStorage: localStorage2 });
      await settle(50);
      const legacyPayload = JSON.stringify({
        version: 1,
        schemaVersion: 3,
        productions: [],
        userPrefs: { displayName: 'Legacy User' /* no customComparison */ },
      });
      const r = sb2.__importBackup(legacyPayload);
      check('U8d pre-stage backup (no field): import ok',
        r && r.ok === true);
      const stored = JSON.parse(sb2.__storage.get('bigals_user_prefs') || 'null');
      check('U8e pre-stage backup: customComparison restored to default shape',
        stored && stored.customComparison &&
        stored.customComparison.label === '' &&
        stored.customComparison.price === 0);
      check('U8f pre-stage backup: validates as hidden',
        sb2.__validCustomComparison(stored) === null);
    }

    // U9 — importing a v3 backup migrates the stored snapshot to current (v4 —
    // the expenses day-model migration). The customComparison field itself is
    // additive (no bump); the schema is 4 because of the day-model migration.
    {
      const storedVer = sb.__storage.get('bigals_schema_version');
      check('U9 SCHEMA_VERSION is current after import (v4 — day-model migration)',
        storedVer === '4' || storedVer === 4,
        `stored=${storedVer}`);
    }
  }

  // ===== T. INLINE 5-MINUTE TIME WHEEL — touch-branch TimeInput =====
  // The wheel is a touch-only branch of TimeInput (pointer:coarse).
  // Two scroll-snap columns (hours 00-23, minutes in 5-min steps),
  // live-writes via onChange on column settle, never writes from
  // opening or closing alone. This suite covers the pure pieces:
  // the column literals, the HH:MM ↔ index helpers, the snap-to-
  // nearest math, and a contract simulation for the no-silent-write
  // rule (open→close-without-scroll leaves value unchanged).
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const parseHHMMIndices = sb.__parseHHMMIndices;
    const indicesToHHMM    = sb.__indicesToHHMM;
    const TIME_WHEEL_HOURS   = sb.__TIME_WHEEL_HOURS;
    const TIME_WHEEL_MINUTES = sb.__TIME_WHEEL_MINUTES;

    check('T0: pure helpers + constants exposed in sandbox',
      typeof parseHHMMIndices === 'function' &&
      typeof indicesToHHMM === 'function' &&
      Array.isArray(TIME_WHEEL_HOURS) &&
      Array.isArray(TIME_WHEEL_MINUTES),
      `parse=${typeof parseHHMMIndices}, indices=${typeof indicesToHHMM}, ` +
      `hours=${Array.isArray(TIME_WHEEL_HOURS)}, mins=${Array.isArray(TIME_WHEEL_MINUTES)}`);

    if (Array.isArray(TIME_WHEEL_HOURS) && Array.isArray(TIME_WHEEL_MINUTES)) {
      // T1 — Hours list: exactly the 24 entries 00..23, zero-padded.
      check('T1a TIME_WHEEL_HOURS length === 24',
        TIME_WHEEL_HOURS.length === 24);
      check('T1b TIME_WHEEL_HOURS[0]  === "00"',  TIME_WHEEL_HOURS[0]  === '00');
      check('T1c TIME_WHEEL_HOURS[9]  === "09"',  TIME_WHEEL_HOURS[9]  === '09');
      check('T1d TIME_WHEEL_HOURS[23] === "23"',  TIME_WHEEL_HOURS[23] === '23');
      check('T1e all hours are 2-char zero-padded strings',
        TIME_WHEEL_HOURS.every(h => typeof h === 'string' && /^\d{2}$/.test(h)));

      // T2 — Minutes list: exactly ['00','05',...,'55'] — the 5-min
      // set. The wheel cannot land on a 1-min off-grid value.
      check('T2a TIME_WHEEL_MINUTES length === 12',
        TIME_WHEEL_MINUTES.length === 12);
      check('T2b TIME_WHEEL_MINUTES === ["00","05","10",…,"55"]',
        JSON.stringify(TIME_WHEEL_MINUTES) ===
        JSON.stringify(['00','05','10','15','20','25','30','35','40','45','50','55']));
      check('T2c every minute is a multiple of 5',
        TIME_WHEEL_MINUTES.every(m => parseInt(m, 10) % 5 === 0));
    }

    if (typeof parseHHMMIndices === 'function') {
      // T3 — Round-trip: every on-grid HH:MM parses to indices that
      // indicesToHHMM rebuilds to exactly the same string. Sweeps
      // every valid (hour, 5-min) combination.
      let roundTripOk = 0;
      let roundTripFail = null;
      for (const h of TIME_WHEEL_HOURS) {
        for (const m of TIME_WHEEL_MINUTES) {
          const v = `${h}:${m}`;
          const parsed = parseHHMMIndices(v);
          if (!parsed) { roundTripFail = `${v}: parsed null`; break; }
          const rebuilt = indicesToHHMM(parsed[0], parsed[1]);
          if (rebuilt !== v) { roundTripFail = `${v} → ${parsed} → ${rebuilt}`; break; }
          roundTripOk++;
        }
        if (roundTripFail) break;
      }
      check('T3 on-grid HH:MM ↔ column-index round-trip (all 24×12 = 288 combos)',
        roundTripOk === 288 && !roundTripFail,
        `ok=${roundTripOk}, fail=${roundTripFail}`);

      // T4 — Snap-to-nearest 5 for off-grid minutes. The parsed
      // minute index lands on the closest 5-min slot.
      const snap = [
        ['07:23', [7, 5], '23 → round(4.6)=5 → 25'],         // user 23 → nearest 25
        ['07:22', [7, 4], '22 → round(4.4)=4 → 20'],
        ['07:25', [7, 5], 'already on 5'],
        ['07:27', [7, 5], '27 → round(5.4)=5 → 25'],
        ['07:28', [7, 6], '28 → round(5.6)=6 → 30'],
        ['07:02', [7, 0], '02 → round(0.4)=0 → 00'],
        ['07:03', [7, 1], '03 → round(0.6)=1 → 05'],
        ['07:57', [7, 11], '57 → round(11.4)=11 → 55 (clamped at top)'],
        ['07:58', [7, 11], '58 → round(11.6)=12 → clamp 11 → 55'],
      ];
      let snapOk = 0, snapFail = null;
      for (const [v, expect, why] of snap) {
        const parsed = parseHHMMIndices(v);
        if (!parsed) { snapFail = `${v}: null (${why})`; break; }
        if (parsed[0] !== expect[0] || parsed[1] !== expect[1]) {
          snapFail = `${v} → [${parsed}], expected [${expect}] (${why})`;
          break;
        }
        snapOk++;
      }
      check('T4 snap-to-nearest 5 (incl. clamp at minute 55)',
        snapOk === snap.length && !snapFail,
        `ok=${snapOk}, fail=${snapFail}`);

      // T5 — Invalid input → null (defensive). Wheel callers use null
      // as "open at the neutral default 09:00".
      const invalids = ['', null, undefined, 'not a time', '24:00', '99:99', '7:00', '07:00:00', '7:5'];
      let nullOk = 0, nullFail = null;
      for (const v of invalids) {
        const parsed = parseHHMMIndices(v);
        if (parsed !== null) { nullFail = `${JSON.stringify(v)} → ${JSON.stringify(parsed)} (expected null)`; break; }
        nullOk++;
      }
      check('T5 parseHHMMIndices returns null for invalid input',
        nullOk === invalids.length && !nullFail,
        `ok=${nullOk}, fail=${nullFail}`);
    }

    if (typeof indicesToHHMM === 'function') {
      // T6 — indicesToHHMM clamps out-of-range indices. Scroll-fling
      // math can transiently produce slightly out-of-range values
      // before settle; the helper must defend.
      check('T6a indicesToHHMM(-1, 0) clamps to "00:00"',
        indicesToHHMM(-1, 0) === '00:00');
      check('T6b indicesToHHMM(24, 0) clamps to "23:00"',
        indicesToHHMM(24, 0) === '23:00');
      check('T6c indicesToHHMM(0, -1) clamps to "00:00"',
        indicesToHHMM(0, -1) === '00:00');
      check('T6d indicesToHHMM(0, 12) clamps to "00:55"',
        indicesToHHMM(0, 12) === '00:55');
      check('T6e indicesToHHMM(0, 999) clamps to "00:55"',
        indicesToHHMM(0, 999) === '00:55');
      check('T6f indicesToHHMM(NaN, NaN) → "00:00" (defensive)',
        indicesToHHMM(NaN, NaN) === '00:00');
      check('T6g indicesToHHMM(9, 6) → "09:30" (5-min step math)',
        indicesToHHMM(9, 6) === '09:30');
    }

    // T7 — No-silent-write contract. Simulates the commit gate that
    // suppresses writes during the open-and-close-without-scrolling
    // path. The simulation mirrors `commitFromScroll`'s `hhmm !== value`
    // guard and the `programmaticDoneRef` two-rAF window for the
    // initial positioning scroll.
    {
      // Mini state machine modelling the wheel's commit logic.
      const makeWheel = (initial) => {
        let stored = initial;
        let opened = false;
        let programmaticDone = false;
        let writes = 0;
        return {
          get stored() { return stored; },
          get writes() { return writes; },
          open() {
            opened = true;
            programmaticDone = false;
            // Two-rAF: simulate the gate flipping later.
          },
          finishProgrammaticPositioning() { programmaticDone = true; },
          // Simulated scroll-settle: only commits when (a) open, (b)
          // the positioning gate is open, and (c) the computed HH:MM
          // differs from the stored value.
          scrollSettleTo(hourIdx, minIdx) {
            if (!opened) return;
            if (!programmaticDone) return; // ignore positioning scroll
            const hhmm = indicesToHHMM(hourIdx, minIdx);
            if (hhmm !== stored) {
              stored = hhmm;
              writes++;
            }
          },
          close() { opened = false; },
        };
      };

      // T7a — Open + close-without-scroll on an EMPTY field → stored stays empty.
      {
        const w = makeWheel('');
        w.open();
        w.finishProgrammaticPositioning();
        // No scroll fired between positioning and close.
        w.close();
        check('T7a open + close-without-scroll on empty field: value stays ""',
          w.stored === '' && w.writes === 0,
          `stored=${JSON.stringify(w.stored)}, writes=${w.writes}`);
      }

      // T7b — Open + close-without-scroll on a populated field → unchanged.
      {
        const w = makeWheel('08:30');
        w.open();
        w.finishProgrammaticPositioning();
        w.close();
        check('T7b open + close-without-scroll on "08:30": value unchanged',
          w.stored === '08:30' && w.writes === 0);
      }

      // T7c — Scroll events DURING positioning (before
      // programmaticDone flips) are ignored. This is the gate that
      // protects against the browser firing scroll events from a
      // programmatic scrollTop assignment.
      {
        const w = makeWheel('08:30');
        w.open();
        // Programmatic scroll-settle to the open position fires here
        // BEFORE programmaticDone flips. Must NOT commit.
        w.scrollSettleTo(8, 6); // would be "08:30" anyway, also a no-op by !== check
        // Also try a "different" position arriving before the gate
        // flips — still must not commit, because gate is closed.
        w.scrollSettleTo(9, 6);
        check('T7c scroll-settle events before programmaticDone are ignored',
          w.stored === '08:30' && w.writes === 0,
          `stored=${w.stored}, writes=${w.writes}`);
      }

      // T7d — Genuine user scroll AFTER positioning DOES commit.
      {
        const w = makeWheel('08:30');
        w.open();
        w.finishProgrammaticPositioning();
        w.scrollSettleTo(9, 6); // user scrolled hour wheel up to 09
        check('T7d genuine scroll after positioning → commits new value',
          w.stored === '09:30' && w.writes === 1,
          `stored=${w.stored}, writes=${w.writes}`);
      }

      // T7e — Same-value scroll-settle is suppressed (the `hhmm !==
      // value` guard). Even if the user scrolls but lands back on the
      // same slot, no write fires.
      {
        const w = makeWheel('08:30');
        w.open();
        w.finishProgrammaticPositioning();
        w.scrollSettleTo(8, 6); // same as stored
        check('T7e scroll-settle to the same value: no write',
          w.stored === '08:30' && w.writes === 0);
      }

      // T7f — Multiple writes in a session: each column-settle fires
      // independently. After the first commit, `stored` advances; the
      // next column-settle compares against the new value.
      {
        const w = makeWheel('08:30');
        w.open();
        w.finishProgrammaticPositioning();
        w.scrollSettleTo(9, 6); // → "09:30"
        w.scrollSettleTo(9, 9); // → "09:45"
        w.scrollSettleTo(10, 9); // → "10:45"
        check('T7f three independent column-settles → three writes',
          w.stored === '10:45' && w.writes === 3,
          `stored=${w.stored}, writes=${w.writes}`);
      }

      // T7g — Open empty + scroll: the user lands on a 5-min slot,
      // value writes the picked HH:MM (the minor accepted edge from
      // the brief: setting empty to exactly the open-default is a
      // one-notch-scroll operation).
      {
        const w = makeWheel('');
        w.open();
        w.finishProgrammaticPositioning();
        w.scrollSettleTo(9, 1); // scrolled minute wheel from 00 to 05
        check('T7g open empty + genuine scroll: writes the picked time',
          w.stored === '09:05' && w.writes === 1);
      }
    }

    // ── T8–T12: structural checks for the polish-pass refactor ──
    // TimeInput was split into TimeTrigger + TimeWheelPanel +
    // WheelExpand so the CALL/WRAP pair could render the wheel full-
    // width below the 2-col grid. The no-silent-write contract is
    // now owned by TimeWheelPanel; verify the lifted code carries
    // the exact same gates.
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // Helper: slice a function body from source by its declaration.
    const sliceFn = (decl) => {
      const start = html.indexOf(decl);
      if (start === -1) return null;
      // Generous body window — the assertions only care about pattern
      // presence within the function's lexical area.
      return html.slice(start, start + 8000);
    };

    // T8 — The three components exist as named function declarations.
    check('T8a source: function TimeTrigger(...) defined',
      /function TimeTrigger\s*\(/.test(html));
    check('T8b source: function TimeWheelPanel(...) defined',
      /function TimeWheelPanel\s*\(/.test(html));
    check('T8c source: function WheelExpand(...) defined',
      /function WheelExpand\s*\(/.test(html));
    check('T8d source: function TimeInput(...) still defined (composer)',
      /function TimeInput\s*\(/.test(html));

    // T9 — TimeWheelPanel owns the live-write contract.
    {
      const body = sliceFn('function TimeWheelPanel(') || '';
      check('T9a TimeWheelPanel body has programmaticDoneRef gate',
        /programmaticDoneRef/.test(body));
      check('T9b TimeWheelPanel body has the `hhmm !== value` guard',
        /hhmm\s*!==\s*value/.test(body));
      check('T9c TimeWheelPanel body has the two-rAF positioning gate',
        /requestAnimationFrame\([\s\S]*requestAnimationFrame/.test(body));
      check('T9d TimeWheelPanel body has the settle debounce that calls commitFromScroll',
        // Either the original direct-fn form OR the Phase B form where
        // the settle arrow also fires the haptic selectionEnd marker.
        /setTimeout\s*\(\s*(?:commitFromScroll|\(\)\s*=>\s*\{[\s\S]{0,200}commitFromScroll\(\))/.test(body));
      check('T9e TimeWheelPanel body has NO Math.round(.../5)*5 snap',
        !/Math\.round\([^)]*\/\s*5\s*\)\s*\*\s*5/.test(body));
    }

    // T10 — TimeInput now COMPOSES the wheel; the live-write code
    // (commitFromScroll / programmaticDoneRef / scroll handlers) has
    // moved out into TimeWheelPanel. TimeInput's body just renders
    // TimeTrigger + WheelExpand + TimeWheelPanel.
    {
      const body = sliceFn('function TimeInput(') || '';
      check('T10a TimeInput body references <TimeWheelPanel',
        /<TimeWheelPanel/.test(body));
      check('T10b TimeInput body references <TimeTrigger',
        /<TimeTrigger/.test(body));
      check('T10c TimeInput body references <WheelExpand',
        /<WheelExpand/.test(body));
      check('T10d TimeInput body NO LONGER contains commitFromScroll',
        !/commitFromScroll/.test(body));
      check('T10e TimeInput body NO LONGER contains programmaticDoneRef',
        !/programmaticDoneRef/.test(body));
    }

    // T11 — WheelExpand is the animated container; its body uses the
    // CSS classes `.tm-wheel-anim` and `.tm-wheel-anim-open` to drive
    // the open/close animation, and stays mounted through close so
    // the collapse animates.
    {
      const body = sliceFn('function WheelExpand(') || '';
      check('T11a WheelExpand body uses tm-wheel-anim class',
        /tm-wheel-anim/.test(body));
      check('T11b WheelExpand body uses tm-wheel-anim-open class',
        /tm-wheel-anim-open/.test(body));
      check('T11c WheelExpand stays mounted through close (setTimeout … setRender(false))',
        /setTimeout\([\s\S]*setRender\(false\)/.test(body));
      // CSS sanity — the animation classes exist in the inline style block.
      check('T11d source: CSS .tm-wheel-anim rule defined',
        /\.tm-wheel-anim\s*\{[\s\S]*max-height:\s*0/.test(html));
      check('T11e source: CSS .tm-wheel-anim-open rule defined',
        /\.tm-wheel-anim-open\s*\{[\s\S]*max-height:/.test(html));
    }

    // T12 — DayEntryForm lifts the CALL/WRAP open state and renders
    // the wheel as a full-width grid item (col-span-2) below the
    // 2-col tile pair. Single-open at the pair level is enforced by
    // a single state variable that can only hold one of 'call' /
    // 'wrap' / null.
    {
      check('T12a source: DayEntryForm declares callWrapOpen state',
        /\[callWrapOpen,\s*setCallWrapOpen\]\s*=\s*useState\(null\)/.test(html));
      check('T12b source: CALL/WRAP grid renders a col-span-2 WheelExpand',
        /<WheelExpand\s+open=\{!!callWrapOpen\}\s+className="col-span-2"/.test(html));
      check('T12c source: the pair WheelExpand wraps a TimeWheelPanel',
        /<WheelExpand[\s\S]{0,200}<TimeWheelPanel/.test(html));
      check('T12d source: callWrapOpen value space is `\'call\' | \'wrap\' | null` only',
        /setCallWrapOpen\(s\s*=>\s*s\s*===\s*'call'\s*\?\s*null\s*:\s*'call'\)/.test(html) &&
        /setCallWrapOpen\(s\s*=>\s*s\s*===\s*'wrap'\s*\?\s*null\s*:\s*'wrap'\)/.test(html));
    }
  }

  // ===== V. SCROLL-TO-TOP — visibility gate =====
  // shouldShowScrollTop(scrollTop, threshold=300) → true iff scrolled
  // past `threshold`. Pure; the React component layers fade / smooth-
  // scroll / prefers-reduced-motion on top.
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const fn = sb.__shouldShowScrollTop;
    check('V0 shouldShowScrollTop exposed in sandbox',
      typeof fn === 'function',
      `typeof=${typeof fn}`);
    if (typeof fn === 'function') {
      // Below / at the default 300px threshold → hidden.
      check('V1 scrollTop = 0 → hidden',          fn(0)   === false);
      check('V2 scrollTop = 299 → hidden',        fn(299) === false);
      check('V3 scrollTop = 300 → hidden (strict >)', fn(300) === false);
      // Past the default threshold → visible.
      check('V4 scrollTop = 301 → visible',       fn(301) === true);
      check('V5 scrollTop = 1000 → visible',      fn(1000) === true);
      // Custom threshold honoured.
      check('V6 custom threshold 100, scrollTop 50 → hidden',
        fn(50, 100) === false);
      check('V7 custom threshold 100, scrollTop 200 → visible',
        fn(200, 100) === true);
      // Defensive: non-numeric or negative inputs → never visible.
      check('V8 negative scrollTop → hidden',
        fn(-1) === false);
      check('V9 NaN scrollTop → hidden',
        fn(NaN) === false);
    }
  }

  // ===== W. INVOICES LIST SECTION REORG — pure partition + ordering =====
  // Drafts → Overdue → Unpaid → Paid (grouped by paid-month). The
  // helpers own the split, sort directions, paid-month fallback chain,
  // per-month totals, and the "(undated)" bucket. todayMs is a
  // parameter for testability (no `new Date()` inside).
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const isOverdueSent = sb.__isOverdueSent;
    const unpaidSortKey = sb.__unpaidSortKey;
    const paidMonthKey  = sb.__paidMonthKey;
    const partition     = sb.__partitionInvoiceList;

    check('W0 helpers exposed in sandbox',
      typeof isOverdueSent === 'function' &&
      typeof unpaidSortKey === 'function' &&
      typeof paidMonthKey  === 'function' &&
      typeof partition     === 'function');

    // FIXED clock — 2026-06-08 (Monday).
    const TODAY_ISO = '2026-06-08';
    const todayMs = new Date(TODAY_ISO + 'T12:00:00').getTime();

    // ─ W1: isOverdueSent ─
    {
      check('W1a sent + dueDate < today → overdue',
        isOverdueSent({ status: 'sent', dueDate: '2026-06-01' }, todayMs) === true);
      check('W1b sent + dueDate == today → NOT overdue (strict <)',
        isOverdueSent({ status: 'sent', dueDate: '2026-06-08' }, todayMs) === false);
      check('W1c sent + dueDate > today → NOT overdue',
        isOverdueSent({ status: 'sent', dueDate: '2026-07-01' }, todayMs) === false);
      check('W1d sent + no dueDate → NOT overdue',
        isOverdueSent({ status: 'sent' }, todayMs) === false);
      check('W1e draft + past dueDate → NOT overdue (status gate)',
        isOverdueSent({ status: 'draft', dueDate: '2026-06-01' }, todayMs) === false);
      check('W1f paid + past dueDate → NOT overdue (status gate)',
        isOverdueSent({ status: 'paid', dueDate: '2026-06-01' }, todayMs) === false);
    }

    // ─ W2: paidMonthKey fallback chain ─
    {
      check('W2a datePaid wins',
        paidMonthKey({ datePaid: '2026-06-15', dateSent: '2026-05-01', invoiceDate: '2026-04-01' }) === '2026-06');
      check('W2b datePaid missing → dateSent next',
        paidMonthKey({ dateSent: '2026-05-15', invoiceDate: '2026-04-01' }) === '2026-05');
      check('W2c datePaid + dateSent missing → invoiceDate',
        paidMonthKey({ invoiceDate: '2026-04-15' }) === '2026-04');
      check('W2d only createdAt → slice(0,10) parsed',
        paidMonthKey({ createdAt: '2026-03-15T12:34:56.000Z' }) === '2026-03');
      check('W2e all missing → null',
        paidMonthKey({}) === null);
      check('W2f null invoice → null (defensive)',
        paidMonthKey(null) === null);
      check('W2g empty-string datePaid falls through (falsy)',
        paidMonthKey({ datePaid: '', dateSent: '2026-05-01' }) === '2026-05');
    }

    // ─ W3: unpaidSortKey fallback chain ─
    {
      check('W3a dueDate wins',
        unpaidSortKey({ dueDate: '2026-06-15', dateSent: '2026-05-01' }) === '2026-06-15');
      check('W3b no dueDate → dateSent',
        unpaidSortKey({ dateSent: '2026-05-15' }) === '2026-05-15');
      check('W3c no due/sent → invoiceDate',
        unpaidSortKey({ invoiceDate: '2026-04-15' }) === '2026-04-15');
      check('W3d empty → ""',
        unpaidSortKey({}) === '');
    }

    // ─ Fixtures: invoice records with the date fields the partition
    // helper reads. Production is irrelevant to the partition, so we
    // attach a stub for shape. Totals are pre-set so the per-month
    // sum is deterministic via the test's totalFn. ─
    const prod = { id: 'p1', title: 'Test' };
    const mk = (id, status, dates, total) => ({
      invoice: { id, status, ...dates, _t: total },
      production: prod,
    });
    const totalFn = (inv) => inv._t;

    // ─ W4: Drafts ordering (invoiceDate descending) ─
    {
      const items = [
        mk('d1', 'draft', { invoiceDate: '2026-05-01' }, 100),
        mk('d2', 'draft', { invoiceDate: '2026-06-01' }, 200),
        mk('d3', 'draft', { invoiceDate: '2026-04-01' }, 300),
      ];
      const r = partition(items, todayMs, totalFn);
      check('W4a Drafts split: 3 → drafts',
        r.drafts.length === 3 && r.overdue.length === 0 && r.unpaid.length === 0 && r.paidGroups.length === 0);
      check('W4b Drafts order: invoiceDate descending',
        r.drafts.map(it => it.invoice.id).join(',') === 'd2,d1,d3');
    }

    // ─ W5: Overdue vs Unpaid split — sent + dueDate < today → overdue. ─
    {
      const items = [
        mk('s1', 'sent', { dueDate: '2026-06-05' }, 100),  // overdue (3d)
        mk('s2', 'sent', { dueDate: '2026-06-15' }, 200),  // unpaid (in 7d)
        mk('s3', 'sent', { dueDate: '2026-06-01' }, 300),  // overdue (7d)
        mk('s4', 'sent', { dueDate: '2026-06-08' }, 400),  // unpaid (today exactly)
        mk('s5', 'sent', { dueDate: '2026-07-01' }, 500),  // unpaid (far)
      ];
      const r = partition(items, todayMs, totalFn);
      check('W5a overdue contains only past-due sent invoices',
        r.overdue.map(it => it.invoice.id).sort().join(',') === 's1,s3');
      check('W5b unpaid contains the rest (today-or-future + no-due)',
        r.unpaid.map(it => it.invoice.id).sort().join(',') === 's2,s4,s5');
      // ─ W6: Overdue order — most-overdue first = dueDate ascending. ─
      check('W6 overdue order: most-overdue first (s3 2026-06-01 before s1 2026-06-05)',
        r.overdue.map(it => it.invoice.id).join(',') === 's3,s1');
      // ─ W7: Unpaid order — closest-due at BOTTOM = sort key desc. ─
      // s5 (2026-07-01) → top, s2 (2026-06-15) → middle, s4 (2026-06-08) → bottom.
      check('W7 unpaid order: closest-due at BOTTOM (s5,s2,s4)',
        r.unpaid.map(it => it.invoice.id).join(',') === 's5,s2,s4');
    }

    // ─ W8: Unpaid with no dueDate falls back via unpaidSortKey. ─
    {
      const items = [
        mk('u1', 'sent', { dueDate: '2026-06-15' }, 100),                                // wins on dueDate
        mk('u2', 'sent', { dateSent: '2026-06-20' }, 200),                               // fallback dateSent
        mk('u3', 'sent', { invoiceDate: '2026-06-10' }, 300),                            // fallback invoiceDate
      ];
      const r = partition(items, todayMs, totalFn);
      // Sort-key desc: u2 (2026-06-20) > u1 (2026-06-15) > u3 (2026-06-10).
      check('W8 unpaid sort uses dueDate || dateSent || invoiceDate fallback',
        r.unpaid.map(it => it.invoice.id).join(',') === 'u2,u1,u3');
    }

    // ─ W9: Paid grouped by month, newest first. ─
    {
      const items = [
        mk('p1', 'paid', { datePaid: '2026-04-10' }, 100),
        mk('p2', 'paid', { datePaid: '2026-06-20' }, 200),
        mk('p3', 'paid', { datePaid: '2026-04-25' }, 300),
        mk('p4', 'paid', { datePaid: '2026-05-15' }, 400),
        mk('p5', 'paid', { datePaid: '2026-06-05' }, 500),
      ];
      const r = partition(items, todayMs, totalFn);
      check('W9a paid: 3 month groups',
        r.paidGroups.length === 3);
      check('W9b paid: groups ordered newest-month first',
        r.paidGroups.map(g => g.monthKey).join(',') === '2026-06,2026-05,2026-04');
      // Within a group: datePaid descending.
      check('W9c paid: within 2026-06, datePaid descending (p2 before p5)',
        r.paidGroups[0].items.map(it => it.invoice.id).join(',') === 'p2,p5');
      // ─ W10: Per-month totals = Σ totalFn(invoice). ─
      check('W10a 2026-06 total = p2 + p5 = 700',
        r.paidGroups[0].total === 700);
      check('W10b 2026-05 total = p4 = 400',
        r.paidGroups[1].total === 400);
      check('W10c 2026-04 total = p1 + p3 = 400',
        r.paidGroups[2].total === 400);
    }

    // ─ W11: Paid month key uses fallback chain end-to-end via partition. ─
    {
      const items = [
        // datePaid given → buckets as 2026-06.
        mk('q1', 'paid', { datePaid: '2026-06-01', dateSent: '2026-05-01', invoiceDate: '2026-04-01' }, 100),
        // No datePaid → falls to dateSent (2026-05).
        mk('q2', 'paid', { dateSent: '2026-05-10', invoiceDate: '2026-04-10' }, 200),
        // No datePaid / dateSent → falls to invoiceDate (2026-04).
        mk('q3', 'paid', { invoiceDate: '2026-04-15' }, 300),
        // Only createdAt → falls to that month.
        mk('q4', 'paid', { createdAt: '2026-03-20T08:00:00.000Z' }, 400),
      ];
      const r = partition(items, todayMs, totalFn);
      check('W11 paid bucketing uses full fallback chain across invoices',
        r.paidGroups.map(g => `${g.monthKey}:${g.items.length}`).join(',') ===
        '2026-06:1,2026-05:1,2026-04:1,2026-03:1');
    }

    // ─ W12: "(undated)" bucket at the very bottom. ─
    {
      const items = [
        mk('p1', 'paid', { datePaid: '2026-06-10' }, 100),
        mk('p2', 'paid', {                        }, 200),  // no usable date
        mk('p3', 'paid', { datePaid: '2026-05-10' }, 300),
        mk('p4', 'paid', { /* also undated */     }, 400),
      ];
      const r = partition(items, todayMs, totalFn);
      check('W12a paid groups end with monthKey === null (undated)',
        r.paidGroups[r.paidGroups.length - 1].monthKey === null);
      check('W12b undated bucket contains both undated invoices',
        r.paidGroups[r.paidGroups.length - 1].items.length === 2 &&
        r.paidGroups[r.paidGroups.length - 1].items.map(it => it.invoice.id).sort().join(',') === 'p2,p4');
      check('W12c undated bucket total = sum of its items (600)',
        r.paidGroups[r.paidGroups.length - 1].total === 600);
      check('W12d preceding groups are dated, newest-first',
        r.paidGroups.slice(0, -1).map(g => g.monthKey).join(',') === '2026-06,2026-05');
    }

    // ─ W13: Defensive — empty input, mixed bad statuses. ─
    {
      const r1 = partition([], todayMs, totalFn);
      check('W13a empty input → all sections empty',
        r1.drafts.length === 0 && r1.overdue.length === 0 &&
        r1.unpaid.length === 0 && r1.paidGroups.length === 0);
      const r2 = partition(null, todayMs, totalFn);
      check('W13b null input → all sections empty (defensive)',
        r2.drafts.length === 0 && r2.overdue.length === 0 &&
        r2.unpaid.length === 0 && r2.paidGroups.length === 0);
      // Items with unknown status are dropped.
      const items = [
        mk('x', 'cancelled', {}, 100),
        mk('y', null, {}, 100),
        { invoice: null, production: prod },
        mk('d', 'draft', { invoiceDate: '2026-05-01' }, 100),
      ];
      const r3 = partition(items, todayMs, totalFn);
      check('W13c unknown / null statuses dropped; only draft retained',
        r3.drafts.length === 1 && r3.drafts[0].invoice.id === 'd' &&
        r3.overdue.length === 0 && r3.unpaid.length === 0 &&
        r3.paidGroups.length === 0);
    }

    // ─ W14: totalFn missing → totals are 0 (helper-side defensive). ─
    {
      const items = [
        mk('p1', 'paid', { datePaid: '2026-06-10' }, 100),
        mk('p2', 'paid', { datePaid: '2026-06-12' }, 200),
      ];
      const r = partition(items, todayMs, null);
      check('W14 missing totalFn → group totals are 0',
        r.paidGroups[0].total === 0 && r.paidGroups[0].items.length === 2);
    }
  }

  // ===== X. MONTHLY EARNINGS AGGREGATION — aggregateMonthly =====
  // Reads enrichedDays (the same shape StatsScreen's reducer produces:
  // { day, resolved, production, crew, calc }) and returns a continuous
  // ascending series with per-month totals, buckets, days, shoots,
  // dayTypes, kit-discount, notYetCounted, and isCurrentMonth.
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const aggregateMonthly = sb.__aggregateMonthly;
    const categorize       = sb.__categorizeBreakdownLine;
    const computeKitDisc   = sb.__computeProductionKitDiscount;
    const todayISO         = sb.__todayISO;

    check('X0 helpers exposed in sandbox',
      typeof aggregateMonthly === 'function' &&
      typeof categorize === 'function' &&
      typeof computeKitDisc === 'function' &&
      typeof todayISO === 'function');

    const currentMo = todayISO().slice(0, 7);

    // ─ Fixture factories (no real calcForDisplay — the helper reads
    // only calc.total / calc.lines / calc.meta.dayType, so we can
    // construct synthetic enriched-day objects directly). ─
    const mkLine = (label, amount, bucket) => bucket
      ? { label, amount, bucket }
      : { label, amount };
    const mkEnriched = (pid, date, dayType, lines, prodOverride) => ({
      day:        { date, crewId: 'c1' },
      resolved:   { callTime: '08:00', wrapTime: '19:00' },
      production: prodOverride || { id: pid, kitDeals: [], crew: [{ id: 'c1', name: 'U' }],
                                     bestBoyMode: false, days: [], iAmCrewId: 'c1' },
      crew:       { id: 'c1' },
      calc: {
        total: lines.reduce((s, l) => s + l.amount, 0),
        meta: { dayType },
        lines,
      },
    });

    // ─ X1: month key = day.date.slice(0,7). ─
    {
      const ed = [
        mkEnriched('p1', '2024-03-04', 'Shoot', [mkLine('BDR', 400)]),
        mkEnriched('p1', '2024-04-15', 'Shoot', [mkLine('BDR', 500)]),
        mkEnriched('p1', '2024-12-31', 'Shoot', [mkLine('BDR', 600)]),
      ];
      const series = aggregateMonthly(ed, [], { displayName: 'U' });
      const months = series.map(s => s.month);
      check('X1a months derived from day.date.slice(0,7)',
        months.includes('2024-03') && months.includes('2024-04') && months.includes('2024-12'));
      check('X1b month keys are "YYYY-MM" strings',
        series.every(s => /^\d{4}-\d{2}$/.test(s.month)));
    }

    // ─ X2: per month, amount === sum(grossBuckets) − kitDiscount. ─
    // ─ X4: bucket sums correct via categorizeBreakdownLine. ─
    {
      const ed = [
        mkEnriched('p1', '2024-03-04', 'Shoot', [
          mkLine('BDR',        444),         // basic
          mkLine('OT (1.5×)',  100),         // ot
          mkLine('Late lunch', 25),          // pen
          mkLine('Kit',        50, 'kit'),   // kit (via bucket marker)
          mkLine('Per diem',   30),          // extras
        ]),
        mkEnriched('p1', '2024-03-05', 'Shoot', [
          mkLine('BDR',        444),
          mkLine('Travel time', 20),         // extras
        ]),
      ];
      const series = aggregateMonthly(ed, [], { displayName: 'U' });
      const mar = series.find(s => s.month === '2024-03');
      check('X4a basic bucket = 888 (2×£444)',
        mar.grossBuckets.basic === 888);
      check('X4b ot bucket = 100',
        mar.grossBuckets.ot === 100);
      check('X4c pen bucket = 25',
        mar.grossBuckets.pen === 25);
      check('X4d kit bucket = 50 (via bucket marker)',
        mar.grossBuckets.kit === 50);
      check('X4e extras bucket = 50 (per diem + travel)',
        mar.grossBuckets.extras === 50);
      const sumBuckets = Object.values(mar.grossBuckets).reduce((s, v) => s + v, 0);
      check('X2 amount === Σ grossBuckets − kitDiscount per month',
        mar.amount === sumBuckets - mar.kitDiscount);
    }

    // ─ X3: amount equals existing stats earningsByMonth byte-for-byte. ─
    // Reproduces stats's earningsByMonth computation inline (Σ calc.total
    // by month, then subtract per-production discount on the deal-month)
    // and asserts every aggregateMonthly amount matches.
    {
      const userPrefs = { displayName: 'U' };
      const ed = [
        mkEnriched('p1', '2024-03-04', 'Shoot', [mkLine('BDR', 400)]),
        mkEnriched('p1', '2024-03-05', 'Shoot', [mkLine('BDR', 400)]),
        mkEnriched('p2', '2024-04-10', 'Shoot', [mkLine('BDR', 500)]),
        mkEnriched('p2', '2024-04-11', 'Shoot', [mkLine('BDR', 500)]),
      ];
      // Mimic the existing reducer's path.
      const expectedByMonth = {};
      const earliestByProd = new Map();
      for (const e of ed) {
        const mo = e.day.date.slice(0, 7);
        expectedByMonth[mo] = (expectedByMonth[mo] || 0) + e.calc.total;
        const prev = earliestByProd.get(e.production.id);
        if (prev == null || e.day.date < prev) earliestByProd.set(e.production.id, e.day.date);
      }
      const seen = new Set();
      for (const e of ed) {
        if (seen.has(e.production.id)) continue;
        seen.add(e.production.id);
        const disc = computeKitDisc(e.production, userPrefs);
        if (disc > 0) {
          const dealMonth = earliestByProd.get(e.production.id).slice(0, 7);
          expectedByMonth[dealMonth] -= disc;
        }
      }
      const series = aggregateMonthly(ed, [], userPrefs);
      // For every month in expectedByMonth, find it in series and compare.
      let mismatch = null;
      for (const [mo, expected] of Object.entries(expectedByMonth)) {
        const entry = series.find(s => s.month === mo);
        if (!entry) { mismatch = `missing month ${mo}`; break; }
        if (Math.abs(entry.amount - expected) > 0.001) {
          mismatch = `${mo}: helper=${entry.amount}, expected=${expected}`;
          break;
        }
      }
      check('X3 aggregateMonthly amount matches existing stats earningsByMonth byte-for-byte',
        mismatch === null, mismatch || '');
    }

    // ─ X5: days = distinct (prodId, date) per month. ─
    {
      const ed = [
        mkEnriched('p1', '2024-03-04', 'Shoot', [mkLine('BDR', 100)]),
        mkEnriched('p2', '2024-03-04', 'Shoot', [mkLine('BDR', 100)]),  // diff prod, same date → +1 day
        mkEnriched('p1', '2024-03-04', 'Shoot', [mkLine('Late', 25)]),   // dup (pid,date) → ignored
        mkEnriched('p1', '2024-03-05', 'Shoot', [mkLine('BDR', 100)]),
      ];
      const series = aggregateMonthly(ed, [], { displayName: 'U' });
      const mar = series.find(s => s.month === '2024-03');
      check('X5 days = 3 distinct (prodId, date) tuples',
        mar.days === 3, `days=${mar.days}`);
    }

    // ─ X6: shoots = distinct production.id with ≥1 day that month. ─
    {
      const ed = [
        mkEnriched('p1', '2024-03-04', 'Shoot', [mkLine('BDR', 100)]),
        mkEnriched('p1', '2024-03-05', 'Shoot', [mkLine('BDR', 100)]),
        mkEnriched('p2', '2024-03-07', 'Shoot', [mkLine('BDR', 100)]),
        mkEnriched('p3', '2024-04-01', 'Shoot', [mkLine('BDR', 100)]),
      ];
      const series = aggregateMonthly(ed, [], { displayName: 'U' });
      const mar = series.find(s => s.month === '2024-03');
      const apr = series.find(s => s.month === '2024-04');
      check('X6a March: shoots = 2 (p1 + p2)',
        mar.shoots === 2, `shoots=${mar.shoots}`);
      check('X6b April: shoots = 1 (p3)',
        apr.shoots === 1, `shoots=${apr.shoots}`);
    }

    // ─ X7: dayTypes counts per month (distinct (pid,date) per type). ─
    {
      const ed = [
        mkEnriched('p1', '2024-03-04', 'Shoot',     [mkLine('BDR', 100)]),
        mkEnriched('p1', '2024-03-05', 'Shoot',     [mkLine('BDR', 100)]),
        mkEnriched('p1', '2024-03-06', 'Pre-light', [mkLine('BDR', 100)]),
        mkEnriched('p2', '2024-03-07', 'Travel Day',[mkLine('BDR', 100)]),
      ];
      const series = aggregateMonthly(ed, [], { displayName: 'U' });
      const mar = series.find(s => s.month === '2024-03');
      check('X7a Shoot count = 2', mar.dayTypes['Shoot'] === 2);
      check('X7b Pre-light count = 1', mar.dayTypes['Pre-light'] === 1);
      check('X7c Travel Day count = 1', mar.dayTypes['Travel Day'] === 1);
    }

    // ─ X8: kit discount lands on the deal-month (production's first user-day). ─
    // ─ X9: series total drop = sum of discounts (= existing totalEarnings drop). ─
    {
      const userPrefs = {
        displayName: 'U',
        kitInventory: [{ id: 'k1', name: 'Boom', defaultDailyRate: 100, defaultOn: true }],
      };
      // p1 has a kit deal that drops the total by 50.
      const prodWithDeal = {
        id: 'p1',
        iAmCrewId: 'c1',
        bestBoyMode: false,
        crew: [{ id: 'c1', name: 'U' }],
        kitDeals: [{ itemId: 'k1', negotiatedTotal: 150 }],   // usual 2×£100 = £200, deal £150 → £50 discount
        days: [
          { id: 'd1', crewId: 'c1', date: '2024-03-15', dayType: 'Shoot',
            kitItems: [{ itemId: 'k1', name: 'Boom', rate: 100 }] },
          { id: 'd2', crewId: 'c1', date: '2024-03-20', dayType: 'Shoot',
            kitItems: [{ itemId: 'k1', name: 'Boom', rate: 100 }] },
        ],
      };
      const ed = [
        // First user-day-pre-today is 2024-03-15 (deal-month March 2024)
        mkEnriched('p1', '2024-03-15', 'Shoot', [mkLine('BDR', 444), mkLine('Boom', 100, 'kit')], prodWithDeal),
        mkEnriched('p1', '2024-03-20', 'Shoot', [mkLine('BDR', 444), mkLine('Boom', 100, 'kit')], prodWithDeal),
        // Subsequent April day in same production — discount stays on March, NOT split.
        mkEnriched('p1', '2024-04-10', 'Shoot', [mkLine('BDR', 444)], prodWithDeal),
      ];
      const series = aggregateMonthly(ed, [], userPrefs);
      const mar = series.find(s => s.month === '2024-03');
      const apr = series.find(s => s.month === '2024-04');
      check('X8a kit discount lands on deal-month (March)',
        mar.kitDiscount === 50, `mar.kitDiscount=${mar.kitDiscount}`);
      check('X8b non-deal month (April) gets zero kit discount',
        apr.kitDiscount === 0);
      check('X8c amount per month reflects discount',
        Math.abs((mar.grossBuckets.basic + mar.grossBuckets.kit) - mar.kitDiscount - mar.amount) < 0.001);
      // X9: Σ amount = Σ gross − total discount
      const totalAmount = series.reduce((s, e) => s + e.amount, 0);
      const totalGross = series.reduce((s, e) => s + Object.values(e.grossBuckets).reduce((a, b) => a + b, 0), 0);
      const totalDiscount = series.reduce((s, e) => s + e.kitDiscount, 0);
      check('X9 Σ amount = Σ grossBuckets − Σ kitDiscount',
        Math.abs(totalAmount - (totalGross - totalDiscount)) < 0.001,
        `Σamount=${totalAmount}, Σgross=${totalGross}, Σdisc=${totalDiscount}`);
      check('X9b Σ kitDiscount equals deal-month allocation (£50)',
        totalDiscount === 50);
    }

    // ─ X10: gap months emitted as zero-entries. ─
    // ─ X11: ascending order. ─
    {
      const ed = [
        mkEnriched('p1', '2024-03-04', 'Shoot', [mkLine('BDR', 100)]),
        // Gap: April, May 2024 → must appear as zero entries.
        mkEnriched('p1', '2024-06-01', 'Shoot', [mkLine('BDR', 100)]),
      ];
      const series = aggregateMonthly(ed, [], { displayName: 'U' });
      const months = series.map(s => s.month);
      check('X10a gap months emitted: 2024-04 in series',
        months.includes('2024-04'));
      check('X10b gap months emitted: 2024-05 in series',
        months.includes('2024-05'));
      const apr = series.find(s => s.month === '2024-04');
      check('X10c gap entry has amount=0, days=0, shoots=0, empty buckets',
        apr.amount === 0 && apr.days === 0 && apr.shoots === 0 &&
        Object.values(apr.grossBuckets).every(v => v === 0));
      // X11: ascending.
      const sortedAsc = [...months].sort();
      check('X11 series is ascending by month',
        months.join(',') === sortedAsc.join(','));
    }

    // ─ X12: isCurrentMonth flag. ─
    {
      // Use the actual current month so the assertion is timezone-stable.
      const ed = [mkEnriched('p1', '2024-03-04', 'Shoot', [mkLine('BDR', 100)])];
      const series = aggregateMonthly(ed, [], { displayName: 'U' });
      // Series goes 2024-03 → current month inclusive.
      const last = series[series.length - 1];
      check('X12a last entry isCurrentMonth: true',
        last.month === currentMo && last.isCurrentMonth === true);
      const allButLast = series.slice(0, -1);
      check('X12b every other entry isCurrentMonth: false',
        allButLast.every(s => s.isCurrentMonth === false));
    }

    // ─ X13: notYetCounted per month — counts user days >= today. ─
    // Hard to test deterministically without freezing today, but we
    // can verify the BEHAVIOR with a production day that's far in the
    // future. The current month's notYetCounted should >= 1 if we
    // schedule a same-month future day; we use 2099 to be safe.
    {
      const futureDate = '2099-12-31';
      const futureMo = '2099-12';
      const prodWithFuture = {
        id: 'p1',
        iAmCrewId: 'c1',
        bestBoyMode: false,
        crew: [{ id: 'c1', name: 'U' }],
        kitDeals: [],
        days: [
          { id: 'd1', crewId: 'c1', date: futureDate, dayType: 'Shoot' },
        ],
      };
      const ed = [
        // A past day so the series has something to anchor on.
        mkEnriched('p0', '2024-01-15', 'Shoot', [mkLine('BDR', 100)]),
      ];
      // The future day is in productions but NOT in enrichedDays (it
      // would be filtered out upstream). aggregateMonthly's pass-3
      // notYetByMonth scan should still pick it up via the productions
      // arg — but only because the series goes earliest → currentMo
      // (NOT into 2099), the future entry won't appear in the series.
      const series = aggregateMonthly(ed, [prodWithFuture], { displayName: 'U' });
      const futureInSeries = series.find(s => s.month === futureMo);
      check('X13a series caps at current month — future-month not in series',
        futureInSeries == null);
      // If the future day happened to be in the CURRENT month, it'd
      // show up in the current month's notYetCounted. Test that path
      // by re-running with a current-month "future" date — we use
      // tomorrow's date relative to today.
      const tomorrowIso = (() => {
        const d = new Date(todayISO() + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
      })();
      const tomorrowMo = tomorrowIso.slice(0, 7);
      const prodWithTomorrow = {
        id: 'p2',
        iAmCrewId: 'c1',
        bestBoyMode: false,
        crew: [{ id: 'c1', name: 'U' }],
        kitDeals: [],
        days: [{ id: 'd1', crewId: 'c1', date: tomorrowIso, dayType: 'Shoot' }],
      };
      const series2 = aggregateMonthly(ed, [prodWithTomorrow], { displayName: 'U' });
      const tomorrowEntry = series2.find(s => s.month === tomorrowMo);
      // If tomorrow is in the current month → entry exists with notYet=1.
      // If tomorrow is in next month → no entry (series stops at currentMo).
      if (tomorrowMo === currentMo) {
        check('X13b tomorrow-in-current-month: notYetCounted includes that day',
          tomorrowEntry && tomorrowEntry.notYetCounted >= 1,
          `entry=${JSON.stringify(tomorrowEntry)}`);
      } else {
        // Spans a month boundary (e.g. last day of month tests). The
        // future day falls outside the series cap — that's expected.
        check('X13c future-month day correctly not in series (series caps at current month)',
          tomorrowEntry == null);
      }
    }

    // ─ X14: defensive — empty enrichedDays → empty series. ─
    {
      check('X14a empty array → empty series',
        Array.isArray(aggregateMonthly([], [], { displayName: 'U' })) &&
        aggregateMonthly([], [], { displayName: 'U' }).length === 0);
      check('X14b null → empty series',
        Array.isArray(aggregateMonthly(null, [], { displayName: 'U' })) &&
        aggregateMonthly(null, [], { displayName: 'U' }).length === 0);
      check('X14c undefined → empty series',
        Array.isArray(aggregateMonthly(undefined, [], { displayName: 'U' })) &&
        aggregateMonthly(undefined, [], { displayName: 'U' }).length === 0);
    }

    // ─ X15: all-time earnings month-LIST is timezone-safe (bug fix). ─
    // The stats month-breakdown range (allMonthsInRange → monthBreakdown table)
    // must be built from "YYYY-MM" STRING arithmetic, never
    // new Date(y,m,1).toISOString().slice(0,7): that reads a LOCAL-midnight
    // 1st-of-month back as the PREVIOUS month in any zone east of UTC (e.g. BST),
    // which duplicated the earliest month ("May listed twice") and dropped the
    // last ("current month missing"). Presentation only — earningsByMonth amounts
    // key on day.date.slice(0,7) (string-safe) and the pay calc is untouched.
    {
      const srcHtml = fs.readFileSync(SRC_HTML, 'utf8');
      check('X15a no UTC month-key construction remains — toISOString().slice(0,7) is gone from index.html (the BST month-shift bug pattern)',
        !/toISOString\(\)\.slice\(0, ?7\)/.test(srcHtml));
      check('X15b all-time range walks "YYYY-MM" string keys via nextMo, bounded by the earliest/latest earning-month keys (no Date-wrapped bounds)',
        /const nextMo = \(mo\) => \{\s*const \[y, m\] = mo\.split\('-'\)\.map\(Number\);\s*return m === 12 \? `\$\{y \+ 1\}-01` : `\$\{y\}-\$\{String\(m \+ 1\)\.padStart\(2, '0'\)\}`;/.test(srcHtml) &&
        /let cur = moKeys\[0\];\s*const end = moKeys\[moKeys\.length - 1\];\s*while \(cur <= end\) \{ months\.push\(cur\); cur = nextMo\(cur\); \}/.test(srcHtml) &&
        !/new Date\(moKeys\[0\] \+ '-01/.test(srcHtml));
      check('X15c tax-year month list is string-built too (same defect class, same view)',
        /let cur = `\$\{yr\}-04`;\s*for \(let i = 0; i < 12; i\+\+\) \{ months\.push\(cur\); cur = nextMo\(cur\); \}/.test(srcHtml));
      check('X15d month label keeps the year (month:long + year:numeric) so two different Mays never read identically',
        /const fmtMonth = \(yyyymm\) => new Date\(yyyymm \+ '-01T12:00:00'\)\.toLocaleString\('en-GB', \{ month: 'long', year: 'numeric' \}\)/.test(srcHtml));
    }
  }

  // ===== Y. MONTHLY EARNINGS CHART — windowing + vs-last-year =====
  // The chart view (MonthlyEarningsView) layers over the Stage-1
  // series. The pure pieces — month math, 12-entry windowing, clamp,
  // vs-last-year lookup, percent-change with no-divide-by-zero, and
  // window-average — are verified here. Visual scroll feel is
  // dogfooded on device.
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const addOff = sb.__monthlyAddOffset;
    const taxYearOf = sb.__monthlyTaxYearOf;
    const monthlyWindow = sb.__monthlyWindow;
    const clamp = sb.__clampMonthlyAnchor;
    const vsLastYear = sb.__monthlyVsLastYear;
    const pct = sb.__monthlyPercentChange;
    const avg = sb.__monthlyAverage;

    check('Y0 helpers exposed in sandbox',
      typeof addOff === 'function' && typeof taxYearOf === 'function' &&
      typeof monthlyWindow === 'function' && typeof clamp === 'function' &&
      typeof vsLastYear === 'function' && typeof pct === 'function' &&
      typeof avg === 'function');

    // ─ Y1: monthlyAddOffset boundary cases ─
    {
      check('Y1a addOff("2026-06", 1) → "2026-07"',  addOff('2026-06', 1)  === '2026-07');
      check('Y1b addOff("2026-12", 1) → "2027-01"',  addOff('2026-12', 1)  === '2027-01');
      check('Y1c addOff("2026-01", -1) → "2025-12"', addOff('2026-01', -1) === '2025-12');
      check('Y1d addOff("2026-06", -12) → "2025-06"', addOff('2026-06', -12) === '2025-06');
      check('Y1e addOff("2026-06", 0) === "2026-06"', addOff('2026-06', 0)  === '2026-06');
      check('Y1f addOff zero-pads month', addOff('2026-08', 1) === '2026-09' && addOff('2026-09', 1) === '2026-10');
    }

    // ─ Y2: taxYearOf — Apr Y → Mar Y+1 belongs to year Y ─
    {
      check('Y2a Apr 2026 → tax year 2026', taxYearOf('2026-04') === 2026);
      check('Y2b Mar 2026 → tax year 2025', taxYearOf('2026-03') === 2025);
      check('Y2c Dec 2026 → tax year 2026', taxYearOf('2026-12') === 2026);
      check('Y2d Jan 2027 → tax year 2026', taxYearOf('2027-01') === 2026);
    }

    // ─ Y3: monthlyWindow '12m' — 12 entries ending at anchor, ASC,
    //   zero-padded for missing months ─
    {
      const series = [
        { month: '2026-04', amount: 100, grossBuckets: { basic: 100, ot: 0, pen: 0, kit: 0, extras: 0 }, kitDiscount: 0, days: 1, shoots: 1, dayTypes: {}, notYetCounted: 0, isCurrentMonth: false },
        { month: '2026-05', amount: 200, grossBuckets: { basic: 200, ot: 0, pen: 0, kit: 0, extras: 0 }, kitDiscount: 0, days: 1, shoots: 1, dayTypes: {}, notYetCounted: 0, isCurrentMonth: false },
        { month: '2026-06', amount: 300, grossBuckets: { basic: 300, ot: 0, pen: 0, kit: 0, extras: 0 }, kitDiscount: 0, days: 1, shoots: 1, dayTypes: {}, notYetCounted: 0, isCurrentMonth: true  },
      ];
      const win = monthlyWindow(series, '12m', '2026-06');
      check('Y3a window length is exactly 12', win.length === 12);
      check('Y3b first month is 2025-07 (12 before 2026-06)', win[0].month === '2025-07');
      check('Y3c last month is the anchor 2026-06', win[11].month === '2026-06');
      check('Y3d months are ascending',
        win.every((e, i) => i === 0 || e.month > win[i - 1].month));
      // Zero-padded months keep default shape.
      check('Y3e older months (no series entry) are zero-padded',
        win[0].amount === 0 && win[0].days === 0 && win[0].shoots === 0 &&
        Object.values(win[0].grossBuckets).every(v => v === 0));
      // Real series entries pass through unchanged.
      check('Y3f real series entries reach the window verbatim',
        win[9].amount === 100 && win[10].amount === 200 && win[11].amount === 300 &&
        win[11].isCurrentMonth === true);
    }

    // ─ Y4: monthlyWindow 'tax' — Apr Y → Mar Y+1, 12 entries ─
    {
      const series = [
        { month: '2026-04', amount: 100, grossBuckets: { basic: 100, ot: 0, pen: 0, kit: 0, extras: 0 }, kitDiscount: 0, days: 0, shoots: 0, dayTypes: {}, notYetCounted: 0, isCurrentMonth: false },
        { month: '2026-12', amount: 500, grossBuckets: { basic: 500, ot: 0, pen: 0, kit: 0, extras: 0 }, kitDiscount: 0, days: 0, shoots: 0, dayTypes: {}, notYetCounted: 0, isCurrentMonth: false },
        { month: '2027-03', amount: 700, grossBuckets: { basic: 700, ot: 0, pen: 0, kit: 0, extras: 0 }, kitDiscount: 0, days: 0, shoots: 0, dayTypes: {}, notYetCounted: 0, isCurrentMonth: false },
      ];
      const win = monthlyWindow(series, 'tax', 2026);
      check('Y4a tax-year window length is 12', win.length === 12);
      check('Y4b starts at 2026-04 (April of anchor year)',
        win[0].month === '2026-04');
      check('Y4c ends at 2027-03 (March of anchor+1)',
        win[11].month === '2027-03');
      check('Y4d months ascending',
        win.every((e, i) => i === 0 || e.month > win[i - 1].month));
      check('Y4e Apr / Dec / Mar amounts pass through',
        win[0].amount === 100 && win[8].month === '2026-12' && win[8].amount === 500 &&
        win[11].amount === 700);
      check('Y4f intermediate months zero-padded',
        win[5].amount === 0 && win[5].month === '2026-09');
    }

    // ─ Y5: clampMonthlyAnchor — '12m' mode ─
    {
      check('Y5a anchor before earliest → snaps to earliest',
        clamp('12m', '2024-01', '2025-06', '2026-06') === '2025-06');
      check('Y5b anchor after current → snaps to current',
        clamp('12m', '2027-01', '2025-06', '2026-06') === '2026-06');
      check('Y5c anchor within range → unchanged',
        clamp('12m', '2026-03', '2025-06', '2026-06') === '2026-03');
      check('Y5d anchor at earliest → unchanged',
        clamp('12m', '2025-06', '2025-06', '2026-06') === '2025-06');
      check('Y5e anchor at current → unchanged',
        clamp('12m', '2026-06', '2025-06', '2026-06') === '2026-06');
    }

    // ─ Y6: clampMonthlyAnchor — 'tax' mode ─
    {
      check('Y6a tax-year before earliest TY → snaps up',
        clamp('tax', 2020, '2025-06', '2026-06') === 2025);    // earliestTY = 2025
      check('Y6b tax-year after current TY → snaps down',
        clamp('tax', 2030, '2025-06', '2026-06') === 2026);    // currentTY = 2026
      check('Y6c tax-year within range → unchanged',
        clamp('tax', 2025, '2025-06', '2026-06') === 2025);
      // currentTY math: March 2026 → tax year 2025; April 2026 → 2026.
      check('Y6d March 2026 currentMo → currentTY = 2025',
        clamp('tax', 2027, '2025-06', '2026-03') === 2025);
      check('Y6e April 2026 currentMo → currentTY = 2026',
        clamp('tax', 2027, '2025-06', '2026-04') === 2026);
    }

    // ─ Y7: monthlyVsLastYear lookup + amount > 0 gate ─
    {
      const series = [
        { month: '2025-04', amount: 1000 },
        { month: '2025-05', amount: 0    },
        { month: '2025-06', amount:  500 },
        { month: '2026-04', amount: 1500 },
        { month: '2026-05', amount: 1200 },
        { month: '2026-06', amount:  800 },
      ];
      check('Y7a vs-last-year found → returns { month, amount }',
        JSON.stringify(vsLastYear(series, '2026-04')) ===
        JSON.stringify({ month: '2025-04', amount: 1000 }));
      check('Y7b vs-last-year for missing year → null',
        vsLastYear(series, '2024-01') === null);
      check('Y7c last-year amount === 0 → null (no fake comparison)',
        vsLastYear(series, '2026-05') === null);
      check('Y7d non-array series → null', vsLastYear(null, '2026-04') === null);
      check('Y7e missing month → null',    vsLastYear(series, null) === null);
      check('Y7f malformed month → null',  vsLastYear(series, 'not-a-month') === null);
    }

    // ─ Y8: monthlyPercentChange — gates on previous > 0 ─
    {
      check('Y8a normal case (100 → 150) = +50%',
        pct(150, 100) === 50);
      check('Y8b decrease (200 → 100) = -50%',
        pct(100, 200) === -50);
      check('Y8c previous = 0 → null',
        pct(100, 0) === null);
      check('Y8d previous < 0 → null (defensive)',
        pct(100, -10) === null);
      check('Y8e previous = null → null',
        pct(100, null) === null);
      check('Y8f previous NaN → null',
        pct(100, NaN) === null);
      check('Y8g current = previous → 0%',
        pct(100, 100) === 0);
    }

    // ─ Y9: monthlyAverage divides by the count of months in the window
    //   with EARNINGS (amount > 0), not the full window length. Otherwise
    //   pre-data zero months (or quiet stretches) drag the average toward
    //   zero and misrepresent the user's typical earning month. Divide-by
    //   -zero is guarded — an all-zero window returns 0. ─
    {
      const win = [
        { amount: 100 }, { amount: 200 }, { amount: 300 },
      ];
      check('Y9a 3 earning months: 600 / 3 = 200',
        avg(win) === 200);
      check('Y9b empty array → 0',
        avg([]) === 0);
      check('Y9c null → 0 (defensive)',
        avg(null) === 0);
      check('Y9d 12-entry zero window → 0 (guarded, no division)',
        avg(Array.from({ length: 12 }, () => ({ amount: 0 }))) === 0);
      // Realistic: 5 earning months out of a 12-entry window with zeros.
      // Old behaviour divided by 12 (≈ 1666.67); new divides by 5 (= 4000).
      const realisticWin = [
        { amount: 0 }, { amount: 0 }, { amount: 5000 }, { amount: 0 },
        { amount: 3000 }, { amount: 0 }, { amount: 4000 }, { amount: 0 },
        { amount: 0 }, { amount: 2000 }, { amount: 0 }, { amount: 6000 },
      ];
      check('Y9e realistic window: sum 20000 / 5 earning months = 4000',
        avg(realisticWin) === 4000);
      // Spec example — £4,003 across 2 earning months in a 12-month window.
      const specWin = [
        { amount: 0 }, { amount: 0 }, { amount: 0 }, { amount: 0 },
        { amount: 0 }, { amount: 0 }, { amount: 0 }, { amount: 0 },
        { amount: 0 }, { amount: 0 },
        { amount: 1003 },
        { amount: 3000 },
      ];
      check('Y9f spec: £4,003 across 2 earning months = £2,001.50',
        avg(specWin) === 2001.5);
      // A negative or NaN amount must NOT count as an earning month (the
      // filter is strictly amount > 0). Defensive — the calc engine never
      // emits negatives, but the filter shouldn't blow up if it ever did.
      check('Y9g negative / NaN amounts excluded from earning-month count',
        avg([{ amount: 100 }, { amount: -50 }, { amount: NaN }]) === 100);
      // Single earning month — average equals that month's amount.
      check('Y9h single earning month → that month\'s amount',
        avg([{ amount: 0 }, { amount: 0 }, { amount: 250 }, { amount: 0 }]) === 250);
    }

    // ─ Y10: edge — empty series → window of zero-padded months still
    //   has length 12 (the view can render with no data) ─
    {
      const win = monthlyWindow([], '12m', '2026-06');
      check('Y10a empty series, 12m anchor → 12 zero entries',
        win.length === 12 && win.every(e => e.amount === 0 && e.days === 0));
      const winTax = monthlyWindow([], 'tax', 2026);
      check('Y10b empty series, tax 2026 → 12 zero entries Apr-Mar',
        winTax.length === 12 && winTax[0].month === '2026-04' && winTax[11].month === '2027-03');
    }

    // ─ Y11: null/undefined series defensive ─
    {
      const a = monthlyWindow(null, '12m', '2026-06');
      const b = monthlyWindow(undefined, '12m', '2026-06');
      check('Y11a null series → length 12 (zero-padded)', a.length === 12);
      check('Y11b undefined series → length 12 (zero-padded)', b.length === 12);
    }

    // ─ Y12: MonthlyEarningsView axis label + layout source presence.
    //   The chart's right-hand value labels show WHOLE pounds (£4,000,
    //   not £4,000.00) so they fit inside the reserved 52px gutter on
    //   the right of the wrapper. The hero TOTAL EARNED and the
    //   "Monthly average" line keep fmtGBP (with pence) — only the
    //   side axis ticks change. The view root has overflowX:hidden as
    //   a backstop against future negative-margin regressions. ─
    {
      const html = fs.readFileSync(SRC_HTML, 'utf8');
      const startMarker = '    function MonthlyEarningsView(';
      const startIdx = html.indexOf(startMarker);
      const tail = startIdx === -1 ? '' : html.slice(startIdx + startMarker.length);
      const nextMatch = tail.search(/\n    function [A-Z]/);
      const view = startIdx === -1 ? '' :
        html.slice(startIdx, startIdx + startMarker.length + (nextMatch === -1 ? tail.length : nextMatch));

      check('Y12a MonthlyEarningsView function found in source',
        startIdx !== -1);

      // The local fmtAxis helper rounds to whole pounds and uses
      // toLocaleString('en-GB') — never .toFixed(2). If a future edit
      // routed axis labels through fmtGBP, the ".00" would come back.
      check('Y12b axis label helper: fmtAxis rounds to whole pounds',
        view.includes('const fmtAxis = (n) =>') &&
        view.includes('Math.round(Number(n) || 0)') &&
        view.includes("v.toLocaleString('en-GB')"));
      check('Y12c axis label helper: no .toFixed(2) inside fmtAxis',
        // fmtAxis is the only formatter used for axis ticks; .toFixed(2)
        // is used by fmtGBP elsewhere — but fmtGBP is defined at
        // module scope, not inside MonthlyEarningsView. Inside the view
        // we only expect to SEE .toFixed(2) if someone reverted the fix.
        !view.includes('.toFixed(2)'));

      // The gridline value labels and the "avg" label are both rendered
      // through fmtAxis — verify the call sites exist verbatim.
      check('Y12d gridline labels render fmtAxis(niceMax * f)',
        view.includes('{fmtAxis(niceMax * f)}'));

      // Reserved gutter — the inner plot has marginRight:52 and the
      // value labels sit at right:-52 with width:48 + textAlign:right.
      // If anyone reverts to the old 30px gutter, £4,000 overflows again.
      check('Y12e inner plot reserves 52px gutter (marginRight: 52)',
        view.includes('marginRight: 52'));
      check('Y12f x-labels row uses the same 52px gutter (alignment)',
        // Two occurrences expected — one for the plot inner div, one for
        // the x-labels flex row. Cheap sanity check.
        (view.match(/marginRight:\s*52/g) || []).length >= 2);
      check('Y12g value labels positioned inside the gutter (right:-52, width:48, textAlign:right)',
        view.includes('right: -52') &&
        view.includes('width: 48') &&
        view.includes("textAlign: 'right'"));

      // Backstop — the view root must have overflowX:hidden so a
      // single accidental wide child can't bring back the sideways
      // scroll bug across the entire view.
      check('Y12h view root has overflowX:hidden as a scroll backstop',
        view.includes("overflowX: 'hidden'"));

      // The hero / breakdown lines keep fmtGBP (pence). At least one
      // fmtGBP call must still be in the view — if all were replaced by
      // fmtAxis, the headline total would lose its pence.
      check('Y12i hero TOTAL EARNED + Monthly average still use fmtGBP',
        view.includes('fmtGBP(selEntry ? selEntry.amount : total)') &&
        view.includes('Monthly average ${fmtGBP(avg)}'));

      // Quick fixed-width audit — nothing inside the view should set an
      // explicit width wider than the viewport (270px is a generous
      // floor; real phones are >= 360px). If anyone adds a wider fixed
      // box later we'll catch it here.
      const fixedWidths = (view.match(/width:\s*(\d{3,})(?:\s*[,}])/g) || [])
        .map(m => parseInt(m.replace(/\D/g, ''), 10))
        .filter(n => Number.isFinite(n) && n > 270);
      check('Y12j no per-element width > 270px inside MonthlyEarningsView',
        fixedWidths.length === 0,
        `wide widths found: ${fixedWidths.join(', ')}`);

      // ─ Y12k-n: avg label placement.
      //   The "avg" tag used to sit at right:-52 in the right gutter,
      //   where it collided with the £ scale label sharing its row
      //   (e.g. "avg" overlapping "£2,000"). The chip now sits at the
      //   LEFT end of the dashed line, over a faint solid dark pill,
      //   centred vertically on the line. The right gutter is reserved
      //   exclusively for the gridline £ labels.
      check('Y12k avg label tagged with aria-label="Monthly average" for unique anchor',
        view.includes('aria-label="Monthly average"'));

      // Slice the avg label block out of the view by its aria-label anchor
      // so substring checks don't drift into other chips elsewhere in the
      // view (callout, breakdown panel, day-type chips).
      const avgAnchor = 'aria-label="Monthly average"';
      const avgIdx = view.indexOf(avgAnchor);
      // The opening <div is ~400 chars before the aria-label; "avg"
      // closing text is ~30 chars after. Slice a generous window.
      const avgBlock = avgIdx === -1 ? '' : view.slice(Math.max(0, avgIdx - 600), avgIdx + 80);

      check('Y12l avg chip positioned at LEFT end of dashed line (left: 0)',
        avgBlock.includes('left: 0') && !avgBlock.includes('right: -52'),
        'avg block did not contain `left: 0` or still contained `right: -52`');
      check('Y12m avg chip has faint solid dark pill background (bg-neutral-900 + sky border)',
        avgBlock.includes('bg-neutral-900') &&
        avgBlock.includes('border border-sky-700/40') &&
        avgBlock.includes('rounded'));
      check('Y12n avg chip is sky-coloured + small font',
        avgBlock.includes('text-sky-400') && avgBlock.includes('text-[9px]'));
      check('Y12o avg chip vertically centred on the dashed line',
        avgBlock.includes("transform: 'translateY(-50%)'"));
      check('Y12p avg chip stays above the bars (zIndex 3 > bars zIndex 2)',
        avgBlock.includes('zIndex: 3'));

      // Right gutter exclusivity — the actual CSS-property form
      // `right: -52,` (style-object property with trailing comma) should
      // appear ONCE in the view source (the gridline label inside
      // [0, 0.5, 1].map(...)). If anyone re-adds a control in the right
      // gutter, the count jumps. We require the comma + space form to
      // skip prose mentions of "right:-52" in surrounding comments.
      const rightGutterHits = (view.match(/right: -52,/g) || []).length;
      check('Y12q right gutter has exactly ONE element source-line (gridline £ labels only)',
        rightGutterHits === 1,
        `style "right: -52," occurrences=${rightGutterHits} (expected 1)`);
    }
  }

  // ===== Z. SETTINGS SCREEN SOURCE PRESENCE — Stage 1 regroup =====
  // After the Settings reorganise (You / Tools / Invoicing / Kit room /
  // Expense presets / New-production defaults / Appearance / Data & backup /
  // About & help),
  // assert every userPrefs binding from the pre-regroup inventory still
  // appears inside SettingsScreen, every new group / sub-area label is
  // rendered, every one-off action is still wired, and every old
  // top-level disclosure label is gone. UI structure isn't unit-testable,
  // so this is a pure source-presence guard against silent drops or
  // unbindings during the move.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');
    const startMarker = '    function SettingsScreen(';
    const startIdx = html.indexOf(startMarker);
    check('Z0a SettingsScreen function found in source',
      startIdx !== -1, `startMarker not found`);
    // Find the next top-level function definition (same 4-space indent +
    // capitalised name) to bound the slice.
    const tail = startIdx === -1 ? '' : html.slice(startIdx + startMarker.length);
    const nextMatch = tail.search(/\n    function [A-Z]/);
    check('Z0b SettingsScreen end-of-function marker found',
      nextMatch !== -1, `no following function`);
    const body = startIdx === -1 ? '' :
      html.slice(startIdx, startIdx + startMarker.length + (nextMatch === -1 ? tail.length : nextMatch));

    // ─ Z1: every userPrefs.<key> binding from the inventory must still
    //   appear in the function body — either as `userPrefs.<key>` direct
    //   or as a `<key>:` write inside set({...}) (celebrationEmoji /
    //   Intensity / Speed are written via row.key, and roundingMode /
    //   onboardingComplete are only written through the set helper). ─
    const PREF_BINDINGS = [
      'displayName',
      'defaultDepartment',
      'defaultRole',
      'defaultBDR',
      'vatRegistered',
      'vatRate',
      'vatNumber',
      'legalName',
      'fromCompanyName',
      'fromAddress',
      'fromEmail',
      'bankName',
      'bankAccountName',
      'bankAccountNumber',
      'bankSortCode',
      'bankIBAN',
      'bankSWIFT',
      'invoicePrefix',
      'invoiceNextNumber',
      'paymentTermsDays',
      'logoBase64',
      'defaultMileageRate',
      'defaultKitMoneyEnabled',
      'defaultKitMoneyAmount',
      'defaultPerDiemEnabled',
      'defaultPerDiemAmount',
      'kitInventory',
      'clients',
      'roundingMode',
      'comparisonUnit',
      'customComparison',
      'celebrationEnabled',
      'celebrationEmoji',
      'celebrationIntensity',
      'celebrationSpeed',
      'onboardingComplete',
    ];
    for (const key of PREF_BINDINGS) {
      const hasDirect    = body.includes(`userPrefs.${key}`);
      const hasSetForm   = body.includes(`${key}:`);
      // Celebration sub-keys live in a static {key:'celebrationEmoji', ...}
      // row config, then are read via userPrefs[row.key] / set({[row.key]:...})
      // — so the literal key string is what survives in source.
      const hasQuotedKey = body.includes(`'${key}'`) || body.includes(`"${key}"`);
      check(`Z1 binding userPrefs.${key} still referenced in SettingsScreen`,
        hasDirect || hasSetForm || hasQuotedKey,
        `direct=${hasDirect} set-form=${hasSetForm} quoted=${hasQuotedKey}`);
    }

    // ─ Z2: every new top-level group label must appear as a SectionCard
    //   or Disclosure label exactly where the regroup placed it. ─
    const GROUPS = [
      { label: 'You',                     form: 'SectionCard title="You"' },
      { label: 'Tools',                   form: 'SectionCard title="Tools"' },
      { label: 'Invoicing',               form: 'Disclosure label="Invoicing"' },
      { label: 'Kit room',                form: 'label="Kit room"' },
      { label: 'Expense presets',         form: 'label="Expense presets"' },
      { label: 'New-production defaults', form: 'label="New-production defaults"' },
      { label: 'Appearance',              form: 'Disclosure label="Appearance"' },
      { label: 'Data & backup',           form: 'Disclosure label="Data & backup"' },
      { label: 'About & help',            form: 'Disclosure label="About & help"' },
    ];
    for (const g of GROUPS) {
      check(`Z2 top-level group "${g.label}" present`,
        body.includes(g.form),
        `expected substring: ${g.form}`);
    }

    // ─ Z3: the in-page sub-areas of the Invoicing group are rendered
    //   as sky-uppercase sub-headers (text-sky-500 font-bold mb-2.5). Match
    //   on the exact sub-header markup pattern so we don't false-positive
    //   on incidental occurrences of the word "Logo" / "VAT" elsewhere. ─
    const INVOICING_SUBS = [
      'Your details',
      'VAT',
      'Bank details',
      'Logo',
      'Numbering & terms',
      'Sending & reminders',
      'Send invoices via',
      'Format & export',
      'Saved clients',
    ];
    for (const sub of INVOICING_SUBS) {
      const needle = `text-sky-500 font-bold mb-2.5">${sub}<`;
      check(`Z3 Invoicing sub-area "${sub}" present`,
        body.includes(needle),
        `expected sub-header markup ending with >${sub}<`);
    }

    // ─ Z4: the "stays on your device" reassurance moved into the
    //   Invoicing group footer. Verify the text wasn't dropped. ─
    check('Z4 Invoicing privacy reassurance preserved',
      body.includes("All your invoicing details stay on your device - we don't store or transmit any of this."));

    // ─ Z5: every one-off action still wired up (these are not prefs but
    //   they're in the inventory and must survive the move). ─
    check('Z5a Cancellation calculator launcher (setShowCalc(true))',
      body.includes('setShowCalc(true)'));
    check('Z5b Export backup button bound to onExport',
      body.includes('onClick={onExport}'));
    check('Z5c Restore from backup wired to importRef + handleFileSelect',
      body.includes('importRef.current?.click()') && body.includes('handleFileSelect'));
    check('Z5d Reset all data confirm flow bound to onResetAll',
      body.includes('onConfirm: onResetAll'));
    check('Z5e Re-run setup wizard sets onboardingComplete: false',
      body.includes('onboardingComplete: false'));
    check('Z5f APA Recommended Terms external link present',
      body.includes('https://www.a-p-a.net/apa-crew-terms/'));
    check('Z5g Feedback email link present',
      body.includes('feedback@timemachineapp.co.uk'));
    check('Z5h Celebration Preview button calls fireCelebration({ force: true })',
      body.includes('fireCelebration({ force: true })'));
    check('Z5i Native browser fallback for APA link still wired',
      body.includes("nativeOpenInBrowser('https://www.a-p-a.net/apa-crew-terms/')"));
    check('Z5j Native mailto fallback for feedback link still wired',
      body.includes("nativeOpenUrl('mailto:feedback@timemachineapp.co.uk')"));

    // ─ Z6: every OLD top-level disclosure label is gone. If any of these
    //   reappear, the regroup has been partially reverted. ─
    const REMOVED_TOPLEVEL = [
      'Disclosure label="Tax & Invoicing"',
      'Disclosure label="Invoicing — Your details"',
      'Disclosure label="Invoicing — Bank details"',
      'Disclosure label="Invoicing — Numbering & terms"',
      'Disclosure label="Invoicing — Logo"',
      'SectionCard title="My Setup"',
      'Disclosure label="Defaults for new productions"',
      'Disclosure label="Saved Clients"',
      'Disclosure label="Calculation"',
      'Disclosure label="Display"',
      'Disclosure label="Celebration"',
      'Disclosure label="Data"',
      'Disclosure label="Re-run setup wizard"',
      'Disclosure label="Reference"',
      'Disclosure label="What\'s new"',
      'Disclosure label="About"',
      'Disclosure label="Privacy"',
    ];
    for (const stale of REMOVED_TOPLEVEL) {
      const niceName = stale.split('"')[1];
      check(`Z6 stale top-level "${niceName}" removed`,
        !body.includes(stale),
        `unexpected: ${stale}`);
    }

    // ─ Z7: ConfirmDialog prompt strings preserved verbatim. These are
    //   what the user actually reads, so a drift here is user-visible. ─
    check('Z7a Restore-from-backup prompt preserved',
      body.includes('Restore from backup?'));
    check('Z7b Reset-everything prompt preserved',
      body.includes('Reset everything?'));
    check('Z7c Re-run-setup prompt preserved',
      body.includes('Re-run setup?'));

    // ─ Z8: Storage status card — plain-English persistence (the copy pass
    //   dropped the dev-facing backend / reason readout; the persistent-vs-
    //   best-effort condition and the private-browsing warning are unchanged). ─
    check('Z8a Storage status card — "saved safely" copy for the persistent (granted) state',
      body.includes("Your data's saved safely on this device."));
    check('Z8b Storage status card — "browser could clear it" copy for the best-effort state',
      body.includes("Your data's being saved, but this browser could clear it - keep a backup."));
    check('Z8c Storage status card — private-browsing warning preserved',
      body.includes('Private browsing detected - your data may not be saved when this tab closes. Export a backup before leaving.'));

    // ─ Z9: helpers / data the regroup still depends on — if any of these
    //   stopped being referenced the regroup would render but with empty
    //   selects / lost cascades. ─
    check('Z9a roundingModeOf(userPrefs) read for RoundingModeSelect',
      body.includes('roundingModeOf(userPrefs)'));
    check('Z9b getComparisonSurface(userPrefs) read for Pill comparison',
      body.includes('getComparisonSurface(userPrefs)'));
    check('Z9c DEPARTMENTS still iterated for Default department options',
      body.includes('Object.keys(DEPARTMENTS)'));
    check('Z9d makeDeptRoleHandlers wires dept/role/BDR cascades',
      body.includes('makeDeptRoleHandlers(set, userPrefs)'));
    check('Z9e RELEASE_NOTES still rendered under About & help / What\'s new',
      body.includes('RELEASE_NOTES.added.map') && body.includes('RELEASE_NOTES.version'));

    // ─ Z10: Kit Room Stage 2 row rework — each item is a padded card with
    //   full-width name on line 1, then labelled "Default on new shoots"
    //   toggle (left) and £ rate + × delete (right) on line 2. Bindings
    //   to {id, name, defaultDailyRate, defaultOn} must be intact; add /
    //   remove wires must still spawn / drop items. Stage 3 moved the
    //   editor to the top-level KitRoomEditor component, so we scan the
    //   full file (`html`) instead of the SettingsScreen slice (`body`). ─
    check('Z10a Kit Room: name binding writes via updateKitItem({ name: ... })',
      html.includes('updateKitItem(item.id, { name: e.target.value })'));
    check('Z10b Kit Room: rate binding writes via updateKitItem({ defaultDailyRate: ... })',
      html.includes('updateKitItem(item.id, { defaultDailyRate:'));
    check('Z10c Kit Room: toggle binding writes via updateKitItem({ defaultOn: v })',
      html.includes('updateKitItem(item.id, { defaultOn: v })'));
    check('Z10d Kit Room: addKitItem appends a new {id, name, defaultDailyRate, defaultOn} item',
      html.includes("{ id: uid(), name: \"\", defaultDailyRate: 0, defaultOn: false }"));
    check('Z10e Kit Room: removeKitItem filters by id',
      html.includes('items.filter(it => it.id !== id)'));
    check('Z10f Kit Room: "+ Add kit item" button text + addKitItem onClick wired',
      html.includes('onClick={addKitItem}') && html.includes('Add kit item'));
    check('Z10g Kit Room: "Default on new shoots" labelled-toggle text rendered',
      html.includes('Default on new shoots'));
    check('Z10h Kit Room: per-item card uses bg-neutral-900 border rounded-xl (roomier layout)',
      html.includes('bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-3'));
    check('Z10i Kit Room: name input is full-width inside flex row (Stage 3)',
      html.includes('flex-1 min-w-0 text-sm font-semibold'));
    check('Z10j Kit Room: SettingsScreen renders <KitRoomEditor> with kitInventory + set onChange',
      body.includes('<KitRoomEditor') &&
      body.includes('userPrefs.kitInventory') &&
      body.includes('set({ kitInventory: newItems })'));

    // ─ Z11: dead summary vars from Stage 1 are pruned. If any of these
    //   reappear, someone re-introduced the now-unreferenced summary
    //   computations that the regroup removed. ─
    const PRUNED_VARS = ['vatSummary', 'bankSummary', 'numberingSummary', 'logoSummary'];
    for (const v of PRUNED_VARS) {
      // Look for declaration form `const <name> =` only — the explanatory
      // comment in the source that names all four still mentions them, but
      // an actual re-declaration would be a regression.
      check(`Z11 dead summary var "${v}" not redeclared`,
        !body.includes(`const ${v} =`),
        `unexpected redeclaration of const ${v} =`);
    }

    // ─ Z12: Kit Room Stage 3 drag-to-reorder source presence. The reorder
    //   is exercised by storage round-trip in Z13; here we only verify the
    //   pointer-event surface is wired and the relevant CSS guards are in
    //   place — touch-action:none on the grip + prefers-reduced-motion read. ─
    check('Z12a KitRoomEditor: top-level function defined',
      html.includes('function KitRoomEditor({ items, onChange })'));
    check('Z12b KitRoomEditor: grip SVG (three horizontal lines) rendered',
      html.includes('<line x1="2.5" y1="4"') &&
      html.includes('<line x1="2.5" y1="7"') &&
      html.includes('<line x1="2.5" y1="10"'));
    check('Z12c KitRoomEditor: per-card dragstart hook (onPointerDown=beginDrag)',
      html.includes('onPointerDown={(e) => beginDrag(item.id, e)}'));
    check('Z12d KitRoomEditor: pointermove handler wired (onPointerMove=onDragMove)',
      html.includes('onPointerMove={onDragMove}'));
    check('Z12e KitRoomEditor: pointerup commits (onPointerUp=endDrag(..., true))',
      html.includes('onPointerUp={(e) => endDrag(e, true)}'));
    check('Z12f KitRoomEditor: pointercancel reverts (onPointerCancel=endDrag(..., false))',
      html.includes('onPointerCancel={(e) => endDrag(e, false)}'));
    check('Z12g KitRoomEditor: setPointerCapture so drag survives finger leaving grip',
      html.includes('setPointerCapture(e.pointerId)'));
    check('Z12h KitRoomEditor: touchAction:none on grip (iOS scroll guard)',
      html.includes("touchAction: 'none'"));
    check('Z12i KitRoomEditor: body.style.touchAction/overflow suppressed during drag',
      html.includes("document.body.style.touchAction = 'none'") &&
      html.includes("document.body.style.overflow = 'hidden'"));
    check('Z12j KitRoomEditor: prefers-reduced-motion read for neighbour-slide animation',
      html.includes("'(prefers-reduced-motion: reduce)'"));
    check('Z12k KitRoomEditor: data-kit-card marker for grip→card closest() lookup',
      html.includes('data-kit-card="1"'));
    check('Z12l KitRoomEditor: drop commits through onChange (same path as edits)',
      html.includes('if (!same) onChange(reordered)'));
    check('Z12m KitRoomEditor: drop builds reordered array by-id (ids stable, no rewrites)',
      html.includes('const byId = new Map(items.map(it => [it.id, it]))') &&
      html.includes('.map(id => byId.get(id))'));
  }

  // ===== AA. KIT ROOM REORDER ROUND-TRIP — Stage 3 =====
  // A reordered kitInventory must persist through the same storage path
  // every other userPrefs field uses. The reorder is a pure UI move — no
  // calc, no schema bump — so all we need to verify is:
  //   AA1  the new order is what comes back out of storage
  //   AA2  ids are stable across the reorder (no id rewrites)
  //   AA3  length is unchanged (no items dropped or duplicated)
  //   AA4  each item's name / defaultDailyRate / defaultOn fields survive
  //   AA5  a no-op reorder (same array order) round-trips identically
  // The KitRoomEditor itself writes the new array via onChange, which
  // SettingsScreen wraps as `set({ kitInventory: newItems })` — i.e. the
  // SAME setUserPrefs path as every other edit. So the round-trip we
  // exercise here is `storage.set → storage.get → JSON.parse`.
  {
    const seedItems = [
      { id: 'kit-a', name: 'Sennheiser MKH8060', defaultDailyRate: 75,  defaultOn: true  },
      { id: 'kit-b', name: 'Sound Devices MixPre-6', defaultDailyRate: 50, defaultOn: false },
      { id: 'kit-c', name: 'Boom Pole', defaultDailyRate: 15, defaultOn: true  },
      { id: 'kit-d', name: 'Lav Kit', defaultDailyRate: 30, defaultOn: false },
    ];
    const seedPrefs = {
      displayName: 'Reorder User',
      defaultBDR: 250,
      kitInventory: seedItems,
    };

    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);

    // Seed via the same import path real backups use.
    const importResult = sb.__importBackup(JSON.stringify({
      version: 1,
      schemaVersion: 3,
      productions: [],
      userPrefs: seedPrefs,
    }));
    check('AA0 seed: importBackup ok',
      importResult && importResult.ok === true,
      `result=${JSON.stringify(importResult)}`);

    // Sanity: seed survives the import.
    const beforeStored = JSON.parse(sb.__storage.get('bigals_user_prefs') || 'null');
    check('AA0 seed: kitInventory restored with 4 items in seed order',
      beforeStored && Array.isArray(beforeStored.kitInventory) &&
        beforeStored.kitInventory.length === 4 &&
        beforeStored.kitInventory.map(it => it.id).join(',') === 'kit-a,kit-b,kit-c,kit-d',
      `order=${beforeStored && beforeStored.kitInventory && beforeStored.kitInventory.map(it => it.id).join(',')}`);

    // Simulate a drop: KitRoomEditor's `endDrag(commit=true)` rebuilds the
    // array by looking each id up in the original items via Map.get() —
    // exactly the same shape we simulate here. The new order is committed
    // through onChange → set({ kitInventory: newItems }) → setUserPrefs →
    // storage.set('bigals_user_prefs', ...). Mirror that final write.
    const beforeArr = beforeStored.kitInventory;
    const byId = new Map(beforeArr.map(it => [it.id, it]));
    const reorderedIds = ['kit-c', 'kit-a', 'kit-d', 'kit-b']; // visibly different
    const reordered = reorderedIds.map(id => byId.get(id));
    const nextPrefs = { ...beforeStored, kitInventory: reordered };
    sb.__storage.set('bigals_user_prefs', JSON.stringify(nextPrefs));

    // AA1 — order round-trips verbatim.
    const afterStored = JSON.parse(sb.__storage.get('bigals_user_prefs') || 'null');
    const afterIds = (afterStored && afterStored.kitInventory || []).map(it => it.id);
    check('AA1 reorder: stored order matches the written reorder',
      afterIds.join(',') === reorderedIds.join(','),
      `got=${afterIds.join(',')} expected=${reorderedIds.join(',')}`);

    // AA2 — ids stable across the reorder. The set of ids before and
    // after must be identical (no id rewrites, no missing ids).
    const beforeIds = beforeArr.map(it => it.id);
    const sameIdSet = beforeIds.length === afterIds.length &&
      beforeIds.every(id => afterIds.includes(id));
    check('AA2 reorder: id set unchanged (no id rewrites)',
      sameIdSet,
      `before=${beforeIds.sort().join(',')} after=${afterIds.slice().sort().join(',')}`);

    // AA3 — length is unchanged.
    check('AA3 reorder: array length unchanged (no items dropped or duplicated)',
      (afterStored.kitInventory || []).length === seedItems.length,
      `length=${(afterStored.kitInventory || []).length}`);

    // AA4 — per-item field integrity. Each id maps to the same name /
    //        defaultDailyRate / defaultOn it had before the reorder.
    let allFieldsMatch = true;
    let firstMismatch = null;
    for (const id of beforeIds) {
      const before = beforeArr.find(it => it.id === id);
      const after  = afterStored.kitInventory.find(it => it.id === id);
      const ok = before && after &&
        before.name === after.name &&
        before.defaultDailyRate === after.defaultDailyRate &&
        before.defaultOn === after.defaultOn;
      if (!ok && !firstMismatch) firstMismatch = { id, before, after };
      allFieldsMatch = allFieldsMatch && ok;
    }
    check('AA4 reorder: name / defaultDailyRate / defaultOn survive per-id',
      allFieldsMatch,
      firstMismatch ? `first mismatch at ${firstMismatch.id}: before=${JSON.stringify(firstMismatch.before)} after=${JSON.stringify(firstMismatch.after)}` : 'all fields match');

    // AA5 — no-op reorder (same order) round-trips identically. This mirrors
    //        the editor's "skip persist when order didn't change" check.
    const noopPrefs = { ...afterStored, kitInventory: afterStored.kitInventory.slice() };
    sb.__storage.set('bigals_user_prefs', JSON.stringify(noopPrefs));
    const noopAfter = JSON.parse(sb.__storage.get('bigals_user_prefs') || 'null');
    check('AA5 reorder: no-op rewrite round-trips identically',
      JSON.stringify(noopAfter.kitInventory) === JSON.stringify(afterStored.kitInventory),
      'no-op write differed from prior state');
  }

  // ===== BB. PILL COMPARISON DEFAULT — "off" by default =====
  // The SoloDayPill's compare line (e.g. "= 1,234 Greggs sausage rolls"
  // under the £ amount) is now hidden by default for new users; they
  // pick a comparison deliberately from Settings → Appearance → Pill
  // comparison if they want one. DEFAULT_USER_PREFS.comparisonUnit
  // flipped from "Greggs sausage rolls" to "off"; merge-over-defaults
  // means any existing user's stored value is preserved untouched.
  //
  // Two-axis check:
  //   1) source-presence — the literal in DEFAULT_USER_PREFS is "off"
  //      (catches typos like "OFF", whitespace, or accidental reversion).
  //   2) runtime — a clean sandbox's __DEFAULT_USER_PREFS reads "off",
  //      and an imported backup with a non-"off" pick survives the
  //      merge unscathed (existing explicit selections untouched rule).
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');
    check('BB1 DEFAULT_USER_PREFS.comparisonUnit literal is "off" in source',
      html.includes('comparisonUnit: "off"'),
      'expected substring `comparisonUnit: "off"` in index.html');
    check('BB2 the previous "Greggs sausage rolls" default is no longer assigned to comparisonUnit',
      !html.includes('comparisonUnit: "Greggs sausage rolls"'),
      'the old default is back — should be "off"');

    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);
    const defaults = sb.__DEFAULT_USER_PREFS;
    check('BB3 runtime DEFAULT_USER_PREFS.comparisonUnit === "off"',
      defaults && defaults.comparisonUnit === 'off',
      `got=${defaults && defaults.comparisonUnit}`);

    // BB4-5 — merge-over-defaults preserves an existing user's explicit
    // choice. A backup carrying a non-"off" comparisonUnit must NOT be
    // overwritten back to the new default. This is the load-bearing
    // guarantee: existing users keep whatever they picked (incl. the
    // historical "Greggs sausage rolls" if that's what they actually
    // chose), only NEW users see the clean default.
    const payload = JSON.stringify({
      version: 1,
      schemaVersion: 3,
      productions: [],
      userPrefs: { comparisonUnit: 'pints in London' },
    });
    const r = sb.__importBackup(payload);
    check('BB4 importBackup ok',
      r && r.ok === true,
      `result=${JSON.stringify(r)}`);
    const stored = JSON.parse(sb.__storage.get('bigals_user_prefs') || 'null');
    check('BB5 existing explicit pick survives the default flip',
      stored && stored.comparisonUnit === 'pints in London',
      `stored=${stored && stored.comparisonUnit}`);
  }

  // ===== CC. iOS NATIVE FEEL — Phase A source presence =====
  // Pure source-presence checks for the CSS / config changes that
  // make the WebView stop feeling like a web page: global tap
  // highlight, fast press state, hover-on-real-pointer gating,
  // user-select carve-outs, no-tap-delay, overscroll guard, safe
  // areas, font stack. No runtime sandbox needed — these are CSS /
  // <meta> facts of the source.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ CC1: viewport meta has viewport-fit=cover (so safe-area-inset-*
    //   resolves to actual non-zero values on notched devices). ─
    check('CC1 viewport meta sets viewport-fit=cover',
      /<meta\s+name="viewport"[^>]*viewport-fit=cover/.test(html));

    // ─ CC2: Tailwind hoverOnlyWhenSupported flag — gates every
    //   hover:* utility behind @media (hover: hover). Without this,
    //   hover styles stick highlighted after a touch tap. ─
    check('CC2 tailwind config: future.hoverOnlyWhenSupported = true',
      /future:\s*\{\s*hoverOnlyWhenSupported:\s*true\s*\}/.test(html));

    // ─ CC3: tap highlight transparent globally via universal selector
    //   (not just html, body). Inline overrides still exist as defence
    //   in depth, but new components don't need to re-declare. ─
    check('CC3 universal tap-highlight transparent (*, *::before, *::after)',
      /\*,\s*\*::before,\s*\*::after\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent/.test(html));

    // ─ CC4: press feedback — scale-only, instant press-in, 80ms release.
    //   The rule uses plain type/class selectors (no :where()) so its
    //   specificity beats Tailwind's `.transition-all` + `.active:scale-95`
    //   on Btn. The opacity dim from earlier Phase A was dropped — it
    //   read as a grey flash on the dark UI and stacked oddly on
    //   Settings cards. ─
    check('CC4a press-feedback default transition is TRANSFORM ONLY (no opacity)',
      html.includes('button:not(:disabled):not([aria-disabled="true"]),') &&
      html.includes('transition: transform 80ms ease-out') &&
      // The transition list must NOT include opacity anymore.
      !/transition:\s*transform 80ms ease-out,\s*opacity/.test(html));
    check('CC4b press-feedback selector does NOT use :where() (so specificity beats Btn)',
      !html.includes(':where(button:not(:disabled):not([aria-disabled="true"])'));
    check('CC4c press-feedback :active is scale(0.97) + transition:none only — NO opacity dim',
      /button:not\(:disabled\):not\(\[aria-disabled="true"\]\):active,[\s\S]*?\.tm-press:not\(\[aria-disabled="true"\]\):active\s*\{\s*transform:\s*scale\(0\.97\);\s*transition:\s*none\s*;\s*\}/.test(html));
    check('CC4d press-feedback rule no longer sets opacity 0.88',
      !html.includes('opacity: 0.88'));
    // CC4e — pill nav button custom scale(0.94) + bg flip on :active are
    // intentionally dropped so .tm-pill-nav-btn inherits the universal
    // scale(0.97). Catch a regression where someone re-adds them.
    check('CC4e .tm-pill-nav-btn:active no longer sets a custom transform/bg (universal rule wins)',
      !html.includes('.tm-pill-nav-btn:active:not(:disabled) {') &&
      !html.includes('.tm-pill-nav-btn-add:active:not(:disabled) {'));

    // ─ CC5: app shell — user-select: none + -webkit-touch-callout: none.
    //   Carve-outs below restore both on inputs / textareas / select /
    //   #invoice-print-view / [data-tm-selectable]. ─
    check('CC5a app shell user-select: none on body',
      /body\s*\{[^}]*user-select:\s*none/.test(html));
    check('CC5b app shell -webkit-touch-callout: none on body',
      /body\s*\{[^}]*-webkit-touch-callout:\s*none/.test(html));
    check('CC5c carve-out: inputs + textareas + select keep user-select: text',
      /input,\s*textarea,\s*select[^{]*\{[^}]*user-select:\s*text/.test(html));
    check('CC5d carve-out: #invoice-print-view keeps user-select: text + touch-callout: default',
      /#invoice-print-view[^{]*\{[^}]*user-select:\s*text[\s\S]*-webkit-touch-callout:\s*default/.test(html));
    check('CC5e carve-out: [data-tm-selectable] opt-in hook present for future copyable content',
      /\[data-tm-selectable\][^{]*\{[^}]*user-select:\s*text/.test(html));

    // ─ CC6: inputs >= 16px so iOS never auto-zooms on focus. ─
    check('CC6 input/select/textarea font-size: 16px !important',
      /input,\s*select,\s*textarea\s*\{\s*font-size:\s*16px\s*!important\s*;?\s*\}/.test(html));

    // ─ CC7: touch-action: manipulation on real tap targets — removes
    //   the historical 300ms tap delay + double-tap zoom on buttons. ─
    check('CC7 touch-action: manipulation on interactive elements',
      /button,\s*\[role="button"\],\s*a,\s*label,[\s\S]*?\{[^}]*touch-action:\s*manipulation/.test(html));

    // ─ CC8: overscroll-behavior: none on html, body — kills the
    //   document-level rubber-band that revealed a background. ─
    check('CC8 overscroll-behavior: none on html, body',
      /html,\s*body\s*\{[^}]*overscroll-behavior:\s*none/.test(html));
    check('CC8 inner scroll regions keep overscroll-behavior: contain (native momentum + bounce)',
      html.includes('-webkit-overflow-scrolling: touch') &&
      /overscroll-behavior:\s*contain/.test(html));

    // ─ CC9: safe-area-inset usage — body bottom padding + the various
    //   sticky/fixed chrome paddingTop/Bottom uses. Spot-check the count
    //   so a regression that strips them all would fire here. ─
    const safeAreaCount = (html.match(/var\(--sat\)|var\(--sab\)/g) || []).length;
    check('CC9 safe-area insets (routed through the --sat/--sab vars so native chrome can neutralise them) applied in at least 10 places',
      safeAreaCount >= 10,
      `count=${safeAreaCount} (expected >= 10)`);

    // ─ CC10: font stack leads with -apple-system so iOS picks San
    //   Francisco directly. Mono numerals come from ui-monospace stack
    //   on tm-pill-amount / breakdown numbers (unchanged). ─
    check('CC10 body font stack leads with -apple-system',
      /body\s*\{[^}]*font-family:\s*-apple-system,\s*BlinkMacSystemFont/.test(html));
    check('CC10 mono stack unchanged (ui-monospace, SFMono-Regular, Menlo)',
      html.includes('ui-monospace, SFMono-Regular, Menlo, monospace'));

    // ─ CC11: Stats expandables use grid-template-rows 0fr ↔ 1fr (not
    //   maxHeight) so open and close are symmetric and content-aware.
    //   The old maxHeight: 1200 (TappableCard) / 1600 (hero card) trick
    //   left ~150ms of dead time on close because content was shorter
    //   than the fixed cap; the grid-row technique animates only the
    //   actual row height, so open and close feel equal-time. ─
    check('CC11a grid-template-rows technique in source (open state 1fr, closed state 0fr)',
      html.includes("gridTemplateRows: expanded ? '1fr' : '0fr'") &&
      html.includes("gridTemplateRows: expandedStat === 'hero' ? '1fr' : '0fr'"));
    check('CC11b grid-template-rows transition declared (per-card duration)',
      html.includes("transition: 'grid-template-rows 0.25s ease'") &&
      html.includes("transition: 'grid-template-rows 0.3s ease'"));
    check('CC11c inner row clipped via min-height:0 + overflow:hidden (grid-row collapses cleanly)',
      html.includes('minHeight: 0, overflow: \'hidden\''));
    check('CC11d old maxHeight 1200/1600 ceilings are gone',
      !html.includes('maxHeight: expanded ? 1200 : 0') &&
      !html.includes("maxHeight: expandedStat === 'hero' ? 1600 : 0"));
  }

  // ===== DD. HAPTICS — Phase B source presence + pref round-trip =====
  // Source-presence checks for the @capacitor/haptics wiring: helper shape,
  // both no-op gates (web feature-detect + user toggle), the wired moments
  // (time-wheel selection sequence, Toggle light, segmented selectionChanged,
  // ConfirmDialog danger-tone medium, now-buttons heavy, completions
  // success), the new userPrefs.hapticsEnabled pref + Settings toggle, and
  // a JSON round-trip through the storage adapter so the pref survives
  // import/export. The helper itself never runs against window.Capacitor on
  // web — audit:web stays clean because _hapticsReady() returns null when
  // _capPlugins().Haptics is missing.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ DD1: helper shape ─
    check('DD1a haptic helper declared',
      /const haptic\s*=\s*\{/.test(html));
    for (const method of ['selectionStart', 'selectionChanged', 'selectionEnd', 'light', 'medium', 'heavy', 'success', 'stamp']) {
      check(`DD1b haptic.${method}() defined`,
        new RegExp(`${method}\\s*\\(\\s*\\)\\s*\\{`).test(html));
    }
    // DD1c — stamp() fires heavy(), then setTimeout(heavy()) at ~70ms.
    // The second tap re-evaluates _hapticsReady() so a mid-stamp toggle
    // off respects the master switch.
    check('DD1c haptic.stamp() = heavy() + setTimeout(heavy(), 70)',
      /stamp\(\)\s*\{[\s\S]*?H\.impact\(\{ style: 'HEAVY' \}\)[\s\S]*?setTimeout\([\s\S]*?H2\.impact\(\{ style: 'HEAVY' \}\)[\s\S]*?,\s*70\s*\)/.test(html));
    check('DD1d haptic.stamp() re-evaluates _hapticsReady() inside the setTimeout (mid-stamp toggle-off)',
      /setTimeout\(\(\)\s*=>\s*\{[\s\S]{0,80}const H2 = _hapticsReady\(\)/.test(html));

    // ─ DD2: no-op gates ─
    //   (a) module-scoped _hapticsPrefs.enabled gate (user-toggle off)
    //   (b) _capPlugins().Haptics feature-detect (web / unsupported)
    check('DD2a no-op gate: _hapticsPrefs.enabled early-return in _hapticsReady',
      /function _hapticsReady\(\)\s*\{[\s\S]*?if\s*\(!_hapticsPrefs\.enabled\)\s*return\s*null/.test(html));
    check('DD2b no-op gate: feature-detect via _capPlugins().Haptics',
      /const\s*\{\s*Haptics\s*\}\s*=\s*_capPlugins\(\)/.test(html) &&
      /return\s+Haptics\s*\|\|\s*null/.test(html));
    check('DD2c every helper method goes through _hapticsReady()',
      // Each method's body has `const H = _hapticsReady();` (8 methods).
      // stamp() ALSO has `const H2 = _hapticsReady();` inside its
      // setTimeout, so >= 8 catches a missing gate on any of them.
      (html.match(/const H = _hapticsReady\(\);/g) || []).length >= 8,
      `const H = _hapticsReady() calls=${(html.match(/const H = _hapticsReady\(\);/g) || []).length}`);
    check('DD2d every helper method wraps the plugin call in try/catch',
      // Each method has a `try { H.<plugin call>(); } catch (_) {}` shape;
      // stamp() has 2 (heavy + setTimeout heavy with H2). 8 + 1 = 9.
      (html.match(/try\s*\{\s*H\d?\./g) || []).length >= 9,
      `try{H...} calls=${(html.match(/try\s*\{\s*H\d?\./g) || []).length}`);

    // ─ DD3: Tailwind/native plugin map — each helper method calls the
    //   correct Haptics plugin method (case + arg shape matters because
    //   the native plugin's API surface is fixed). ─
    check('DD3a selectionStart → Haptics.selectionStart()',
      /H\.selectionStart\(\)/.test(html));
    check('DD3b selectionChanged → Haptics.selectionChanged()',
      /H\.selectionChanged\(\)/.test(html));
    check('DD3c selectionEnd → Haptics.selectionEnd()',
      /H\.selectionEnd\(\)/.test(html));
    check('DD3d light → Haptics.impact({ style: \'LIGHT\' })',
      /H\.impact\(\{ style: 'LIGHT' \}\)/.test(html));
    check('DD3e medium → Haptics.impact({ style: \'MEDIUM\' })',
      /H\.impact\(\{ style: 'MEDIUM' \}\)/.test(html));
    check('DD3f heavy → Haptics.impact({ style: \'HEAVY\' })',
      /H\.impact\(\{ style: 'HEAVY' \}\)/.test(html));
    check('DD3g success → Haptics.notification({ type: \'SUCCESS\' })',
      /H\.notification\(\{ type: 'SUCCESS' \}\)/.test(html));

    // ─ DD4: wired moments — each call site present at the expected place. ─

    // 4a — Toggle (component-level): every flip across the app fires light.
    check('DD4a Toggle.onClick fires haptic.light() before onChange',
      /onClick=\{\(\) => \{ if \(disabled\) return; haptic\.light\(\); onChange\(!value\); \}\}/.test(html));

    // 4b — Time-wheel selection sequence (start / changed / end).
    check('DD4b time-wheel selectionStart on first user scroll',
      html.includes('startedRef.current = true;') &&
      html.includes('haptic.selectionStart();'));
    check('DD4c time-wheel selectionChanged on each idx change (gated past programmatic done)',
      // Two call sites — hour and minute columns.
      (html.match(/if \(programmaticDoneRef\.current\) haptic\.selectionChanged\(\);/g) || []).length >= 2);
    check('DD4d time-wheel selectionEnd inside the settle timeout',
      /haptic\.selectionEnd\(\);[\s\S]{0,40}startedRef\.current = false;/.test(html));

    // 4c — Segmented selections use haptic.light() (NOT selectionChanged),
    //   because tap-only sites need a primed generator on iOS — a cold
    //   selectionChanged() silently no-ops. light() is the same reliable
    //   impact the Toggle component already uses.
    check('DD4e Stats filter pills call haptic.light()',
      html.includes('haptic.light(); setFilter(k)'));
    check('DD4f Monthly Earnings 12m/tax toggle calls haptic.light()',
      html.includes('haptic.light(); setMode(k); setSel(null);'));
    check('DD4g Celebration segmented (emoji/intensity/speed) calls haptic.light()',
      html.includes('haptic.light(); set({ [row.key]: o.v });'));
    check('DD4g2 segmented sites NO LONGER fire haptic.selectionChanged() (cold-tap regression guard)',
      !html.includes('haptic.selectionChanged(); setFilter(k)') &&
      !html.includes('haptic.selectionChanged(); setMode(k); setSel(null);') &&
      !html.includes('haptic.selectionChanged(); set({ [row.key]: o.v });'));

    // 4d — Now-buttons.
    //   Wrap (every site) → stamp() (double-heavy).
    //   Lunch (every site) → heavy().
    //   Call (solo editor only — main screen has no Call-now button) → heavy().
    check('DD4h main doWrap (WrapNowBtn) fires haptic.stamp()',
      /const doWrap = \(\) => \{[\s\S]{0,500}haptic\.stamp\(\);/.test(html));
    check('DD4i main doLunch (LunchNowBtn) fires haptic.heavy()',
      /const doLunch = \(\) => \{[\s\S]{0,200}haptic\.heavy\(\);/.test(html));
    check('DD4j dept-defaults handleLunchNow fires haptic.heavy()',
      /const handleLunchNow = \(\) => \{\s*haptic\.heavy\(\);/.test(html));
    check('DD4k dept-defaults handleWrapNow fires haptic.stamp()',
      /const handleWrapNow = \(\) => \{\s*haptic\.stamp\(\);/.test(html));

    // 4d2 — Solo day editor's Call / Wrap / Lunch NOW buttons.
    //   These three were missed in the initial Phase B wire-up. They
    //   live in the per-day form (Call tile + Wrap tile + Lunch tile),
    //   each rendered only when isToday so the NOW chip is present
    //   only on today's day.
    check('DD4o solo editor Call NOW fires haptic.heavy()',
      html.includes('haptic.heavy(); const t = computeNowHHMM(); onCallChange(t);'));
    check('DD4p solo editor Wrap NOW fires haptic.stamp()',
      html.includes("haptic.stamp(); const t = computeNowHHMM(); set({ wrapTime: t });"));
    check('DD4q solo editor Lunch NOW fires haptic.heavy() + marks lunchLogged',
      html.includes("haptic.heavy(); const t = computeNowHHMM(); set({ lunchStartTime: t, lunchLogged: true });"));

    // 4d3 — every Wrap site uses stamp() (cross-check: no Wrap site
    //   leaks back to plain heavy()). The 3 Wrap sites are the only
    //   stamp() call sites.
    const stampCallCount = (html.match(/haptic\.stamp\(\)/g) || []).length;
    check('DD4r exactly 3 haptic.stamp() call sites (main doWrap + dept handleWrapNow + solo Wrap NOW)',
      stampCallCount === 3,
      `haptic.stamp() call sites=${stampCallCount}`);

    // 4e — Solo editor chips (kit money / pre-call / mileage / travel
    //   time / per diem / step-up / expenses). On CLOSE only, AND only
    //   when the chip has a non-empty entry (isSet truthy), fire
    //   haptic.light(). The check sits BEFORE toggleChip() because
    //   toggleChip mutates expandedChips. Opening or closing-empty
    //   stays silent (no buzz on "I dismissed an empty chip").
    check('DD4s chip onClick: closing AND isSet fires haptic.light() before toggleChip',
      /if \(expandedChips\.has\(key\) && isSet\) haptic\.light\(\);[\s\S]{0,80}toggleChip\(key\);/.test(html));

    // 4e — Destructive confirm → medium.
    check('DD4l ConfirmDialog danger tone fires haptic.medium() before onConfirm',
      /if \(confirmTone === 'danger'\) haptic\.medium\(\);/.test(html));

    // 4f — Completions → success.
    check('DD4m markPaid fires haptic.success()',
      /showToast\('Marked as paid'\); haptic\.success\(\);/.test(html));
    check('DD4n sendInvoice fires haptic.success() when status === \'sent\'',
      /if \(frozenPatch && frozenPatch\.status === 'sent'\) haptic\.success\(\);/.test(html));

    // ─ DD5: Settings — pref default + Appearance toggle. ─
    check('DD5a DEFAULT_USER_PREFS.hapticsEnabled defaults to true',
      /hapticsEnabled:\s*true,/.test(html));
    check('DD5b Appearance Haptic feedback toggle binds to userPrefs.hapticsEnabled',
      html.includes('userPrefs.hapticsEnabled !== false') &&
      html.includes('set({ hapticsEnabled: v })'));
    check('DD5c Haptic feedback label rendered in Settings',
      html.includes('>Haptic feedback<'));

    // ─ DD6: Root pref sync — _hapticsPrefs.enabled mirrored from userPrefs. ─
    check('DD6 Root effect mirrors userPrefs.hapticsEnabled into _hapticsPrefs.enabled',
      /_hapticsPrefs\.enabled = !userPrefs \|\| userPrefs\.hapticsEnabled !== false/.test(html));
  }

  // ===== EE. HAPTICS PREF ROUND-TRIP =====
  // The new userPrefs.hapticsEnabled is an additive boolean — no schema
  // bump (DEFAULT_USER_PREFS gets merged below the stored value, so
  // pre-Phase-B backups import to true via default). This block exercises
  // the full storage path: a backup that explicitly sets hapticsEnabled
  // false must round-trip false (not silently flip back to the new
  // default), and a backup with no hapticsEnabled key must come back as
  // true.
  {
    // EE1 — explicit false survives importBackup → storage → JSON round-trip.
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle(50);

    const offPayload = JSON.stringify({
      version: 1,
      schemaVersion: 3,
      productions: [],
      userPrefs: { hapticsEnabled: false },
    });
    const r1 = sb.__importBackup(offPayload);
    check('EE1 importBackup ok',
      r1 && r1.ok === true,
      `result=${JSON.stringify(r1)}`);
    const stored = JSON.parse(sb.__storage.get('bigals_user_prefs') || 'null');
    check('EE1 hapticsEnabled: false explicit value survives import + storage round-trip',
      stored && stored.hapticsEnabled === false,
      `stored.hapticsEnabled=${stored && stored.hapticsEnabled}`);

    // EE2 — pre-Phase-B backup (no hapticsEnabled key) merges to default true.
    const localStorage2 = makeLocalStorage();
    const sb2 = await runApp({ capacitor: undefined, localStorage: localStorage2 });
    await settle(50);
    const legacyPayload = JSON.stringify({
      version: 1,
      schemaVersion: 3,
      productions: [],
      userPrefs: { displayName: 'Legacy' },
    });
    const r2 = sb2.__importBackup(legacyPayload);
    check('EE2 legacy import ok',
      r2 && r2.ok === true,
      `result=${JSON.stringify(r2)}`);
    const stored2 = JSON.parse(sb2.__storage.get('bigals_user_prefs') || 'null');
    check('EE2 pre-Phase-B backup: hapticsEnabled defaults to true via merge',
      stored2 && stored2.hapticsEnabled === true,
      `stored2.hapticsEnabled=${stored2 && stored2.hapticsEnabled}`);

    // EE3 — DEFAULT_USER_PREFS.hapticsEnabled is exposed and true.
    const defaults = sb2.__DEFAULT_USER_PREFS;
    check('EE3 runtime DEFAULT_USER_PREFS.hapticsEnabled === true',
      defaults && defaults.hapticsEnabled === true,
      `defaults.hapticsEnabled=${defaults && defaults.hapticsEnabled}`);
  }

  // ===== FF. SWIPE-TO-DELETE ROW — source presence =====
  // A NEW trigger for the existing delete action. Source-presence checks
  // verify the gesture surface is wired correctly and — critically — that
  // it reuses the existing delete handlers / ConfirmDialog instances
  // rather than inventing a parallel delete path. UI gesture itself is
  // dogfooded on device.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ FF1: component declared with the expected signature. ─
    check('FF1a SwipeableRow function defined',
      /function SwipeableRow\(\{ rowId, openRowId, setOpenRowId, isDeletable[\s\S]*?, onTap, onDelete[\s\S]*?, children \}\)/.test(html));
    check('FF1b SWIPE_DELETE_WIDTH constant declared',
      /const SWIPE_DELETE_WIDTH\s*=\s*\d+/.test(html));

    // ─ FF2: pointer handlers + axis-locked swipe wiring. ─
    check('FF2a onPointerDown captures start position + axis flag',
      /onPointerDown[\s\S]*?startX:\s*e\.clientX[\s\S]*?startY:\s*e\.clientY[\s\S]*?axis:\s*null/.test(html));
    check('FF2b onPointerMove axis-locks horizontal vs vertical',
      /d\.axis = Math\.abs\(ddx\) > Math\.abs\(ddy\) \? 'x' : 'y'/.test(html));
    check('FF2c onPointerMove uses setPointerCapture once horizontal axis is locked',
      /setPointerCapture\(e\.pointerId\)/.test(html));
    check('FF2d onPointerMove preventDefault on horizontal swipe (kills page-scroll fight)',
      /d\.axis !== 'x'\) return;[\s\S]{0,300}e\.preventDefault\(\)/.test(html));
    check('FF2e dx clamped to [-W*1.2, 0] (partial reveal only, never auto-delete)',
      /Math\.min\(0, Math\.max\(-SWIPE_DELETE_WIDTH \* 1\.2, d\.startDx \+ ddx\)\)/.test(html));
    check('FF2f onPointerUp snaps at half-button-width threshold',
      /dx < -SWIPE_DELETE_WIDTH \/ 2/.test(html));
    check('FF2g onPointerCancel + onPointerUp both registered on the content layer',
      html.includes('onPointerUp={onPointerUp}') && html.includes('onPointerCancel={onPointerCancel}'));

    // ─ FF3: pan-y on the content layer so vertical list scroll is unaffected. ─
    check('FF3 content layer has touch-action: pan-y (vertical scroll preserved)',
      /touchAction:\s*'pan-y'/.test(html));

    // ─ FF4: one-open-at-a-time semantics. ─
    check('FF4a opening this row sets parent openRowId to rowId',
      /setOpenRowId\(rowId\);[\s\S]{0,50}setDx\(-SWIPE_DELETE_WIDTH\)/.test(html));
    check('FF4b useEffect syncs local dx when parent openRowId changes (closes other rows)',
      /React\.useEffect\(\(\) => \{[\s\S]{0,200}setDx\(isOpen \? -SWIPE_DELETE_WIDTH : 0\)/.test(html));
    check('FF4c tap on a different row while another is open → closes the other',
      /openRowId != null && openRowId !== rowId[\s\S]{0,80}setOpenRowId\(null\)/.test(html));

    // ─ FF5: tap behaviour — plain tap fires onTap, tap-on-open closes,
    //   tap-after-horizontal-swipe is suppressed. ─
    check('FF5a plain tap with no horizontal movement fires onTap',
      /onTap && onTap\(e\)/.test(html));
    check('FF5b movedHorz suppresses the tap click after a swipe',
      /if \(dragRef\.current\.movedHorz\)[\s\S]{0,80}return;/.test(html));
    check('FF5c tapping the open row closes it (no onTap)',
      /if \(isOpen\) \{\s*setOpenRowId\(null\);\s*setDx\(0\);\s*return;\s*\}/.test(html));

    // ─ FF6: prefers-reduced-motion respected on the snap transition. ─
    check('FF6 reduce-motion read + applied to the snap transition',
      html.includes("'(prefers-reduced-motion: reduce)'") &&
      /reduceMotion \? 'none' : 'transform 180ms ease'/.test(html));

    // ─ FF7: eligibility passthrough — isDeletable=false renders a no-swipe
    //   pass-through wrapper, mirroring the existing rule "if the kebab
    //   can't delete it, swipe can't either". ─
    check('FF7 isDeletable=false → pass-through wrapper (no swipe wiring)',
      /if \(!isDeletable\) \{[\s\S]{0,400}<div className=\{className\} onClick=\{onTap\}>\{children\}<\/div>/.test(html));

    // ─ FF8: DELETE REUSE — productions use existing confirmDelete(p)
    //   handler (NOT a parallel impl). Invoice delete uses the existing
    //   onDeleteInvoice handler via a top-level ConfirmDialog whose
    //   strings mirror InvoiceRowActionSheet exactly. ─
    check('FF8a production swipe reuses confirmDelete (existing handler)',
      // 3 production variants (hero / full / compact) → 3 onDelete sites.
      (html.match(/onDelete=\{\(\) => confirmDelete\(p\)\}/g) || []).length >= 3,
      `confirmDelete reuses=${(html.match(/onDelete=\{\(\) => confirmDelete\(p\)\}/g) || []).length}`);
    check('FF8b invoice swipe reuses onDeleteInvoice (existing handler)',
      html.includes('onDeleteInvoice(swipeConfirmDelete.production.id, swipeConfirmDelete.invoice.id)'));
    check('FF8c invoice swipe ConfirmDialog mirrors InvoiceRowActionSheet exactly (title/message/label/tone)',
      html.includes('title="Delete invoice?"') &&
      html.includes('confirmLabel="Delete"') &&
      html.includes('confirmTone="danger"') &&
      /message=\{`Delete \$\{swipeConfirmDelete\.invoice\.invoiceNumber\}\? There's no getting it back\.`\}/.test(html));
    check('FF8d production swipe ConfirmDialog is the existing top-level confirmOpts (no parallel)',
      html.includes('const confirmDelete = (p) => setConfirmOpts({'));

    // ─ ES (surface-2 empty states): NET-NEW filtered-to-zero invoice message.
    //   Shown ONLY when invoices EXIST but the active status filter matches none
    //   (a non-'all' filter) — NOT the first-time-empty case. Lives in both the
    //   per-production list and the global AllInvoicesView. The `filterStatus
    //   !== 'all'` clause is what keeps it off the first-time-empty surface. ─
    check('ES1 filtered-empty invoice message present in BOTH invoice views',
      (html.match(/>No \{filterStatus\} invoices\.<\/div>/g) || []).length >= 2,
      `matches=${(html.match(/>No \{filterStatus\} invoices\.<\/div>/g) || []).length}`);
    check('ES2 per-production filtered-empty guarded on empty filtered list + non-all filter',
      html.includes("filteredInvoices.length === 0 && filterStatus !== 'all'"));
    check('ES3 global filtered-empty guarded on non-all filter + no visible status sections',
      html.includes("filterStatus !== 'all' && !showDrafts && !showOverdue && !showUnpaid && !showPaid"));

    // ─ FF9: existing kebab path is intact (swipe is an addition, not a
    //   replacement). ─
    check('FF9a production kebab still wired to setActionSheet',
      html.includes("setActionSheet(p)"));
    check('FF9b invoice kebab still opens the action sheet (now via openInvoiceActionSheet → setActionSheetTarget)',
      html.includes("openInvoiceActionSheet({ invoice, production })"));
    check('FF9c InvoiceRowActionSheet still uses its internal confirmDelete state (no behavioural change to the menu path)',
      html.includes('const [confirmDelete, setConfirmDelete] = useState(false);') &&
      html.includes('onConfirm={doDelete}'));

    // ─ FF10: 3 production card variants + 1 invoice card variant = 4
    //   SwipeableRow usage sites. ─
    const swipeUsages = (html.match(/<SwipeableRow\b/g) || []).length;
    check('FF10 SwipeableRow rendered at 4 call sites (hero + full + compact production + invoice card)',
      swipeUsages === 4,
      `<SwipeableRow> usages=${swipeUsages}`);

    // ─ FF11: red Delete button label + ITrash icon inside SwipeableRow. ─
    check('FF11 red Delete button rendered inside SwipeableRow with ITrash + "Delete" label',
      /bg-red-600 text-white text-\[12px\] font-bold uppercase[\s\S]{0,800}<ITrash size=\{14\}\/>[\s\S]{0,80}<span>Delete<\/span>/.test(html));

    // ─ FF12: openSwipeRowId state declared in BOTH list components. ─
    check('FF12a ProductionsScreen owns openSwipeRowId state (precedes confirmDelete declaration)',
      /const \[openSwipeRowId, setOpenSwipeRowId\] = useState\(null\);[\s\S]{0,2800}confirmDelete = \(p\)/.test(html));
    check('FF12b AllInvoicesView owns openSwipeRowId + swipeConfirmDelete state',
      /const \[openSwipeRowId, setOpenSwipeRowId\] = useState\(null\);\s*const \[swipeConfirmDelete, setSwipeConfirmDelete\] = useState\(null\);/.test(html));

    // ─ FF13: INTERACTIVE-CONTROL GUARD — a pointerdown that originates on
    //   a nested control (the ⋯ kebab, Lunch/Wrap Now, links, form fields)
    //   must NOT engage the swipe. Root cause of the kebab/swipe conflict:
    //   stopPropagation on the control's onClick does nothing to the
    //   pointerdown stream, so the swipe machinery on the content layer
    //   still armed and the slightest jitter revealed the red Delete. The
    //   guard bails (active=false + return) before drag tracking starts. ─
    check('FF13a onPointerDown bails when the pointer starts on an interactive control',
      /const onPointerDown = \(e\) => \{[\s\S]{0,1200}e\.target\.closest\('button, a, input, select, textarea, label'\)\)\s*\{[\s\S]{0,80}dragRef\.current\.active = false;[\s\S]{0,40}return;/.test(html));
    check('FF13b the guard bails BEFORE the drag-start assignment (tap passes straight through, no swipe)',
      /closest\('button, a, input, select, textarea, label'\)[\s\S]{0,120}return;\s*\}\s*dragRef\.current = \{\s*startX: e\.clientX/.test(html));
    check('FF13c guarded branch only does active=false + return — never setDx, so a control tap leaves translate at 0',
      /closest\('button, a, input, select, textarea, label'\)\)\s*\{\s*dragRef\.current\.active = false;\s*return;\s*\}/.test(html));

    // ─ FF14: SHEET-OPEN CLOSES AN OPEN SWIPE ROW — opening either action
    //   sheet first clears openSwipeRowId so a row left swiped open from a
    //   prior gesture is never stranded half-revealed behind the sheet.
    //   Both list screens route every kebab through a helper that does
    //   setOpenSwipeRowId(null) before showing the sheet. ─
    check('FF14a productions: openActionSheet clears the swipe row before opening the sheet',
      /const openActionSheet = \(p\) => \{ setOpenSwipeRowId\(null\); setActionSheet\(p\); \};/.test(html));
    check('FF14b all 3 production kebabs route through openActionSheet (no direct setActionSheet(p) at a kebab)',
      (html.match(/openActionSheet\(p\)/g) || []).length >= 3 &&
      !/e\.stopPropagation\(\); setActionSheet\(p\)/.test(html),
      `openActionSheet(p) sites=${(html.match(/openActionSheet\(p\)/g) || []).length}`);
    check('FF14c invoices: openInvoiceActionSheet clears the swipe row before opening the sheet',
      /const openInvoiceActionSheet = \(target\) => \{ setOpenSwipeRowId\(null\); setActionSheetTarget\(target\); \};/.test(html));
    check('FF14d invoice kebab routes through openInvoiceActionSheet (not a direct setActionSheetTarget)',
      html.includes('openInvoiceActionSheet({ invoice, production })') &&
      !/e\.stopPropagation\(\); setActionSheetTarget\(\{ invoice, production \}\)/.test(html));

    // ─ FF15: DELETE BUTTON LEFT-CORNER RADIUS — the red reveal was rounded
    //   on its right (container overflow-hidden clip) but square on the
    //   left, looking lopsided. rounded-l-xl rounds the left to match. ─
    check('FF15 swipe Delete button has rounded-l-xl (consistently rounded, not square-on-the-left)',
      /className="absolute right-0 top-0 bottom-0 rounded-l-xl bg-red-600 text-white text-\[12px\]/.test(html));

    // ─ FF16: ACTION HIDDEN AT REST — the real fix for the "red peeking at
    //   rest" bleed. The red button is permanently in the DOM behind the
    //   foreground; relying on the rounded, GPU-promoted card to *cover* it
    //   left a sub-pixel red fringe at the clipped rounded right corners that
    //   showed with no drag at all (so the kebab tap "revealed" it and it
    //   "stayed peeking" after a swipe). The button is now fully hidden
    //   (visibility:hidden + pointer-events:none) at rest and only painted in
    //   the gap a leftward translate opens (dx < 0). Combined with the
    //   useEffect that resets dx→0 whenever the row is not open, clearing
    //   openSwipeRowId on sheet-open force-closes the row immediately. ─
    check('FF16a actionVisible derived strictly from a leftward translate (dx < 0)',
      /const actionVisible = dx < 0;/.test(html));
    check('FF16b Delete button is visibility:hidden at rest, visible only when actionVisible',
      /visibility: actionVisible \? 'visible' : 'hidden'/.test(html));
    check('FF16c Delete button is non-interactive at rest (pointer-events gated on actionVisible)',
      /pointerEvents: actionVisible \? 'auto' : 'none'/.test(html));
    check('FF16d sheet-open force-closes the row: useEffect resets dx→0 whenever the row is not open',
      /React\.useEffect\(\(\) => \{\s*if \(!dragRef\.current\.active\) setDx\(isOpen \? -SWIPE_DELETE_WIDTH : 0\);\s*\}, \[isOpen\]\)/.test(html));
    check('FF16e the at-rest hide is gated on dx (not on isOpen alone) — a residual/partial offset can never strand red',
      // actionVisible MUST track dx, so any dx===0 (the only at-rest value)
      // hides the button regardless of stale open state.
      /const actionVisible = dx < 0;/.test(html) &&
      !/const actionVisible = isOpen/.test(html));
  }

  // ===== GG. DAY CAROUSEL — source presence =====
  // Replaces the old animPhase exit/enter state machine that re-rendered
  // DayEntryForm mid-flight (the documented CC jank source) with a windowed
  // [prev, current, next] horizontal carousel. The slide's load-bearing
  // property is "commit-after-settle" — currentDayId only changes after the
  // CSS snap finishes, so DayEntryForm doesn't reconcile during the slide.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ GG1: component declared with forwardRef + imperative API. ─
    check('GG1a DayCarousel declared as React.forwardRef (with onAddDay added in HH)',
      /const DayCarousel\s*=\s*React\.forwardRef\(function DayCarousel\(\{ days, currentDayId, setCurrentDayId,\s*onAddDay,\s*renderDay \}, ref\)/.test(html));
    check('GG1b DayCarousel exposes snapPrev / snapNext / jumpTo via useImperativeHandle',
      /React\.useImperativeHandle\(ref,\s*\(\) => \(\{[\s\S]{0,500}snapPrev[\s\S]{0,500}snapNext[\s\S]{0,500}jumpTo/.test(html));

    // ─ GG2: windowed mount [prev, current, next] keyed by day.id. ─
    check('GG2a windowDays uses safeIdx ± 1 (trimmed at list edges)',
      /if \(safeIdx > 0\) out\.push\(days\[safeIdx - 1\]\);[\s\S]{0,200}out\.push\(days\[safeIdx\]\);[\s\S]{0,200}if \(safeIdx < days\.length - 1\) out\.push\(days\[safeIdx \+ 1\]\)/.test(html));
    check('GG2b windowDays mapped to <div key={day.id}> children (stable identity → React reuses mounts on window shift)',
      /windowDays\.map\(day => \{[\s\S]{0,300}<div\s+key=\{day\.id\}/.test(html));

    // ─ GG3: translate3d on the track. ─
    check('GG3a track transform uses translate3d (GPU promotion)',
      /transform: `translate3d\(calc\(\$\{basePercent\}% \+ \$\{dragDelta\}px\), 0, 0\)`/.test(html));
    check('GG3b track has will-change: transform (compositor layer)',
      /willChange: 'transform'/.test(html));

    // ─ GG4: pointer-event swipe with axis-lock + pan-y + setPointerCapture. ─
    check('GG4a touch-action: pan-y on the carousel container',
      /<div\s+ref=\{containerRef\}[\s\S]{0,200}touchAction: 'pan-y'/.test(html));
    check('GG4b axis-lock chooses between x/y on first significant movement',
      /d\.axis = Math\.abs\(ddx\) > Math\.abs\(ddy\) \? 'x' : 'y'/.test(html));
    check('GG4c horizontal axis triggers setPointerCapture',
      /if \(d\.axis === 'x'\) \{\s*try \{ e\.currentTarget\.setPointerCapture\(e\.pointerId\)/.test(html));
    check('GG4d horizontal drag preventDefault (kills page-scroll fight)',
      /d\.axis !== 'x'\) return;[\s\S]{0,200}e\.preventDefault\(\)/.test(html));
    check('GG4e pointer handlers wired to container (down/move/up/cancel)',
      /onPointerDown=\{onPointerDown\}[\s\S]{0,200}onPointerMove=\{onPointerMove\}[\s\S]{0,200}onPointerUp=\{onPointerUp\}[\s\S]{0,200}onPointerCancel=\{onPointerCancel\}/.test(html));

    // ─ GG5: snap thresholds (velocity flick OR 1/3-width drag) +
    //   edge rubber-band resistance. ─
    check('GG5a flick threshold + distance threshold drive snap direction',
      /velocity < -DAY_CAROUSEL_FLICK_VELOCITY \|\| dragDelta < -distanceThreshold/.test(html) &&
      /velocity > DAY_CAROUSEL_FLICK_VELOCITY \|\| dragDelta > distanceThreshold/.test(html));
    check('GG5b distanceThreshold = trackW / 3',
      /const distanceThreshold = trackW \/ 3/.test(html));
    check('GG5c edge rubber-band when swiping past first/last (first-back still uses EDGE_RESIST; last-fwd now uses ADD_DAY_RESIST when onAddDay is wired, EDGE_RESIST otherwise)',
      // The single OR'd condition was split into branches when add-day
      // over-pull arrived (HH). The first-day backward still uses
      // EDGE_RESIST, and there's still a last-day-forward EDGE_RESIST
      // fallback path when no onAddDay is wired.
      /atFirst && delta > 0\) \{\s*delta = delta \* DAY_CAROUSEL_EDGE_RESIST/.test(html) &&
      /atLast && delta < 0\) \{[\s\S]{0,200}delta = delta \* DAY_CAROUSEL_EDGE_RESIST/.test(html));
    check('GG5d DAY_CAROUSEL constants declared (FLICK_VELOCITY, EDGE_RESIST, SNAP_DURATION)',
      /const DAY_CAROUSEL_FLICK_VELOCITY[\s\S]{0,200}const DAY_CAROUSEL_SNAP_DURATION[\s\S]{0,200}const DAY_CAROUSEL_EDGE_RESIST/.test(html));

    // ─ GG6: commit-after-settle (not mid-gesture) — load-bearing
    //   invariant that removes the jank. ─
    check('GG6a animateSnap stages targetDayId in pendingCommitRef, NOT calling setCurrentDayId',
      /animateSnap[\s\S]{0,400}pendingCommitRef\.current = targetDayId[\s\S]{0,200}setAnimating\(true\)[\s\S]{0,100}setDragDelta\(dir \* trackW\)/.test(html));
    check('GG6b transitionend commits currentDayId AFTER the snap finishes (commit-after-settle)',
      // The HH add-day branch was added BEFORE the existing
      // pendingCommitRef branch — bump the window to clear it.
      /onTransitionEnd = \(e\) => \{[\s\S]{0,1500}pendingCommitRef\.current[\s\S]{0,400}setCurrentDayId\(newDayId\)/.test(html));
    check('GG6c onPointerMove does NOT call setCurrentDayId (no mid-gesture commit)',
      // The only setCurrentDayId call inside the carousel comes from
      // onTransitionEnd or jumpTo. Movement just updates dragDelta.
      // Search the carousel body for any other setCurrentDayId invocation.
      (() => {
        const startIdx = html.indexOf('const DayCarousel = React.forwardRef(function DayCarousel');
        const endIdx = html.indexOf('function SoloDayPage', startIdx);
        if (startIdx < 0 || endIdx < 0) return false;
        const body = html.slice(startIdx, endIdx);
        // setCurrentDayId calls inside the carousel:
        //  1. animateSnap's fallback when trackW not measured yet
        //  2. onTransitionEnd's commit
        //  3. jumpTo's instant recentre
        // Must NOT appear inside onPointerMove.
        const moveStart = body.indexOf('const onPointerMove');
        if (moveStart < 0) return false;
        const moveEnd = body.indexOf('const onPointerUp', moveStart);
        const moveBody = body.slice(moveStart, moveEnd);
        return !moveBody.includes('setCurrentDayId(');
      })());

      // ─ GG7: React.memo wraps DayEntryForm with custom comparator. ─
    check('GG7a DayEntryForm wrapped in React.memo (NOT a plain function declaration)',
      /const DayEntryForm = React\.memo\(function DayEntryFormImpl/.test(html));
    check('GG7b memo comparator compares value / crew / production / userPrefs etc by identity',
      /prev\.value === next\.value[\s\S]{0,400}prev\.crew === next\.crew[\s\S]{0,400}prev\.production === next\.production[\s\S]{0,400}prev\.userPrefs === next\.userPrefs/.test(html));
    check('GG7c memo comparator INTENTIONALLY excludes onChange and showToast',
      /onChange and showToast are intentionally excluded/.test(html) &&
      !/prev\.onChange === next\.onChange/.test(html));

    // ─ GG8: chevron + day-jump drive the SAME carousel via ref. ─
    check('GG8a SoloDayPage owns carouselRef',
      /const carouselRef = useRef\(null\)/.test(html));
    check('GG8b goPrev / goNext call carouselRef.current.snapPrev/snapNext',
      /const goPrev = \(\) => carouselRef\.current && carouselRef\.current\.snapPrev\(\)/.test(html) &&
      /const goNext = \(\) => carouselRef\.current && carouselRef\.current\.snapNext\(\)/.test(html));
    check('GG8c handleDayJump uses snapPrev/Next for adjacent + jumpTo for far',
      /handleDayJump = \(newDayId\) =>[\s\S]{0,400}carouselRef\.current\.snapNext\(\)[\s\S]{0,200}carouselRef\.current\.snapPrev\(\)[\s\S]{0,200}carouselRef\.current\.jumpTo\(newDayId\)/.test(html));
    check('GG8d <DayCarousel ref={carouselRef} ... /> rendered in SoloDayPage with renderDay (onAddDay added in HH)',
      /<DayCarousel\s+ref=\{carouselRef\}\s+days=\{sortedDays\}\s+currentDayId=\{currentDayId\}\s+setCurrentDayId=\{setCurrentDayId\}\s+onAddDay=\{addDay\}\s+renderDay=\{/.test(html));

    // ─ GG9: prefers-reduced-motion respected on snap transition. ─
    check('GG9 reduce-motion read + applied to snap transition (transition:none when set)',
      html.includes("'(prefers-reduced-motion: reduce)'") &&
      /reduceMotion \? 'none' : `transform \$\{DAY_CAROUSEL_SNAP_DURATION\}ms cubic-bezier/.test(html));

    // ─ GG10: old animPhase exit/enter machine is GONE. Catches a partial
    //   revert that re-adds any of those state-name variables. ─
    check('GG10a animPhase state removed',
      !html.includes('const [animPhase, setAnimPhase]'));
    check('GG10b animDirection state removed',
      !html.includes('const [animDirection, setAnimDirection]'));
    check('GG10c pendingDayId state removed',
      !html.includes('const [pendingDayId, setPendingDayId]'));
    check('GG10d triggerDaySwitch helper removed',
      !html.includes('const triggerDaySwitch = (direction'));
    check('GG10e stageClass derived class removed',
      !html.includes('const stageClass = `tm-day-stage'));
    check('GG10f .tm-day-stage CSS class definition removed from <style>',
      !/\.tm-day-stage\s*\{/.test(html));

    // ─ GG11: per-slot onChange writes through its OWN day.id (load-
    //   bearing — without this, swiping mid-edit would commit to the
    //   wrong day). ─
    check('GG11 renderDay closure builds a per-day onChange keyed to day.id (routed through applySoloWrapIntent — the solo wrap-edit intent)',
      /const dayOnChange = \(updatedDay\) => \{\s*setDays\(prev => prev\.map\(d => d\.id === day\.id \? applySoloWrapIntent\(d, updatedDay\) : d\)\);\s*\}/.test(html));

    // ─ GG12: swipe surface fills the panel height (NOT content-sized).
    //   Without this, the area below collapsed chips falls outside the
    //   pointer-handler region and swipes started there silently miss.
    //   The floor is the .tm-day-carousel class: web keeps the fixed
    //   `calc(100dvh - 11rem)` estimate; under native chrome it subtracts
    //   the REAL bar/pill clearances (--tm-native-top + the pill calc) so an
    //   empty solo day exactly fills the page content box (zero overscroll)
    //   yet still grows past the floor when the form gets tall. ─
    check('GG12a carousel root uses the tm-day-carousel floor class (web 11rem; native = real chrome vars)',
      /className="relative overflow-hidden tm-day-carousel"/.test(html) &&
      /\.tm-day-carousel\s*\{\s*min-height:\s*calc\(100dvh\s*-\s*11rem\)/.test(html) &&
      /body\.tm-native\s+\.tm-day-carousel\s*\{\s*min-height:\s*calc\(100dvh\s*-\s*var\(--tm-native-top\)\s*-\s*max\(var\(--sab\),\s*var\(--tm-native-bottom\)\)\s*-\s*80px\)/.test(html));
    check('GG12b carousel floor class is on the SAME JSX element as the onPointerDown handler',
      // Cross-check that the floor class is on the SAME div that owns the
      // pointer handlers — not on an inner wrapper that the handlers
      // would never see.
      /className="[^"]*tm-day-carousel[^"]*"[\s\S]{0,200}onPointerDown=\{onPointerDown\}/.test(html));
  }

  // ===== HH. DAY CAROUSEL ADD-DAY (over-pull) — source presence =====
  // A NEW trigger for the existing addDay handler. The deliberate arm
  // threshold + commit-only-when-armed ensures a casual swipe at the
  // end can't accidentally add a day. Source presence verifies the
  // gesture surface is wired correctly AND that no parallel add path
  // was introduced — the swipe just calls SoloDayPage's existing
  // addDay (which appends current+1 + flips setCurrentDayId).
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ HH1: tuning constants exist, AND the arm threshold is
    //   DELIBERATELY larger than the normal snap threshold (1/3 width).
    //   Without this gap, a quick swipe at the last day could fire add. ─
    check('HH1a DAY_CAROUSEL_ADD_DAY_RESIST constant declared',
      /const DAY_CAROUSEL_ADD_DAY_RESIST\s*=\s*0\.5/.test(html));
    check('HH1b DAY_CAROUSEL_ADD_ARM_FRACTION constant declared (0.58)',
      /const DAY_CAROUSEL_ADD_ARM_FRACTION\s*=\s*0\.58/.test(html));
    check('HH1c arm fraction is DELIBERATELY > normal snap threshold (1/3)',
      // 0.58 vs the existing distanceThreshold of trackW / 3 (~0.333).
      0.58 > 1 / 3);

    // ─ HH2: the swipe reuses SoloDayPage's EXISTING addDay handler.
    //   The carousel accepts it as the `onAddDay` prop and SoloDayPage
    //   passes its existing addDay function. NO parallel add path. ─
    check('HH2a DayCarousel signature accepts onAddDay prop',
      /function DayCarousel\(\{ days, currentDayId, setCurrentDayId,\s*onAddDay,\s*renderDay \},\s*ref\)/.test(html));
    check('HH2b SoloDayPage passes existing addDay as onAddDay',
      /<DayCarousel[\s\S]{0,300}onAddDay=\{addDay\}/.test(html));
    check('HH2c addDay handler unchanged — still appends current+1 and flips setCurrentDayId',
      /const addDay = \(\) => \{[\s\S]{0,1500}setDays\(prev => \[\.\.\.prev, augmented\]\);\s*setCurrentDayId\(augmented\.id\);/.test(html));
    check('HH2d the SoloDayPill\'s onAdd still reaches the SAME addDay (one source of truth)',
      // Direct `onAdd={addDay}` was replaced with an arrow that routes
      // through carouselRef.current.animateAddDay() (FIX 2 — for the
      // animated slide) and falls back to addDay() if the ref isn't
      // ready. animateAddDay's transitionend calls onAddDay (which
      // SoloDayPage passes as addDay). So both surfaces still reach
      // the same handler — no parallel add path was introduced. The
      // fallback's direct addDay() call AND the animateAddDay path
      // (via onAddDay → addDay) both end at the same function.
      html.includes('carouselRef.current.animateAddDay()') &&
      html.includes('addDay();') &&
      html.includes('onAddDay={addDay}'));

    // ─ HH3: arm + commit logic only fires for last-day-forward pull. ─
    check('HH3a isLastForwardPull guard (atLast && delta < 0 && typeof onAddDay === "function")',
      /const isLastForwardPull = atLast && delta < 0 && typeof onAddDay === 'function'/.test(html));
    check('HH3b first-day backward pull keeps original rubber-band (EDGE_RESIST)',
      /atFirst && delta > 0\) \{\s*delta = delta \* DAY_CAROUSEL_EDGE_RESIST/.test(html));
    check('HH3c last-day forward uses softer ADD_DAY_RESIST (not edge rubber-band)',
      /isLastForwardPull\) \{\s*delta = delta \* DAY_CAROUSEL_ADD_DAY_RESIST/.test(html));
    check('HH3d arm fires only when isLastForwardPull AND RAW pull > armThreshold',
      // The arm check measures the RAW finger distance (|ddx|), NOT the
      // post-resistance dragDelta. Measuring on |delta| with the 0.5
      // resistance would require ~1.16 × trackW of finger travel to arm,
      // which is unreachable in a single swipe (the bug the fix
      // addressed).
      /const rawPull = Math\.abs\(ddx\);\s*if \(isLastForwardPull && rawPull > addArmThresholdPx\)/.test(html));
    check('HH3d2 arm threshold is NOT measured against post-resistance delta (regression guard)',
      // The previous bug: arm gated on |delta| > addArmThresholdPx. After
      // the fix, no such pattern should exist anywhere in the source.
      !/Math\.abs\(delta\) > addArmThresholdPx/.test(html));

    // ─ HH4: commit only fires on release WHILE ARMED. A pull that crosses
    //   the threshold but is dragged back below it before release must
    //   spring back, not add. armedRef is reset when |delta| drops below
    //   the threshold in onPointerMove. ─
    check('HH4a armedRef tracks arm transitions; haptic.light() once per arm',
      /if \(!armedRef\.current\) \{\s*armedRef\.current = true;\s*haptic\.light\(\);\s*setAddDayArmed\(true\);/.test(html));
    check('HH4b armedRef resets when dragged back below the threshold',
      /\} else if \(armedRef\.current\) \{\s*armedRef\.current = false;\s*setAddDayArmed\(false\)/.test(html));
    check('HH4c onPointerUp commits ONLY when armedRef.current at release time',
      /if \(atLast && armedRef\.current && typeof onAddDay === 'function'\) \{[\s\S]{0,400}pendingAddDayRef\.current = true/.test(html));
    check('HH4d non-armed release at last-day-forward falls through to spring-back (no add)',
      // The normal-snap branch is gated on !atLast for forward, so an
      // unarmed forward release on the LAST day reaches the
      // "else animateSpringBack()" branch.
      /\&\& !atLast/.test(html));

    // ─ HH5: snap-to-new-day is a deferred commit at transitionend.
    //   Sequencing: pendingAddDayRef set → dragDelta animates to -trackW
    //   → transitionend fires haptic.medium() and calls onAddDay(). The
    //   addDay handler then setDays appends the new day and
    //   setCurrentDayId flips to it; window recomputes to put the new
    //   (now-last) day at currentSlotIdx=1, basePercent=-50%, the
    //   freshly-zeroed dragDelta lands the new day at x=0. ─
    check('HH5a armed release sets pendingAddDayRef + animates dragDelta to -trackW',
      /pendingAddDayRef\.current = true;\s*armedRef\.current = false;\s*setAnimating\(true\);\s*setDragDelta\(-trackW\)/.test(html));
    check('HH5b transitionend handles pendingAddDayRef → calls onAddDay() + haptic.medium()',
      /if \(pendingAddDayRef\.current\) \{[\s\S]{0,1500}haptic\.medium\(\);[\s\S]{0,200}if \(typeof onAddDay === 'function'\) onAddDay\(\)/.test(html));
    check('HH5c commit batch zeroes dragDelta + clears armed visual state',
      /pendingAddDayRef\.current = false;\s*setAnimating\(false\);\s*setDragDelta\(0\);\s*setAddDayArmed\(false\)/.test(html));

    // ─ HH6: arm + commit haptics (the user feels both moments). ─
    check('HH6a haptic.light() fires on arm transition',
      /armedRef\.current = true;\s*haptic\.light\(\);/.test(html));
    check('HH6b haptic.medium() fires on commit (inside transitionend\'s pendingAddDayRef branch)',
      /pendingAddDayRef\.current = false;[\s\S]{0,200}haptic\.medium\(\)/.test(html));

    // ─ HH7: the affordance is rendered ONLY at the last day. ─
    check('HH7a affordance renders only when safeIdx === days.length - 1',
      /safeIdx === days\.length - 1 && typeof onAddDay === 'function' && \(/.test(html));
    check('HH7b affordance sits off-screen right via left:100% + translates at 2× dragDelta (raw-pull speed), capped at -trackW (readability fix)',
      // The 2× multiplier makes the affordance track the user's RAW
      // finger speed (the track itself has 0.5 resistance), so the
      // visible strip at the arm point is ≈58% of the container
      // instead of ≈29% — enough room for the full label. The
      // Math.max cap at -trackW means it never runs past fully
      // visible (no overshoot during the snap-advance).
      /left:\s*'100%',[\s\S]{0,300}transform: `translate3d\(\$\{Math\.max\(-trackW, dragDelta \* 2\)\}px, 0, 0\)`/.test(html));
    check('HH7c affordance has pointer-events:none + justify-start anchor (content reads from leading edge)',
      // Switched from justify-center (content stranded at panel centre,
      // off-screen until ~50% reveal) to justify-start with pl-4 so
      // the icon + label sit at the panel's LEFT edge — the part that
      // becomes visible FIRST as the panel slides in.
      /className="absolute top-0 bottom-0 flex items-center justify-start pl-4 pointer-events-none"/.test(html));
    check('HH7d affordance label flips between "Pull to add day" and "Release to add day"',
      html.includes("'Release to add day'") && html.includes("'Pull to add day'"));
    check('HH7e affordance inner card is whitespace-nowrap (label can\'t wrap inside the revealed strip)',
      /whitespace-nowrap/.test(html));

    // ─ HH8: prefers-reduced-motion. The carousel's existing reduceMotion
    //   computation drives BOTH the spring-back and the snap-to-new-day
    //   (same transitionStyle); the affordance's inner scale + colour
    //   transitions are also gated on reduceMotion. ─
    check('HH8a affordance inner transform/transitions skip when reduceMotion',
      /reduceMotion \? 'none' : 'transform 140ms ease, background-color 120ms ease, border-color 120ms ease, color 120ms ease'/.test(html));

    // ─ HH9: programmatic +1 add via animateAddDay() — the carousel
    //   exposes an imperative method that mirrors the armed-swipe
    //   commit path (snap to -trackW, transitionend fires onAddDay).
    //   This is what makes the SoloDayPill's + button slide the new
    //   day in instead of instant-jumping. Both triggers reuse the
    //   same handler (no parallel add). ─
    check('HH9a DayCarousel imperative API exposes animateAddDay',
      /animateAddDay: \(\) => \{[\s\S]{0,400}pendingAddDayRef\.current = true;\s*armedRef\.current = false;\s*setAnimating\(true\);\s*setDragDelta\(-trackW\)/.test(html));
    check('HH9b animateAddDay falls back to instant onAddDay when trackW not measured (no animation drop)',
      /if \(!trackW\) \{ onAddDay\(\); return; \}/.test(html));
    check('HH9c useImperativeHandle deps include trackW and onAddDay (animateAddDay closure stays current)',
      /\}\), \[safeIdx, days, animateSnap, setCurrentDayId, trackW, onAddDay\]\)/.test(html));
    check('HH9d SoloDayPill onAdd no longer calls addDay directly — routes through animateAddDay (animated slide)',
      // The pill's onAdd now triggers carouselRef.current.animateAddDay()
      // first, with a fallback to direct addDay only if the ref isn't
      // ready. Catches a regression where someone reverts to onAdd={addDay}.
      /onAdd=\{\(\) => \{[\s\S]{0,800}carouselRef\.current\.animateAddDay\(\)[\s\S]{0,150}addDay\(\);[\s\S]{0,80}\}\}/.test(html) &&
      !/onAdd=\{addDay\}/.test(html));
    check('HH9e animateAddDay reuses the EXISTING onAddDay handler (no parallel add path)',
      // animateAddDay sets pendingAddDayRef and lets transitionend call
      // onAddDay() — same code path as the armed-swipe release. No
      // separate setDays/setCurrentDayId logic.
      /animateAddDay: \(\) => \{[\s\S]{0,500}if \(typeof onAddDay !== 'function'\) return;[\s\S]{0,300}pendingAddDayRef\.current = true/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // II — Phase D Wave 1 (Sheet primitive + 8 routed overlays)
  //
  // A single reusable bottom-Sheet replaces the eight hand-rolled
  // `fixed inset-0 flex items-end sm:items-center` overlays. The sheet
  // provides: slide-up transform, grabber, swipe-down dismiss with
  // ~1/3-height threshold + downward-flick (~500 px/s) shortcut,
  // backdrop tap-to-dismiss, Escape close (topmost only), per-instance
  // z-index stacking (no fight when overlays layer), prefers-reduced-
  // motion fallback, lockBodyScroll while mounted, dismiss-guard prop
  // (Wave-2 forms), and safe-area-inset-bottom padding.
  //
  // These assertions are SOURCE-PRESENCE — they don't render the React
  // tree; they grep index.html for the structural markers that prove
  // each piece is still wired. If a refactor breaks any of them the
  // audit fails loudly before a commit lands.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ II1: Sheet primitive itself ─
    check('II1a Sheet component is defined',
      /function Sheet\(\{ open, onClose,[^}]{0,300}\}\) \{/.test(html));
    check('II1b _sheetStack module-scoped array tracks open sheets',
      /const _sheetStack = \[\];/.test(html));
    check('II1c SHEET_BASE_Z constant 60 + zSlot * 10 z-index slotting',
      /const SHEET_BASE_Z = 60;/.test(html) &&
      /SHEET_BASE_Z \+ zSlot \* 10/.test(html));
    check('II1d spring easing constant for open/close transition',
      /SHEET_OPEN_TRANSITION = 'transform 320ms cubic-bezier\(0\.32, 0\.72, 0, 1\)'/.test(html));
    check('II1e ~1/3-height dismiss threshold constant',
      /SHEET_DISMISS_HEIGHT_FRACTION = 1 \/ 3/.test(html));
    check('II1f downward-flick velocity threshold ≈ 500 px/s',
      /SHEET_FLICK_VELOCITY = 0\.5; \/\/ px\/ms downward = 500 px\/s/.test(html));
    check('II1g axis-lock distance constant (matches SwipeableRow pattern)',
      /SHEET_DRAG_AXIS_PX = 6;/.test(html));

    // ─ II2: behaviour wiring inside Sheet ─
    check('II2a Sheet calls lockBodyScroll/unlockBodyScroll while mounted',
      /function Sheet\([\s\S]{0,4000}lockBodyScroll\(\);[\s\S]{0,200}return \(\) => \{ unlockBodyScroll\(\); \};/.test(html));
    check('II2b Sheet registers prefers-reduced-motion via matchMedia',
      /function Sheet\([\s\S]{0,4000}matchMedia\(['"]\(prefers-reduced-motion: reduce\)['"]\)/.test(html));
    check('II2c Sheet uses translate3d on the card (GPU layer)',
      /function Sheet\([\s\S]{0,10000}translate3d\(0, \$\{[^}]+\}px, 0\)/.test(html));
    check('II2d Sheet escape handler gated on topmost stack id (no double-close on stacked sheets)',
      /function Sheet\([\s\S]{0,8000}_sheetStack\[_sheetStack\.length - 1\] !== idRef\.current/.test(html));
    check('II2e Sheet backdrop tap dismisses via tryDismiss (honours onBeforeDismiss)',
      /function Sheet\([\s\S]{0,8000}tryDismiss = React\.useCallback/.test(html) &&
      /if \(typeof onBeforeDismiss === 'function'\)/.test(html));
    check('II2f Sheet sets touchAction pan-y only when swipeDismiss',
      // Anchor inside the Sheet function (it's ~9.4KB so widen the window).
      /function Sheet\([\s\S]{0,12000}touchAction: swipeDismiss \? 'pan-y' : undefined/.test(html));
    check('II2g Sheet card pads safe-area-inset-bottom (routed through --sab + the native bottom-bar clearance)',
      /function Sheet\([\s\S]{0,12000}calc\(max\(var\(--sab\), var\(--tm-native-bottom\)\) \+ 16px\)/.test(html));
    check('II2h Sheet stack push/splice in mount/unmount effect (per-instance id)',
      /function Sheet\([\s\S]{0,4000}_sheetStack\.push\(id\)/.test(html) &&
      /_sheetStack\.splice\([\s\S]{0,80}1\)/.test(html));

    // ─ II3: the 8 overlays now render through <Sheet> ─
    //   Each check confirms (a) the Sheet wrapper is present at the
    //   overlay's call-site and (b) the legacy "fixed inset-0 flex
    //   items-end sm:items-center" + manual backdrop scaffold was
    //   removed at that site (so future refactors can't silently
    //   regress to the hand-rolled overlay).
    check('II3a Production kebab action sheet routes through <Sheet>',
      /<Sheet\s+open=\{!!actionSheet\}\s+onClose=\{\(\) => setActionSheet\(null\)\}/.test(html));
    check('II3b SoloDayPage day-actions sheet routes through <Sheet>',
      /<Sheet\s+open=\{showDayActions\}\s+onClose=\{\(\) => setShowDayActions\(false\)\}\s+title="Day actions"/.test(html));
    check('II3c InvoiceRowActionSheet routes through <Sheet> (delete-confirm now on top — see JJ7)',
      // Wave-1 routed the sheet itself; Wave-2/decision #5 moved the
      // delete-confirm onto a centred alert ABOVE the sheet (the old
      // in-frame `if (confirmDelete) return <ConfirmDialog>` swap is gone —
      // JJ7 owns the on-top behaviour).
      /function InvoiceRowActionSheet\([\s\S]{0,3000}<Sheet open onClose=\{onClose\} title=\{invoice\.invoiceNumber\}>/.test(html) &&
      !/function InvoiceRowActionSheet\([\s\S]{0,2000}if \(confirmDelete\) \{[\s\S]{0,500}<ConfirmDialog open/.test(html));
    check('II3d LineItemActionSheet routes through <Sheet>',
      /function LineItemActionSheet\([\s\S]{0,1500}<Sheet open onClose=\{onClose\}>/.test(html));
    check('II3e DayJumpSheet routes through <Sheet> (maxWidth 480)',
      /function DayJumpSheet\([\s\S]{0,2000}<Sheet open=\{open\} onClose=\{onClose\} maxWidth=\{480\}>/.test(html));
    check('II3f ProductionPickerSheet routes through <Sheet>',
      /function ProductionPickerSheet\([\s\S]{0,2500}<Sheet open onClose=\{onClose\}>/.test(html));
    check('II3g CalcBreakdownView share/export menu routes through <Sheet>',
      /<Sheet open=\{showShareMenu\} onClose=\{\(\) => setShowShareMenu\(false\)\}>/.test(html));
    check('II3h SoloDayPage export sheet routes through <Sheet>',
      /<Sheet open=\{showExportSheet\} onClose=\{\(\) => setShowExportSheet\(false\)\}>/.test(html));

    // ─ II4: regression guards — hand-rolled overlay markers gone from
    //   the 8 wrapped sites. We can't blanket-ban the
    //   "items-end sm:items-center" pattern because Wave-2 forms +
    //   ConfirmDialog + ProductionSettingsSheet legitimately keep
    //   theirs for now. Instead we check the unique state-name pairs
    //   that anchored each wrapped site's old wrapper.
    check('II4a Production kebab no longer wraps {actionSheet && (<div className="fixed inset-0...">)}',
      !/\{actionSheet && \(\s*<div className="fixed inset-0/.test(html));
    check('II4b SoloDayPage day-actions sheet no longer hand-rolls a backdrop',
      !/\{showDayActions && \(\s*<div className="fixed inset-0/.test(html));
    check('II4c CalcBreakdownView share menu no longer hand-rolls a backdrop',
      !/\{showShareMenu && \(\s*<div className="fixed inset-0/.test(html));
    check('II4d SoloDayPage export sheet no longer hand-rolls a backdrop',
      !/\{showExportSheet && \(\s*<div className="fixed inset-0/.test(html));

    // ─ II5: forward-compat wiring for Wave 2 / Wave 3 ─
    //   The Sheet props that Wave 2 forms (edit/cancel guard) and
    //   Wave 3 (stacked pickers inside ProductionSettingsSheet) need
    //   must already be wired in Wave 1 so the later commits are
    //   additive, not a rebuild of the primitive.
    check('II5a Sheet exposes onBeforeDismiss prop (Wave-2 dismiss guard hook)',
      /function Sheet\(\{ open, onClose, onBeforeDismiss/.test(html));
    check('II5b Sheet exposes swipeDismiss prop (default true, opt-out for sticky forms)',
      /function Sheet\([^)]{0,400}swipeDismiss = true/.test(html));
    check('II5c Sheet uses per-instance idRef + zSlot — stack-safe (Wave-3 layered sheets)',
      /function Sheet\([\s\S]{0,4000}const idRef = React\.useRef\(null\)/.test(html) &&
      /function Sheet\([\s\S]{0,4000}const \[zSlot, setZSlot\] = React\.useState\(0\)/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // JJ — Phase D Wave 2 part 1 (centred iOS alert: ConfirmDialog)
  //
  // ConfirmDialog is now a proper centred alert, not a bottom sheet:
  // dimmed backdrop, rounded card, title + optional message, iOS-stacked
  // buttons (destructive red on top, Cancel below). Dismissal is
  // BUTTON-ONLY — no backdrop-tap, no Escape, no swipe (a deliberate
  // change from the old sheet-style dialog which dismissed on both
  // backdrop tap AND Escape). It presents ABOVE any sheet
  // (z=CONFIRM_ALERT_Z) and, while open, bumps _confirmAlertCount so a
  // sheet beneath swallows Escape — letting the InvoiceRowActionSheet
  // delete-confirm sit on top of the action sheet without it closing
  // (decision #5). prefers-reduced-motion appears instantly.
  //
  // Source-presence only — the gesture/animation is dogfooded on device.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ JJ1: centred (NOT a bottom sheet) + presents at CONFIRM_ALERT_Z ─
    check('JJ1a ConfirmDialog backdrop is centred (items-center justify-center), not items-end',
      /className="fixed inset-0 flex items-center justify-center p-4"\s*style=\{\{\s*zIndex: CONFIRM_ALERT_Z/.test(html));
    check('JJ1b ConfirmDialog no longer uses the items-end bottom-sheet alignment',
      !/function ConfirmDialog\([\s\S]{0,4000}items-end/.test(html));

    // ─ JJ2: platform-gated dismissal (Wave 2.2) — native button-only, web
    //   restores backdrop-tap + Escape → onCancel. ─
    check('JJ2a ConfirmDialog never uses the bare useEscape hook (native button-only; web handler is IS_NATIVE-gated below)',
      !/function ConfirmDialog\([\s\S]{0,1400}useEscape\(/.test(html));
    check('JJ2b backdrop tap is IS_NATIVE-gated (native: none; web: onCancel)',
      /onClick=\{IS_NATIVE \? undefined : onCancel\}/.test(html));
    check('JJ2c card stopPropagation is IS_NATIVE-gated (only needed for the web backdrop-dismiss)',
      /onClick=\{IS_NATIVE \? undefined : \(e\) => e\.stopPropagation\(\)\}/.test(html));

    // ─ JJ3: z-slot above any sheet ─
    check('JJ3a CONFIRM_ALERT_Z defined above the sheet band (SHEET_BASE_Z + 900)',
      /const CONFIRM_ALERT_Z = SHEET_BASE_Z \+ 900;/.test(html));
    check('JJ3b the alert renders at CONFIRM_ALERT_Z (higher than any SHEET_BASE_Z + zSlot*10)',
      /zIndex: CONFIRM_ALERT_Z/.test(html));

    // ─ JJ4: prefers-reduced-motion respected (no scale/fade) ─
    check('JJ4a ConfirmDialog reads prefers-reduced-motion',
      /function ConfirmDialog\([\s\S]{0,900}matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(html));
    check('JJ4b reduced motion forces transitions off + renders at the resting state (enter = reduceMotion || visible)',
      /const enter = reduceMotion \|\| visible;/.test(html) &&
      /transition: reduceMotion \? 'none' :/.test(html));
    check('JJ4c entrance is a scale+fade when motion is allowed',
      /transform: enter \? 'scale\(1\)' : 'scale\(0\.96\)'/.test(html) &&
      /opacity: enter \? 1 : 0/.test(html));

    // ─ JJ5: alert registers on a stack; sheets beneath swallow Escape ─
    check('JJ5a ConfirmDialog pushes/splices its id on _confirmAlertStack while open',
      /_confirmAlertStack\.push\(id\)/.test(html) &&
      /_confirmAlertStack\.splice\(/.test(html));
    check('JJ5b Sheet Escape handler bails while an alert is open (alert sits over a sheet without it closing)',
      /if \(e\.key !== 'Escape'\) return;\s*\/\/[\s\S]{0,320}if \(_confirmAlertStack\.length > 0\) return;\s*if \(_sheetStack\[_sheetStack\.length - 1\]/.test(html));

    // ─ JJ6: iOS-stacked buttons — destructive red on top, Cancel below ─
    check('JJ6a buttons are vertically stacked (flex flex-col, not row / not col-reverse)',
      /<div className="flex flex-col gap-2 px-4 pb-5">/.test(html));
    check('JJ6b destructive/primary confirm renders ABOVE the cancel, and danger tone is red',
      /flex flex-col gap-2 px-4 pb-5">[\s\S]{0,900}confirmColors\[confirmTone\][\s\S]{0,500}onClick=\{onCancel\}/.test(html) &&
      /danger: "bg-red-600/.test(html));

    // ─ JJ7: decision #5 — InvoiceRowActionSheet confirm presents ON TOP of
    //   the sheet (not the old in-frame `if (confirmDelete) return …`). ─
    check('JJ7a InvoiceRowActionSheet no longer swaps to the dialog in-frame',
      !/if \(confirmDelete\) \{\s*return \(\s*<ConfirmDialog/.test(html));
    check('JJ7b InvoiceRowActionSheet renders the Sheet AND the ConfirmDialog together (alert on top)',
      /function InvoiceRowActionSheet\([\s\S]{0,4000}<Sheet open onClose=\{onClose\} title=\{invoice\.invoiceNumber\}>[\s\S]{0,3000}<ConfirmDialog\s*open=\{confirmDelete\}/.test(html));
    check('JJ7c the on-top confirm is gated on confirmDelete + keeps the existing doDelete / cancel handlers',
      /<ConfirmDialog\s*open=\{confirmDelete\}[\s\S]{0,400}onConfirm=\{doDelete\}[\s\S]{0,120}onCancel=\{\(\) => setConfirmDelete\(false\)\}/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // KK — Phase D Wave 2.2 (edit-form sheets + discard guard + web-dismiss)
  //
  // Six overlays routed by save-model:
  //   (c) dirty-buffer editors → Sheet WITH a discard guard: DayEditModal,
  //       CrewEditModal, QuickAddCrewSheet. A swipe/backdrop/web-Escape on a
  //       dirty form opens a "Discard changes?" alert (Discard / Keep editing);
  //       clean forms just close. Save/Cancel buttons unchanged.
  //   (b) no-unsaved-buffer editors → Sheet, freely dismissable, NO guard:
  //       CancellationCalcModal (auto-saves; calc untouched), SaveTimesheetsSheet
  //       (ephemeral selection + auto-save email), DuplicateDateDialog.
  // Plus: the centred alert's WEB dismissal restore (Escape + backdrop →
  // onCancel) while native stays button-only, gated on IS_NATIVE.
  //
  // Source-presence only — gesture/scroll behaviour is dogfooded on device.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ KK1: shared discard-guard hook ─
    check('KK1a useDiscardGuard hook defined (returns showDiscard/setShowDiscard/onBeforeDismiss)',
      /const useDiscardGuard = \(isDirty\) => \{[\s\S]{0,400}return \{ showDiscard, setShowDiscard, onBeforeDismiss \};/.test(html));
    check('KK1b guard blocks dismiss when dirty (opens discard alert), allows when clean',
      /onBeforeDismiss = React\.useCallback\(\s*\(\) => \{ if \(isDirty\) \{ setShowDiscard\(true\); return false; \} return true; \}/.test(html));

    // ─ KK2: (c) forms route through Sheet WITH onBeforeDismiss + render a
    //   "Discard changes?" alert (destructive Discard, safe Keep editing). ─
    const cFormGuard = (fn) =>
      new RegExp(`function ${fn}\\(`).test(html) &&
      new RegExp(`function ${fn}\\([\\s\\S]{0,4500}useDiscardGuard\\(dirty\\)`).test(html) &&
      new RegExp(`function ${fn}\\([\\s\\S]{0,9000}<Sheet open onClose=\\{[^}]+\\} onBeforeDismiss=\\{onBeforeDismiss\\}`).test(html);
    const cFormDiscardAlert = (fn) =>
      new RegExp(`function ${fn}\\([\\s\\S]{0,12000}<ConfirmDialog\\s*open=\\{showDiscard\\}[\\s\\S]{0,400}confirmLabel="Discard" confirmTone="danger" cancelLabel="Keep editing"`).test(html);

    check('KK2a DayEditModal → Sheet + onBeforeDismiss guard', cFormGuard('DayEditModal'));
    check('KK2b DayEditModal renders the discard alert (Discard / Keep editing)', cFormDiscardAlert('DayEditModal'));
    check('KK2c CrewEditModal → Sheet + onBeforeDismiss guard', cFormGuard('CrewEditModal'));
    check('KK2d CrewEditModal renders the discard alert (Discard / Keep editing)', cFormDiscardAlert('CrewEditModal'));
    check('KK2e QuickAddCrewSheet → Sheet + onBeforeDismiss guard', cFormGuard('QuickAddCrewSheet'));
    check('KK2f QuickAddCrewSheet renders the discard alert (Discard / Keep editing)', cFormDiscardAlert('QuickAddCrewSheet'));

    // ─ KK3: dirty-tracking — snapshot the buffer on open, compare for dirty ─
    check('KK3a DayEditModal/CrewEditModal compare form to an initial snapshot (JSON)',
      (html.match(/const dirty = JSON\.stringify\(form\) !== JSON\.stringify\(initialRef\.current\);/g) || []).length >= 2);
    check('KK3b QuickAddCrewSheet compares its local fields to the initial snapshot',
      /const dirty = name !== initialRef\.current\.name[\s\S]{0,200}email !== initialRef\.current\.email;/.test(html));
    check('KK3c the discard alert confirm closes the form (onConfirm → onClose/onCancel), cancel keeps editing',
      (html.match(/onConfirm=\{\(\) => \{ setShowDiscard\(false\); on(?:Close|Cancel)\(\); \}\}/g) || []).length >= 3);

    // ─ KK4: (b) forms route through Sheet with NO guard (no onBeforeDismiss) ─
    check('KK4a CancellationCalcModal → Sheet, no guard; calc untouched (no onBeforeDismiss)',
      /function CancellationCalcModal\([\s\S]{0,7000}<Sheet open onClose=\{onClose\} maxWidth=\{1200\}/.test(html) &&
      !/function CancellationCalcModal\([\s\S]{0,9000}onBeforeDismiss/.test(html));
    check('KK4b SaveTimesheetsSheet → Sheet, no guard',
      /function SaveTimesheetsSheet\([\s\S]{0,1500}<Sheet open onClose=\{onClose\}>/.test(html) &&
      !/function SaveTimesheetsSheet\([\s\S]{0,4000}onBeforeDismiss/.test(html));
    check('KK4c DuplicateDateDialog → Sheet, no guard',
      /function DuplicateDateDialog\([\s\S]{0,800}<Sheet open onClose=\{onCancel\} maxWidth=\{400\}>/.test(html) &&
      !/function DuplicateDateDialog\([\s\S]{0,2000}onBeforeDismiss/.test(html));

    // ─ KK5: the routed forms no longer hand-roll their own backdrop /
    //   useEscape / lockBodyScroll (the Sheet owns those now). ─
    check('KK5a CrewEditModal dropped its own lockBodyScroll/useEscape',
      !/function CrewEditModal\([\s\S]{0,1200}useEscape\(onCancel\)/.test(html));
    check('KK5b DayEditModal dropped its own useEscape',
      !/function DayEditModal\([\s\S]{0,2500}useEscape\(onCancel\)/.test(html));
    check('KK5c CancellationCalcModal dropped its own useEscape',
      !/function CancellationCalcModal\([\s\S]{0,1200}useEscape\(onClose\)/.test(html));
    check('KK5d none of the routed forms keep the old items-end backdrop scaffold',
      !/function (DayEditModal|CrewEditModal|CancellationCalcModal)\([\s\S]{0,6000}fixed inset-0 z-50 flex items-end/.test(html));

    // ─ KK6: WEB-DISMISS RESTORE on the centred alert (Escape + backdrop →
    //   onCancel), topmost-only, native stays button-only. ─
    check('KK6a alert wires a WEB-only Escape handler, gated on !IS_NATIVE',
      /if \(!open \|\| IS_NATIVE\) return;\s*const onKey = \(e\) => \{[\s\S]{0,200}onCancel && onCancel\(\);/.test(html));
    check('KK6b web Escape responds only when THIS alert is topmost on the stack',
      /if \(_confirmAlertStack\[_confirmAlertStack\.length - 1\] !== idRef\.current\) return;\s*onCancel && onCancel\(\);/.test(html));
    check('KK6c web backdrop tap → onCancel; native gets neither (IS_NATIVE-gated)',
      /onClick=\{IS_NATIVE \? undefined : onCancel\}/.test(html));

    // ─ KK7: the two invoice modals are now routed through <Sheet> (Wave 2
    //   final pair — see the MM suite). They no longer hand-roll their own
    //   centred modal / useEscape. ─
    check('KK7a DiscountModal no longer hand-rolls its own modal (useEscape/fixed-inset gone)',
      !/function DiscountModal\([\s\S]{0,200}useEscape\(onClose\)/.test(html) &&
      !/function DiscountModal\([\s\S]{0,2500}fixed inset-0 flex items-center justify-center"/.test(html));
    check('KK7b LineEditModal no longer hand-rolls its own modal (useEscape/fixed-inset gone)',
      !/function LineEditModal\([\s\S]{0,260}useEscape\(onClose\)/.test(html) &&
      !/function LineEditModal\([\s\S]{0,3000}fixed inset-0 flex items-center justify-center"/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // LL — Phase D Wave 3 (Production cluster: native sheets + stacking)
  //
  // The three remaining hand-rolled bottom sheets are routed through the
  // Sheet component, and the stacking model is demonstrated on a REAL
  // parent/child pair: CrewActionSheet (parent) + its email editor (child
  // ON TOP). ProductionSettingsSheet stays a full-screen page (untouched).
  //
  // Stacking model (reuses Wave-1 Sheet infra: _sheetStack + per-instance
  // zIndex + onBeforeDismiss):
  //   • child opens at a higher z-slot with its OWN backdrop, covering parent;
  //   • child swipe/backdrop dismisses ONLY the child (parent remains);
  //   • the PARENT's swipe-down is disabled while a child is open
  //     (Sheet.onPointerDown bails unless topmost in _sheetStack);
  //   • dismissing the parent tears down the whole stack;
  //   • the child email editor is a dirty buffer → discard guard.
  //
  // Source-presence only — the gesture/stack feel is dogfooded on device.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ LL1: the Sheet stacking PRIMITIVE — only the topmost sheet may swipe ─
    check('LL1a Sheet.onPointerDown bails unless this sheet is topmost in _sheetStack (parent swipe disabled under a child)',
      /const onPointerDown = \(e\) => \{\s*if \(!swipeDismiss\) return;[\s\S]{0,400}if \(_sheetStack\[_sheetStack\.length - 1\] !== idRef\.current\) return;/.test(html));

    // ─ LL2: CrewActionSheet parent routes through <Sheet> (old hand-rolled
    //   items-end backdrop + in-frame email swap are gone). ─
    check('LL2a CrewActionSheet parent renders through <Sheet open onClose={onClose}>',
      /function CrewActionSheet\([\s\S]{0,1200}<Sheet open onClose=\{onClose\}>/.test(html));
    check('LL2b old in-frame email swap removed (no `if (emailEditing) return` early branch)',
      !/function CrewActionSheet\([\s\S]{0,1200}if \(emailEditing\) \{/.test(html));
    check('LL2c CrewActionSheet no longer hand-rolls its own items-end backdrop',
      !/function CrewActionSheet\([\s\S]{0,2500}fixed inset-0 z-50 flex items-end/.test(html));

    // ─ LL3: the email editor is a CHILD sheet ON TOP, gated on emailEditing,
    //   with its own backdrop (a second <Sheet>) + a discard guard. ─
    check('LL3a email child is a second <Sheet>, gated on emailEditing, with onBeforeDismiss',
      /\{emailEditing && \(\s*<Sheet open onClose=\{\(\) => setEmailEditing\(false\)\} onBeforeDismiss=\{onBeforeDismiss\}/.test(html));
    check('LL3b CrewActionSheet renders exactly two <Sheet> (parent + child)',
      (() => {
        const m = html.match(/function CrewActionSheet\(([\s\S]*?)\n    function /);
        const body = m ? m[1] : '';
        return (body.match(/<Sheet\b/g) || []).length === 2;
      })());
    check('LL3c email child holds a dirty buffer → useDiscardGuard(emailDirty)',
      /const emailDirty = emailDraft !== \(crewMember\?\.email \|\| ''\);/.test(html) &&
      /const \{ showDiscard, setShowDiscard, onBeforeDismiss \} = useDiscardGuard\(emailDirty\);/.test(html));
    check('LL3d dirty child dismiss shows the discard alert (Discard / Keep editing); confirm closes only the child',
      /<ConfirmDialog\s*open=\{showDiscard\}[\s\S]{0,300}confirmLabel="Discard" confirmTone="danger" cancelLabel="Keep editing"[\s\S]{0,200}onConfirm=\{\(\) => \{ setShowDiscard\(false\); setEmailEditing\(false\); \}\}/.test(html));

    // ─ LL4: child dismiss closes ONLY the child (parent stays); dismissing
    //   the parent tears down the whole stack. ─
    check('LL4a child onClose closes only the child (setEmailEditing(false)) — parent <Sheet> stays mounted',
      /<Sheet open onClose=\{\(\) => setEmailEditing\(false\)\}/.test(html));
    check('LL4b parent onClose is the caller onClose — dismissing it unmounts the whole CrewActionSheet (stack torn down)',
      /function CrewActionSheet\([\s\S]{0,1200}<Sheet open onClose=\{onClose\}>/.test(html) &&
      // the parent Cancel button + Sheet both route to onClose
      /function CrewActionSheet\([\s\S]{0,3000}onClick=\{onClose\}[\s\S]{0,400}<\/Sheet>/.test(html));

    // ─ LL5: the two ExportTab pickers route through <Sheet>, no guard. ─
    check('LL5a WeekPickerSheet routes through <Sheet open={open}> (no onBeforeDismiss)',
      /function WeekPickerSheet\([\s\S]{0,800}<Sheet open=\{open\} onClose=\{onClose\} maxWidth=\{420\}>/.test(html) &&
      !/function WeekPickerSheet\([\s\S]{0,1500}onBeforeDismiss/.test(html));
    check('LL5b CrewPickerSheet routes through <Sheet open={open}> (no onBeforeDismiss)',
      /function CrewPickerSheet\([\s\S]{0,500}<Sheet open=\{open\} onClose=\{onClose\} maxWidth=\{420\}>/.test(html) &&
      !/function CrewPickerSheet\([\s\S]{0,1500}onBeforeDismiss/.test(html));
    check('LL5c both pickers dropped their own lockBodyScroll/useEscape (Sheet owns them)',
      !/function WeekPickerSheet\([\s\S]{0,400}useEscape/.test(html) &&
      !/function CrewPickerSheet\([\s\S]{0,400}useEscape/.test(html));

    // ─ LL6: ProductionSettingsSheet stays a full-screen page (NOT a Sheet) ─
    check('LL6 ProductionSettingsSheet remains a full-screen page (min-h-screen), not routed through <Sheet>',
      /function ProductionSettingsSheet\([\s\S]{0,3500}<div className="min-h-screen bg-neutral-950/.test(html) &&
      (() => {
        const m = html.match(/function ProductionSettingsSheet\(([\s\S]*?)\n    function /);
        return m ? !/<Sheet\b/.test(m[1]) : false;
      })());

    // ─ LL7: device-test fix 1 — Sheet retracts the soft keyboard on dismiss
    //   so swipe/backdrop dismiss cleanly with an input focused. General to
    //   ALL input-bearing sheets (the blur lives in the Sheet component). ─
    check('LL7a Sheet defines blurActiveInput (blurs a focused INPUT/TEXTAREA/SELECT)',
      /const blurActiveInput = \(\) => \{[\s\S]{0,250}\/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/[\s\S]{0,80}\.blur\(\)/.test(html));
    check('LL7b tryDismiss blurs the active input BEFORE onBeforeDismiss (keyboard retracts; dirty guard still fires + alert reachable)',
      /const tryDismiss = React\.useCallback\(\(\) => \{[\s\S]{0,200}blurActiveInput\(\);\s*if \(typeof onBeforeDismiss === 'function'\)/.test(html));
    check('LL7c a downward swipe (axis lock = y) blurs the active input so the drag has room to pass the threshold',
      /if \(d\.axis === 'y'\) \{[\s\S]{0,200}setPointerCapture\(e\.pointerId\)[\s\S]{0,400}blurActiveInput\(\);/.test(html));

    // ─ LL8: device-test fix 2 — Best Boy mobile day-view top bar is fully
    //   opaque (bg-black on the safe-area-inset-top sticky div), so scrolled
    //   content can't bleed through the status-bar strip. ─
    check('LL8 Best Boy mobile header: bg-black on the safe-area-inset-top sticky bar (no see-through status-bar strip)',
      /<div className="sticky top-0 z-40 bg-black" style=\{\{ paddingTop: 'var\(--sat\)' \}\}>\s*<div className="border-b border-sky-500 bg-black">\s*<div className="max-w-6xl mx-auto px-4 pt-3 pb-3\.5">/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // MM — Phase D Wave 2 final pair (DiscountModal + LineEditModal → Sheet)
  //
  // The last two invoice-editor modals are routed through <Sheet>, both
  // opening as bottom sheets over the full-screen invoice editor (a route,
  // not a sheet — no parent-sheet stacking).
  //   DiscountModal  → (b) freely dismissable, NO guard.
  //   LineEditModal  → (c) discard guard via onBeforeDismiss; dirty compares
  //                    the editable five-field buffer only (amount-from-rate
  //                    auto-compute untouched).
  // Both are input-bearing, so they inherit the Sheet's keyboard-up dismiss
  // (blurActiveInput on swipe/backdrop) — swipe/backdrop/Cancel close cleanly
  // with the keyboard up; LineEdit still guards when dirty.
  //
  // Source-presence only — gesture/keyboard feel is dogfooded on device.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ MM1: DiscountModal (b) — Sheet, no guard, content preserved ─
    check('MM1a DiscountModal routes through <Sheet open onClose={onClose} maxWidth={400}>',
      /function DiscountModal\([\s\S]{0,1200}<Sheet open onClose=\{onClose\} maxWidth=\{400\}>/.test(html));
    check('MM1b DiscountModal has NO discard guard (freely dismissable)',
      !/function DiscountModal\([\s\S]{0,2500}onBeforeDismiss/.test(html));
    check('MM1c DiscountModal preserves the units-to-bill input + Waive/Apply + Remove waiver',
      /value=\{dqty\} onChange=\{\(e\) => setDqty\(e\.target\.value\)\}/.test(html) &&
      /onClick=\{\(\) => onSave\(isFixed \? 0 : parsedQty\)\}/.test(html) &&
      /onClick=\{\(\) => onSave\(null\)\}>Remove waiver/.test(html));

    // ─ MM2: LineEditModal (c) — Sheet + discard guard ─
    check('MM2a LineEditModal routes through <Sheet … onBeforeDismiss={onBeforeDismiss} maxWidth={420}>',
      /function LineEditModal\([\s\S]{0,1700}<Sheet open onClose=\{onClose\} onBeforeDismiss=\{onBeforeDismiss\} maxWidth=\{420\}>/.test(html));
    check('MM2b LineEditModal dirty = editable five-field buffer vs on-open snapshot (computedAmount NOT compared)',
      /const initialRef = React\.useRef\(\{ label, detail, qty, rate, amount \}\);/.test(html) &&
      /const dirty = label !== initialRef\.current\.label[\s\S]{0,260}amount !== initialRef\.current\.amount;/.test(html) &&
      /const \{ showDiscard, setShowDiscard, onBeforeDismiss \} = useDiscardGuard\(dirty\);/.test(html));
    check('MM2c LineEditModal renders the discard alert (Discard / Keep editing); confirm closes, cancel keeps editing',
      /function LineEditModal\([\s\S]{0,4200}<ConfirmDialog\s*open=\{showDiscard\}[\s\S]{0,300}confirmLabel="Discard" confirmTone="danger" cancelLabel="Keep editing"[\s\S]{0,200}onConfirm=\{\(\) => \{ setShowDiscard\(false\); onClose\(\); \}\}/.test(html));
    check('MM2d LineEditModal keeps amount-auto-computes-from-rate untouched (computedAmount = hasRate ? qty×rate : …)',
      /const computedAmount = hasRate \? parsedQty \* parsedRate : parseFloat\(amount\) \|\| 0;/.test(html));

    // ─ MM3: both dropped their own modal scaffold; Sheet owns scroll-lock +
    //   Escape + keyboard-up dismiss (no per-modal keyboard handling). ─
    check('MM3a neither modal hand-rolls the old fixed-inset centred backdrop anymore',
      !/function DiscountModal\([\s\S]{0,2500}fixed inset-0 flex items-center justify-center"/.test(html) &&
      !/function LineEditModal\([\s\S]{0,3000}fixed inset-0 flex items-center justify-center"/.test(html));
    check('MM3b keyboard-up dismiss is inherited from the Sheet (blurActiveInput in tryDismiss + axis-lock — see LL7), not re-implemented per modal',
      /const blurActiveInput = \(\) => \{/.test(html) &&
      !/function DiscountModal\([\s\S]{0,2500}blurActiveInput/.test(html) &&
      !/function LineEditModal\([\s\S]{0,3000}blurActiveInput/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // NN — Invoice export, Stage 1 (formatters + format/rounding prefs +
  //      single-invoice export). READ-ONLY over invoices; figures are
  //      RECOMPUTED at the chosen export rounding by reusing
  //      buildInvoiceLineItems with a roundingMode override (engine never
  //      edited — audit:build's 84 byte-identical scenarios prove that).
  //      Favourable is NEVER an export mode. Source-presence only.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ NN1: the two prefs default with NO migration (merge-over-defaults) ─
    check('NN1a invoiceExportFormat defaults to timemachine in DEFAULT_USER_PREFS',
      /const DEFAULT_USER_PREFS = \{[\s\S]{0,4000}invoiceExportFormat: 'timemachine',/.test(html));
    check('NN1b invoiceExportRounding pref is REMOVED — no separate export-rounding pref anywhere',
      !/invoiceExportRounding/.test(html));
    check('NN1c useStoredState merges defaults over stored object — existing users gain the new keys with no migration',
      /v = \{ \.\.\.initial, \.\.\.v \};/.test(html));
    const _dupNN = (html.match(/const DEFAULT_USER_PREFS = \{[\s\S]*?\n    \};/) || [''])[0];
    check('NN1d default rounding resolves to exact — DEFAULT_USER_PREFS pins no rounding override; roundingModeOf falls through to exact',
      _dupNN.length > 0 &&
      !/roundingMode:/.test(_dupNN) &&
      !/favourableRounding: true/.test(_dupNN) &&
      !/apaRounding: true/.test(_dupNN) &&
      /o\?\.roundingMode \?\? \(o\?\.favourableRounding \? 'favourable' : o\?\.apaRounding \? 'apa' : 'exact'\)/.test(html));

    // ─ NN2: figures recomputed at the SELECTED mode; favourable NEVER used ─
    check('NN2a invoiceExportFigures recomputes via buildInvoiceLineItems with a roundingMode OVERRIDE (engine reused, not edited)',
      /function invoiceExportFigures\([\s\S]{0,400}buildInvoiceLineItems\(\{ \.\.\.production, roundingMode: mode \}, userPrefs, invoice\.userCrewId\)/.test(html));
    check('NN2b CSV export computes at the invoice roundingMode, coercing favourable→exact, clamped to apa|exact',
      /const INVOICE_EXPORT_ROUNDING_VALUES = \['apa', 'exact'\];/.test(html) &&
      /const frozen = roundingModeOf\(invoice\);\s*const want = frozen === 'favourable' \? 'exact' : frozen;\s*const mode = INVOICE_EXPORT_ROUNDING_VALUES\.includes\(want\) \? want : 'exact';/.test(html));
    check('NN2c favourable is never a stored export rounding value — list is apa/exact (favourable coerces to exact on the export path; see OO)',
      /const INVOICE_EXPORT_ROUNDING_VALUES = \['apa', 'exact'\];/.test(html) &&
      !/INVOICE_EXPORT_ROUNDING_VALUES = \[[^\]]*favourable/.test(html));
    check('NN2d subtotal/VAT for export come from invoiceSubtotal + invoiceVAT (VAT 0 unless vatRegistered)',
      /function invoiceExportFigures\([\s\S]{0,400}invoiceSubtotal\(lines\)[\s\S]{0,120}invoiceVAT\(invoice, subtotal\)/.test(html));

    // ─ NN3: fidelity guard — recompute at the FROZEN mode, compare to stored;
    //   surface (don't silently export) on mismatch. ─
    check('NN3a invoiceExportReproducesSent recomputes at the invoice OWN frozen mode + compares net line amounts to the stored snapshot',
      /function invoiceExportReproducesSent\([\s\S]{0,300}roundingMode: frozenMode[\s\S]{0,300}getLineTotal/.test(html));
    check('NN3b handleExport runs the guard and surfaces a mismatch (setExportWarn) instead of exporting',
      /const handleExport = \(\) => \{[\s\S]{0,300}if \(!invoiceExportReproducesSent\(invoice, production, userPrefs\)\) \{ setExportWarn\(true\); return; \}/.test(html));
    check('NN3c diverging invoice shows the "Source changed since sent" alert; confirm exports, cancel aborts',
      /<ConfirmDialog\s*open=\{exportWarn\}[\s\S]{0,200}title="Source changed since sent"[\s\S]{0,400}onConfirm=\{\(\) => \{ setExportWarn\(false\); doExportFile\(\); \}\}/.test(html));

    // ─ NN4: each formatter emits the agreed column set ─
    check('NN4a Xero headers exactly as agreed',
      /const XERO_INVOICE_HEADERS = \['ContactName','InvoiceNumber','InvoiceDate','DueDate','Reference','Description','Quantity','UnitAmount','AccountCode','TaxType','Currency'\];/.test(html));
    check('NN4b QuickBooks headers in ONE editable place + a VERIFY-against-QBO note',
      /const QBO_INVOICE_HEADERS = \['InvoiceNo','Customer','InvoiceDate','DueDate','Item\(Product\/Service\)','ItemDescription','ItemQuantity','ItemRate','ItemAmount','Taxable','TaxRate'\];/.test(html) &&
      /VERIFY against your QBO/.test(html));
    check('NN4c generic ledger headers (one row per invoice) exactly as agreed',
      /const GENERIC_INVOICE_HEADERS = \['Invoice Number','Status','Issue Date','Due Date','Client','Job','Reference','Role','Shoot Start','Shoot End','Subtotal','VAT','Total','Currency','Date Sent','Date Paid'\];/.test(html));

    // ─ NN5: the cross-cutting rules ─
    check('NN5a 1 × net line rule — Xero Quantity 1 + UnitAmount = net line total; QBO ItemQuantity 1, ItemRate = ItemAmount = net',
      /'1',\s*fmtExportNum\(getLineTotal\(line\)\),/.test(html) &&
      /const net = fmtExportNum\(getLineTotal\(line\)\);[\s\S]{0,400}'1', net, net,/.test(html));
    check('NN5b contact = invoice.toName (Xero ContactName / QBO Customer)',
      /function formatInvoiceXeroCsv\([\s\S]{0,300}invoice\.toName \|\| ''/.test(html) &&
      /function formatInvoiceQuickBooksCsv\([\s\S]{0,400}invoice\.toName \|\| ''/.test(html));
    check('NN5c currency = GBP, figures carry NO currency symbol (bare toFixed(2))',
      // Xero (Currency column) + generic ledger (Currency column) each emit
      // 'GBP'; QuickBooks intentionally has no Currency column → 2 occurrences.
      /function fmtExportNum\(n\) \{ return \(Number\(n\) \|\| 0\)\.toFixed\(2\); \}/.test(html) &&
      !/function fmtExportNum\([\s\S]{0,80}£/.test(html) &&
      (html.match(/'GBP'/g) || []).length >= 2);
    check('NN5d dates render DD/MM/YYYY via fmtExportDate',
      /function fmtExportDate\(iso\)[\s\S]{0,200}`\$\{m\[3\]\}\/\$\{m\[2\]\}\/\$\{m\[1\]\}`/.test(html));

    // ─ NN6: single-invoice wiring + delivery + Settings selects ─
    check('NN6a timemachine keeps the existing PDF path (setPrintTarget); other formats produce a file artifact',
      /const handleExport = \(\) => \{\s*const fmt = [\s\S]{0,160}if \(fmt === 'timemachine'\) \{ setPrintTarget\(invoice\); return; \}/.test(html) &&
      /const art = invoiceExportArtifact\(invoice, production, userPrefs\);\s*if \(!art\) \{ setPrintTarget\(invoice\); return; \}/.test(html));
    check('NN6b deliverTextFile — native nativeSaveAndShare (utf8) + web Blob download',
      /async function deliverTextFile\([\s\S]{0,200}IS_NATIVE\) return nativeSaveAndShare\(filename, content, \{ encoding: 'utf8'[\s\S]{0,200}new Blob\(\[content\][\s\S]{0,200}a\.download = filename/.test(html));
    check('NN6c sensible per-format filenames (TM-INV-…-xero.csv etc.)',
      /-xero\.csv`/.test(html) && /-quickbooks\.csv`/.test(html) && /-ledger\.csv`/.test(html));
    check('NN6d Settings → Invoicing → Accounting export: format Select + single RoundingModeSelect on userPrefs.roundingMode (favourable greyed for CSV formats)',
      /set\(\{ invoiceExportFormat: e\.target\.value \}\)/.test(html) &&
      /INVOICE_EXPORT_FORMATS\.map\(/.test(html) &&
      /<RoundingModeSelect\s+value=\{roundingModeOf\(userPrefs\)\}\s+onChange=\{\(m\) => set\(\{ roundingMode: m \}\)\}\s+disableFavourable=\{invoicingEnabled\(userPrefs\) && INVOICE_EXPORT_CSV_FORMATS\.includes\(userPrefs\.invoiceExportFormat\)\}/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // OO — One rounding control (userPrefs.roundingMode), surfaced in Invoicing →
  // Accounting export. The separate ExportRoundingSelect + the invoiceExportRounding
  // pref are GONE. RoundingModeSelect shows all three modes and greys Favourable
  // (PDF-only) whenever the chosen invoice export format is a CSV type — in BOTH
  // the Invoicing default control and each shoot's Production Settings control.
  // The CSV export computes at the invoice's roundingMode with favourable→exact,
  // on the EXPORT path only (calcForDisplay / roundingFav untouched).
  // Source-presence only.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ OO1: shared card + the single RoundingModeSelect renders through it ─
    check('OO1a RoundingOptionCard shared component defined (radio dot + label + desc + disabled + note)',
      /const RoundingOptionCard = \(\{ label, desc, note, active, disabled = false, onClick \}\) =>/.test(html) &&
      /disabled \? undefined : onClick/.test(html) &&
      /\{note && <div className="text-\[10px\]/.test(html));
    check('OO1b RoundingModeSelect renders ALL three ROUNDING_OPTIONS through RoundingOptionCard — no favourable filter anywhere (every mode present)',
      /const RoundingModeSelect = \(\{ value, onChange, disableFavourable = false \}\) => \{[\s\S]{0,400}ROUNDING_OPTIONS\.map\(\(opt\) => \{[\s\S]{0,200}<RoundingOptionCard/.test(html) &&
      !/ROUNDING_OPTIONS\.filter\(\(opt\) => opt\.value !== 'favourable'\)/.test(html));
    check('OO1c RoundingModeSelect greys/disables ONLY favourable, and ONLY when disableFavourable is set',
      /const disabled = disableFavourable && opt\.value === 'favourable';/.test(html) &&
      /disabled=\{disabled\}/.test(html));

    // ─ OO2: the single control lives in Invoicing → Accounting export + per-shoot ─
    check('OO2a Invoicing default control: RoundingModeSelect on userPrefs.roundingMode, greying favourable for CSV formats (invoicing on)',
      /<RoundingModeSelect\s+value=\{roundingModeOf\(userPrefs\)\}\s+onChange=\{\(m\) => set\(\{ roundingMode: m \}\)\}\s+disableFavourable=\{invoicingEnabled\(userPrefs\) && INVOICE_EXPORT_CSV_FORMATS\.includes\(userPrefs\.invoiceExportFormat\)\}/.test(html));
    check('OO2b per-shoot control (Production Settings) greys favourable on the SAME condition (invoicing on AND CSV)',
      /<RoundingModeSelect value=\{roundingModeOf\(production\)\} onChange=\{\(m\) => setProduction\(p => \(\{ \.\.\.p, roundingMode: m \}\)\)\} disableFavourable=\{invoicingEnabled\(userPrefs\) && INVOICE_EXPORT_CSV_FORMATS\.includes\(userPrefs\.invoiceExportFormat\)\}/.test(html));
    check('OO2c favourable selectable when format === timemachine (INVOICE_EXPORT_CSV_FORMATS excludes timemachine → disableFavourable false)',
      /const INVOICE_EXPORT_CSV_FORMATS = \['xero', 'quickbooks', 'csv'\];/.test(html) &&
      !/INVOICE_EXPORT_CSV_FORMATS = \[[^\]]*timemachine/.test(html));
    check('OO2d exactly TWO RoundingModeSelect render sites (Invoicing default + per-shoot) — none in New-production defaults',
      (html.match(/<RoundingModeSelect/g) || []).length === 2);

    // ─ OO3: the old separate export control + its sub-sections are gone ─
    check('OO3a ExportRoundingSelect component is gone (one picker only)',
      !/ExportRoundingSelect/.test(html));
    check('OO3b New-production defaults no longer renders a Rounding control or a calcSummary line',
      !/calcSummary/.test(html) &&
      !/<RoundingModeSelect value=\{roundingModeOf\(userPrefs\)\} onChange=\{\(m\) => set\(\{ roundingMode: m \}\)\} \/>/.test(html));
    check('OO3c invoiceExportRounding pref + the old <Select> export-rounding control are gone',
      !/invoiceExportRounding/.test(html));

    // ─ OO4: CSV export computes at the invoice roundingMode, favourable→exact ─
    check('OO4a invoiceExportFigures derives mode from roundingModeOf(invoice), coercing favourable→exact, clamped to apa|exact, then reuses buildInvoiceLineItems',
      /function invoiceExportFigures\(invoice, production, userPrefs\) \{\s*const frozen = roundingModeOf\(invoice\);\s*const want = frozen === 'favourable' \? 'exact' : frozen;\s*const mode = INVOICE_EXPORT_ROUNDING_VALUES\.includes\(want\) \? want : 'exact';/.test(html) &&
      /buildInvoiceLineItems\(\{ \.\.\.production, roundingMode: mode \}, userPrefs, invoice\.userCrewId\)/.test(html));
    check('OO4b favourable→exact is EXPORT-path only — calcForDisplay / roundingFav are untouched (favourable still applies for the PDF)',
      /const useFavourableRounding = roundingFav\(production\);\s*const finalCalc = useFavourableRounding \? applyRateRounding\(calc\) : calc;/.test(html) &&
      /const roundingFav = \(o\) => roundingModeOf\(o\) === 'favourable';/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // PP — Skip-the-editor CSV export (SOLO only)
  //
  // The solo "Generate Invoice" CTA branches on userPrefs.invoiceExportFormat:
  // 'timemachine' opens the editor exactly as before; xero/quickbooks/csv
  // resolve the shoot's invoice (reuse-first, no extra number burn), show a
  // confirm, then export via the EXISTING export functions — leaving the
  // invoice's status untouched (no freeze/send). Reuses createNewInvoice
  // (now returns the object) + invoiceExportArtifact/Figures/guard/deliver.
  // Best Boy is out of scope. Source-presence only.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ PP1: createNewInvoice returns the OBJECT; callers use .id ─
    check('PP1a createNewInvoice returns the invoice object (not just the id)',
      /function createNewInvoice\([\s\S]{0,3200}setUserPrefs\(prev => \(\{ \.\.\.prev, invoiceNextNumber: num \+ 1 \}\)\);[\s\S]{0,500}return invoice;/.test(html) &&
      !/function createNewInvoice\([\s\S]{0,3600}return newId;/.test(html));
    check('PP1b the three existing callers read .id off the returned object',
      /createNewInvoice\(production, setProduction, userPrefs, setUserPrefs, soloCrew\?\.id\);\s*setInvoiceNav\(inv\.id\)/.test(html) &&
      /const inv = createNewInvoice\([^)]*userCrewId\);\s*onOpenInvoice\(inv\.id\)/.test(html) &&
      /const newInvoice = createNewInvoice\([^)]*userCrewId\);\s*openProduction\(productionId, \{ invoiceId: newInvoice\.id \}\)/.test(html));

    // ─ PP2: generate action branches on invoiceExportFormat ─
    check('PP2a generateOrExport: timemachine → openInvoiceFromButton; else resolve + confirm',
      /const generateOrExport = \(\) => \{\s*const fmt = \(userPrefs && userPrefs\.invoiceExportFormat\) \|\| 'timemachine';\s*if \(fmt === 'timemachine'\) \{ openInvoiceFromButton\(\); return; \}\s*setExportConfirm\(resolveInvoiceForExport\(\)\);/.test(html));
    check('PP2b CalcBreakdownView CTA routes through generateOrExport (when invoicing is on; not openInvoiceFromButton directly)',
      /onGenerateInvoice=\{invoicingEnabled\(userPrefs\) \? \(\) => \{ setShowCalc\(false\); generateOrExport\(\); \} : undefined\}/.test(html));
    check('PP2c export-sheet "Generate invoice" button routes through generateOrExport',
      /onClick=\{\(\) => \{ setShowExportSheet\(false\); generateOrExport\(\); \}\}/.test(html));

    // ─ PP3: reuse-first resolve — no extra invoice / no extra number burn ─
    check('PP3a resolveInvoiceForExport mirrors openInvoiceFromButton (latest draft → last → createNewInvoice)',
      /const resolveInvoiceForExport = \(\) => \{[\s\S]{0,400}\.reverse\(\)\.find\(inv => inv\.status === "draft"\);\s*return latestDraft\s*\|\| invoices\[invoices\.length - 1\]\s*\|\| createNewInvoice\(/.test(html));

    // ─ PP4: confirm fires before any file is written ─
    check('PP4a export confirm shows number · client · total · format with Export/Cancel',
      /\{exportConfirm && \(\(\) => \{[\s\S]{0,600}<ConfirmDialog\s*open\s*title=\{title\}\s*message=\{`\$\{exportConfirm\.invoiceNumber\} · \$\{clientLine\} · \$\{total\}`\}\s*confirmLabel="Export" confirmTone="primary" cancelLabel="Cancel"/.test(html));
    check('PP4b confirm total is computed at the export rounding (invoiceExportFigures); blank client guarded for Xero/QBO',
      /const total = fmtGBP\(invoiceExportFigures\(exportConfirm, production, userPrefs\)\.total\);/.test(html) &&
      /No client set - add it in \$\{fmtName\}/.test(html));
    check('PP4c the file is written ONLY from a confirm path (runExport in onConfirm), never directly in generateOrExport',
      /onConfirm=\{\(\) => \{\s*const inv = exportConfirm;\s*setExportConfirm\(null\);[\s\S]{0,400}runExport\(inv\);/.test(html) &&
      !/const generateOrExport = \(\) => \{[\s\S]{0,300}runExport\(/.test(html));
    check('PP4d runExport reuses the existing export functions (artifact → deliverTextFile)',
      /const runExport = \(inv\) => \{\s*const art = invoiceExportArtifact\(inv, production, userPrefs\);[\s\S]{0,120}deliverTextFile\(art\.filename, art\.content, art\.mime\)/.test(html));

    // ─ PP5: status untouched — no freeze / no send ─
    check('PP5a the skip-editor export never sends/freezes the invoice (no sendInvoice/freezeOnSend/status flip in the export helpers)',
      /const runExport = \(inv\) => \{[\s\S]{0,400}\};/.test(html) &&
      !/const runExport = \(inv\) => \{[\s\S]{0,400}(sendInvoice|freezeOnSend|status:)/.test(html) &&
      !/const generateOrExport = \(\) => \{[\s\S]{0,300}(sendInvoice|freezeOnSend|status:)/.test(html) &&
      !/\{exportConfirm && \(\(\) => \{[\s\S]{0,700}(sendInvoice|freezeOnSend)/.test(html));

    // ─ PP6: format-aware CTA labels ─
    check('PP6a CalcBreakdownView derives the two-line label from invoiceExportFormat',
      /const genTop = _genFmt === 'timemachine' \? 'GENERATE' : _genFmt === 'csv' \? 'EXPORT' : 'EXPORT TO';/.test(html) &&
      /const genBottom = _genFmt === 'timemachine' \? 'INVOICE' : _genFmt === 'xero' \? 'XERO' : _genFmt === 'quickbooks' \? 'QUICKBOOKS' : 'CSV';/.test(html));
    check('PP6b the CTA pill renders the format-aware label',
      /<div className="tm-pill-topline">\{genTop\}<\/div>\s*<div className="tm-pill-amount">\{genBottom\}<\/div>/.test(html));
    check('PP6c export-sheet button label branches on format (Export to Xero / QuickBooks / Export CSV / Generate invoice)',
      /const exportSheetCtaLabel = \(\(\) => \{[\s\S]{0,300}'Export to Xero'[\s\S]{0,120}'Export to QuickBooks'[\s\S]{0,120}'Export CSV'[\s\S]{0,80}'Generate invoice';/.test(html) &&
      /<IReceipt size=\{15\}\/>\{exportSheetCtaLabel\}/.test(html));

    // ─ PP7: timemachine / editor flow unchanged ─
    check('PP7a timemachine still calls openInvoiceFromButton(), and the reuse-first editor opener is intact',
      /if \(fmt === 'timemachine'\) \{ openInvoiceFromButton\(\); return; \}/.test(html) &&
      /const openInvoiceFromButton = \(\) => \{[\s\S]{0,400}const latestDraft = \[\.\.\.invoices\]\.reverse\(\)\.find\(inv => inv\.status === "draft"\);[\s\S]{0,200}setInvoiceNav\(target\.id\)/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // QQ — Invoicing visibility (master toggle, view-only). userPrefs.invoicingEnabled
  // (default ON) × invoiceExportFormat → FULL (on+timemachine) / EXPORT (on+CSV) /
  // CALCULATOR-ONLY (off). Hiding ≠ deleting: toggling touches no invoice data and
  // invoices reappear when re-enabled. Source-presence only (calc engine untouched —
  // see audit:build).
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');
    const dup = (html.match(/const DEFAULT_USER_PREFS = \{[\s\S]*?\n    \};/) || [''])[0];

    // ─ QQ1: the fresh pref + the visibility helpers ─
    check('QQ1a invoicingEnabled defaults ON (true) in DEFAULT_USER_PREFS',
      /invoicingEnabled: true,/.test(dup));
    check('QQ1b invoicingEnabled + invoicesTabVisible helpers (FULL = invoicing ON AND format timemachine)',
      /const invoicingEnabled = \(p\) => p\?\.invoicingEnabled !== false;/.test(html) &&
      /const invoicesTabVisible = \(p\) => invoicingEnabled\(p\) && \(\(p\?\.invoiceExportFormat \|\| 'timemachine'\) === 'timemachine'\);/.test(html));

    // ─ QQ2: Invoices tab + views rendered ONLY in FULL mode (every entry point) ─
    check('QQ2a Home Invoices tab button + its AllInvoicesView render are gated on invoicesTabVisible',
      /\{invoicesTabVisible\(userPrefs\) && \(\s*<button\s*onClick=\{\(\) => setHomeTab\('invoices'\)\}/.test(html) &&
      /\{\(invoicesTabVisible\(userPrefs\) && homeTab === "invoices"\) \? \(/.test(html));
    check('QQ2b a stuck homeTab=invoices redirects to Shoots when the tab becomes hidden',
      /if \(homeTab === 'invoices' && !invoicesTabVisible\(userPrefs\)\) setHomeTab\('productions'\);/.test(html));
    check('QQ2c the per-production (Best Boy) tab bar adds Invoices ONLY when invoicesTabVisible',
      /\.\.\.\(invoicesTabVisible\(userPrefs\) \? \[\{ k: "invoices", label: "Invoices", I: IReceipt \}\] : \[\]\)/.test(html));
    check('QQ2d mobile-nav Invoices entry + the in-production invoice views are gated too',
      /\{invoicesTabVisible\(userPrefs\) && \(\s*<button\s*type="button"\s*onClick=\{\(\) => \{ setShowMobileNav\(false\); setInvoiceNav\('list'\); \}\}/.test(html) &&
      /if \(invoicesTabVisible\(userPrefs\) && invoiceNav === "list"\) \{/.test(html) &&
      /if \(invoicesTabVisible\(userPrefs\) && invoiceNav && invoiceNav !== "list"\) \{/.test(html));

    // ─ QQ3: day-page Generate/Export CTA — present when ON, hidden when OFF ─
    check('QQ3a day-page CTA (solo modal) passes onGenerateInvoice only when invoicing is ON (else undefined)',
      /onGenerateInvoice=\{invoicingEnabled\(userPrefs\) \? \(\) => \{ setShowCalc\(false\); generateOrExport\(\); \} : undefined\}/.test(html));
    check('QQ3b CalcBreakdownView pill shows the generate CTA only when onGenerateInvoice exists, else a neutral TOTAL',
      /\{onGenerateInvoice \? \([\s\S]{0,500}<div className="tm-pill-topline">TOTAL<\/div>/.test(html));
    check('QQ3c export-sheet "Generate invoice" button is gated on invoicingEnabled',
      /\{invoicingEnabled\(userPrefs\) && \(\s*<button type="button"\s*onClick=\{\(\) => \{ setShowExportSheet\(false\); generateOrExport\(\); \}\}/.test(html));

    // ─ QQ4: Settings → Invoicing — master toggle + Rounding always visible; the
    //   rest gated. (Post-reorg: Rounding lives UNGATED in "Format & export"; the
    //   master toggle's visible label is "Show invoicing", pref key unchanged.) ─
    check('QQ4a master Toggle on userPrefs.invoicingEnabled is present (label "Show invoicing"; pref key unchanged)',
      /<Toggle value=\{invoicingEnabled\(userPrefs\)\} onChange=\{\(v\) => set\(\{ invoicingEnabled: v \}\)\} ariaLabel="Show invoicing" \/>/.test(html));
    check('QQ4b invoice-specific settings wrapped in an invoicingEnabled gate that closes before </Disclosure>',
      /\{invoicingEnabled\(userPrefs\) && \(<>/.test(html) &&
      /<\/>\)\}\s*<\/Disclosure>/.test(html));
    check('QQ4c Rounding (RoundingModeSelect) renders in the UNGATED "Format & export" sub-section — so it stays visible when invoicing is OFF — while the export-format Select right after it is individually gated on invoicingEnabled',
      /<RoundingModeSelect\s+value=\{roundingModeOf\(userPrefs\)\}\s+onChange=\{\(m\) => set\(\{ roundingMode: m \}\)\}[\s\S]{0,500}\{invoicingEnabled\(userPrefs\) && \(\s*<div className="mt-4">\s*<Field label="Invoice export format"/.test(html));

    // ─ QQ5: favourable greying now also requires invoicing ON (both controls) ─
    check('QQ5a favourable greying at BOTH rounding controls requires invoicing ON (invoicingEnabled && CSV); the old un-gated form is gone',
      (html.match(/disableFavourable=\{invoicingEnabled\(userPrefs\) && INVOICE_EXPORT_CSV_FORMATS\.includes\(userPrefs\.invoiceExportFormat\)\}/g) || []).length === 2 &&
      !/disableFavourable=\{INVOICE_EXPORT_CSV_FORMATS\.includes\(userPrefs\.invoiceExportFormat\)\}/.test(html));

    // ─ QQ6: hiding is VIEW-ONLY — invoices persist across an off→on toggle ─
    check('QQ6a the master toggle writes ONLY userPrefs.invoicingEnabled (no invoice/production mutation)',
      /onChange=\{\(v\) => set\(\{ invoicingEnabled: v \}\)\}/.test(html));
    check('QQ6b the visibility helpers are pure reads — no set()/setProduction() inside them',
      !/const invoicingEnabled = \(p\) =>[^\n]*\bset\(/.test(html) &&
      !/const invoicesTabVisible = \(p\) =>[^\n]*\bset\(/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // RR — Celebration speed fix (UI-only, CelebrationLayer). The mark-as-paid emoji
  // shower's rAF loop is now delta-time based (normalised to a 60fps baseline,
  // clamped to [0,3] frames) so it no longer runs ~2× fast on 120Hz ProMotion; the
  // safety stop is wall-clock; and a stuck 5× hold can't carry into the next run.
  // Speed presets and particle look are unchanged. Source-presence only (no calc
  // engine — see audit:build).
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ RR1: delta-time normalised to 60fps, clamped to [0,3] (long-gap guard) ─
    check('RR1a step(ts) computes a 60fps-normalised dtf clamped to [0,3]; first frame seeds to 1',
      /const step = \(ts\) => \{/.test(html) &&
      /const dtf = last \? Math\.max\(0, Math\.min\(\(ts - last\) \/ \(1000 \/ 60\), 3\)\) : 1;/.test(html) &&
      /last = ts;/.test(html));
    check('RR1b t folds in the 5× hold, and EVERY integration term scales by t — no raw per-frame motion left',
      /const t = dtf \* \(heldRef\.current \? 5 : 1\);/.test(html) &&
      /o\.vy \+= G \* t;/.test(html) &&
      /o\.y \+= o\.vy \* t;/.test(html) &&
      /o\.x \+= o\.vx \* t;/.test(html) &&
      /o\.rot \+= o\.vrot \* t;/.test(html) &&
      !/o\.vy \+= G \* mul;/.test(html));

    // ─ RR2: safety stop is wall-clock, not frame-count ─
    check('RR2a MAX_MS wall-clock stop (~12s) replaces the frame-count cap (MAX_FRAMES / frames++ gone)',
      /const MAX_MS = 12000;/.test(html) &&
      /if \(live > 0 && \(ts - startTs\) < MAX_MS\) \{/.test(html) &&
      /if \(!startTs\) startTs = ts;/.test(html) &&
      !/MAX_FRAMES/.test(html) &&
      !/frames\+\+;/.test(html));

    // ─ RR3: stuck-hold reset at the start of each celebration ─
    check('RR3a heldRef.current is reset to false at the start of each run (after the canvas guard)',
      /if \(!canvas\) \{ setActive\(false\); return; \}\s*\/\/[\s\S]{0,220}heldRef\.current = false;/.test(html));

    // ─ RR4: untouched — speed presets + particle look ─
    check('RR4a chill/normal/fast speed presets unchanged',
      /const CELEBRATION_SPEED = \{ chill: 2\.4, normal: 3\.8, fast: 5\.6 \};/.test(html));
    check('RR4b particle look unchanged (gravity G, per-particle vy seed off base, emoji font)',
      /const G = 0\.05;/.test(html) &&
      /vy: base \* \(0\.55 \+ rnd\(\) \* 0\.9\)/.test(html) &&
      /ctx\.font = o\.size \+ 'px system-ui, "Apple Color Emoji", sans-serif';/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // SS — Money odometer on the solo day pill total (display-only). Animates TO the
  // calc's value; never changes the value or its fmtGBP() formatting. £ / comma /
  // decimal point render static, each digit is a rolling 0–9 column (~0.35s
  // ease-out), right-aligned by position-from-the-right, reduced-motion snaps.
  // Scoped to the solo pill only. Source-presence only (no calc — see audit:build).
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    // ─ SS1: solo pill total renders THROUGH the odometer, fed the unchanged fmtGBP string ─
    check('SS1a solo day pill amount renders <MoneyOdometer value={fmtGBP(total)} /> (same value + formatter as before)',
      /<div className="tm-pill-amount pill-amount" key=\{`amount-\$\{dayIndex\}`\} style=\{swap\}><MoneyOdometer value=\{fmtGBP\(total\)\} \/><\/div>/.test(html));
    check('SS1b odometer is scoped to the solo pill ONLY — exactly one render site (Best Boy / other money displays untouched)',
      (html.match(/<MoneyOdometer\b/g) || []).length === 1);
    check('SS1c at rest the odometer spells the IDENTICAL string — non-digits render verbatim + the whole value is the aria-label',
      /const MoneyOdometer = \(\{ value \}\) =>/.test(html) &&
      /<span key=\{`s\$\{i\}`\} className="tm-odo-sep" aria-hidden="true">\{ch\}<\/span>/.test(html) &&
      /<span className="tm-odo" role="text" aria-label=\{value\}>/.test(html));

    // ─ SS2: per-digit rolling column — translateY, ~0.35s ease-out, right-aligned ─
    check('SS2a each digit is a 0–9 strip translated by -pos em with a 0.35s ease-out transition',
      /\{ODO_DIGITS\.map\(\(d\) => <span key=\{d\} className="tm-odo-digit">\{d\}<\/span>\)\}/.test(html) &&
      /transform: `translateY\(\$\{-pos\}em\)`/.test(html) &&
      /transition: reduce \? 'none' : 'transform 0\.35s ease-out'/.test(html));
    check('SS2b right-aligned: columns keyed by position-from-the-right; a new leading digit rolls up from 0',
      /const rightIndex = nDigits - 1 - seen;/.test(html) &&
      /key=\{`d\$\{rightIndex\}`\}/.test(html) &&
      /const from = pj >= 0 \? \+prevDigits\[pj\] : 0;/.test(html));

    // ─ SS3: prefers-reduced-motion snaps (no roll) ─
    check('SS3a reduced-motion snaps — column mounts at `to` and the transition is none',
      /const \[pos, setPos\] = React\.useState\(reduce \? to : from\);/.test(html) &&
      /if \(reduce\) \{ setPos\(to\); return; \}/.test(html) &&
      /reduce = !!\(window\.matchMedia && window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\)/.test(html));
  }

  // ════════════════════════════════════════════════════════════════
  // TT — iOS Live Activity Stage 1 (display-only, solo). The WEB build must never
  // touch the LiveActivity native bridge (audit:web also proves this); every JS
  // path is IS_NATIVE-guarded. The controller is display-only: it reuses
  // calcForDisplay for today's day total and NEVER writes stored data (no
  // setProduction/setDays). The native Swift/SwiftUI lives outside index.html
  // (ios/App/…) so it can't affect any audit. Source-presence only.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');
    const descFn = (html.match(/function liveActivityDescriptor\([\s\S]*?\n    \}/) || [''])[0];
    const ctrlFn = (html.match(/function SoloLiveActivity\([\s\S]*?return null;\s*\}/) || [''])[0];

    // ─ TT1: the bridge — four methods, each a no-op before touching Capacitor ─
    check('TT1a LiveActivity bridge defines isAvailable/start/update/end + round-3 list/endForProduction',
      /const LiveActivity = \{/.test(html) &&
      /async isAvailable\(\)/.test(html) && /async start\(opts\)/.test(html) &&
      /async update\(opts\)/.test(html) && /async end\(opts\)/.test(html) &&
      /async list\(\)/.test(html) && /async endForProduction\(productionId\)/.test(html));
    check('TT1b every bridge method returns BEFORE touching _capPlugins() unless IS_NATIVE (web never references the plugin)',
      /async isAvailable\(\) \{\s*if \(!IS_NATIVE\) return false;/.test(html) &&
      /async start\(opts\) \{\s*if \(!IS_NATIVE\) return;/.test(html) &&
      /async update\(opts\) \{\s*if \(!IS_NATIVE\) return;/.test(html) &&
      /async end\(opts\) \{\s*if \(!IS_NATIVE\) return;/.test(html) &&
      /async list\(\) \{\s*if \(!IS_NATIVE\) return \[\];/.test(html) &&
      /async endForProduction\(productionId\) \{\s*if \(!IS_NATIVE\) return;/.test(html) &&
      /_capPlugins\(\)\.LiveActivity/.test(html));

    // ─ TT2: descriptor reuses the calc + derives state; controller is guarded ─
    check('TT2a liveActivityDescriptor reuses calcForDisplay for today total (recomputes nothing) + derives oncall/wrapped; the lunch phase is gated on lunchLogged + native (no time-derived "lunch" state); wrapped is the EXPLICIT flag; name from production.title',
      /function liveActivityDescriptor\(production, soloCrew, days\)/.test(html) &&
      /calcForDisplay\(production, rec, soloCrew, findPrevDay\(days, rec\)\)\.total/.test(html) &&
      /let state = 'oncall';/.test(html) && /state = 'wrapped';/.test(html) &&
      // Group C: lunch is gated on lunchLogged and the on-lunch boundary is native —
      // the descriptor no longer assigns a time-derived 'lunch' state.
      /} else if \(rec\.lunchLogged === true\) \{/.test(html) && !/state = 'lunch'/.test(html) &&
      // root-cause fix: planned wrapTime no longer counts as wrapped
      /const wrapped = rec\.wrapped === true;/.test(html) &&
      !/const wrapped = rec\.wrapped === true \|\| !!\(rec\.wrapTime/.test(html) &&
      /name: production\.title \|\| 'Shoot'/.test(html));
    check('TT2b SoloLiveActivity computes desc only when IS_NATIVE AND the pref is enabled, bails on web; a disqualified (or disabled) day ends the card IMMEDIATELY (no 5-min linger)',
      /function SoloLiveActivity\(\{ production, soloCrew, days, enabled = true \}\)/.test(html) &&
      /const desc = \(IS_NATIVE && enabled\) \? liveActivityDescriptor\(production, soloCrew, days\) : null;/.test(html) &&
      /if \(!IS_NATIVE\) return;/.test(html) &&
      /if \(!desc\) \{[\s\S]{0,220}LiveActivity\.end\(\{ immediate: true \}\);/.test(html));
    check('TT2c controller mounted in SoloDayPage with production/soloCrew/days + the round-3 enabled pref',
      /<SoloLiveActivity production=\{production\} soloCrew=\{soloCrew\} days=\{days\} enabled=\{!userPrefs \|\| userPrefs\.liveActivityEnabled !== false\} \/>/.test(html));

    // ─ TT3: start / update / end wired at the right transitions (debounced) ─
    check('TT3a start on (production,today) key change; update on signature change; end on wrap; 600ms debounce',
      /if \(startedKeyRef\.current !== key\) \{[\s\S]{0,300}LiveActivity\.start\(payload\)/.test(html) &&
      /\} else if \(sig !== lastSentRef\.current\) \{[\s\S]{0,260}LiveActivity\.update\(payload\)/.test(html) &&
      /if \(desc\.wrapped\) \{[\s\S]{0,200}LiveActivity\.update\(payload\);[\s\S]{0,120}LiveActivity\.end\(\);/.test(html) &&
      /\}, 600\);/.test(html));

    // ─ TT4: display-only — the controller never writes stored data ─
    check('TT4a neither liveActivityDescriptor nor SoloLiveActivity writes stored data (no setProduction/setDays — display-only)',
      descFn.length > 0 && ctrlFn.length > 0 &&
      !/setProduction|setDays/.test(descFn) && !/setProduction|setDays/.test(ctrlFn));

    // ─ TT5: Stage-1 start-bug fix + loggable, non-silent lifecycle ─
    check('TT5a applyWrapNow record-writes wrapTime+wrapped:true via the shared mapDayNow (calc-neutral — wrapped is status only, never read by the engine); Live Activity ingestion routes through it',
      /function applyWrapNow\(production, date, t\) \{[\s\S]{0,200}mapDayNow\(production\.days, date, uid0, \{ wrapTime: t, wrapped: true \}\)/.test(html) &&
      /: applyWrapNow\(next, ev\.date, ev\.at\)/.test(html));
    check('TT5b lifecycle decisions are loggable on native (start / update / wrapped→end), not silent',
      /console\.log\('\[LiveActivity\] start'/.test(html) &&
      /console\.log\('\[LiveActivity\] update'/.test(html) &&
      /console\.log\('\[LiveActivity\] wrapped → update \+ end'\)/.test(html));
    check('TT5c bridge surfaces native start/update/end failures via console.warn instead of a silent catch',
      /console\.warn\('\[LiveActivity\] start failed'/.test(html) &&
      /console\.warn\('\[LiveActivity\] update failed'/.test(html) &&
      /console\.warn\('\[LiveActivity\] end failed'/.test(html) &&
      !/p\.startActivity\(opts \|\| \{\}\); \} catch \(_\) \{\}/.test(html));

    // ─ TT6: Stage-2 interactive buttons — App-Group event queue + ingestion ─
    check('TT6a bridge.drainPendingEvents is IS_NATIVE-guarded (returns [] before touching the plugin on web)',
      /async drainPendingEvents\(\) \{\s*if \(!IS_NATIVE\) return \[\];/.test(html) &&
      /const r = await p\.drainPendingEvents\(\); return \(r && r\.events\) \|\| \[\];/.test(html));
    check('TT6b ingestion applies through the shared record-write transform ONLY — lunch via applyLunchNow, wrap via applyWrapNow, curtail via applyLunchCurtail, Siri times via applySetTimes (one mapDayNow path; no parallel day-record write)',
      /next = ev\.type === 'lunchNow'\s*\? applyLunchNow\(next, ev\.date, ev\.at\)\s*: ev\.type === 'lunchCurtail' \? applyLunchCurtail\(next, ev\.date, ev\.durationMins\)\s*: ev\.type === 'setTimes'\s*\? applySetTimes\(next, ev\.date, ev, userPrefs\)\s*: applyWrapNow\(next, ev\.date, ev\.at\)/.test(html) &&
      /return \{ \.\.\.production, days: mapDayNow\(production\.days, date, uid0, patch\) \};/.test(html));
    check('TT6c idempotent + today-only — appliedEventIds checked & persisted; stale-date discarded; today via todayISO()',
      /if \(applied\.has\(ev\.id\)\) \{[\s\S]{0,140}continue; \}/.test(html) &&
      /applied\.add\(ev\.id\);/.test(html) &&
      /storage\.set\(APPLIED_KEY, JSON\.stringify\(\[\.\.\.applied\]\.slice\(-200\)\)\)/.test(html) &&
      /if \(ev\.date !== today\) \{[\s\S]{0,140}continue; \}/.test(html) &&
      /const today = todayISO\(\);/.test(html));
    check('TT6d ingestion lives in App, IS_NATIVE-gated, drains on launch + on foreground (appStateChange isActive) — and both triggers ALSO run the reconcile sweep',
      /const liveActivityAppliedRef = React\.useRef\(null\);\s*useEffect\(\(\) => \{\s*if \(!IS_NATIVE\) return;/.test(html) &&
      /LiveActivity\.drainPendingEvents\(\)/.test(html) &&
      /addListener\('appStateChange', \(s\) => \{ if \(s && s\.isActive\) \{ ingest\(\); liveActivityReconcile\(\); \} \}\)/.test(html) &&
      /ingest\(\); \/\/ launch drain/.test(html) &&
      /liveActivityReconcile\(\); \/\/ launch sweep/.test(html));

    // ─ TT7: productionId targeting + the single shared wrap path ─
    check('TT7a productionId flows descriptor → start payload (so the event/ingest targets the exact shoot)',
      /return \{ productionId: production\.id, name: production\.title \|\| 'Shoot'/.test(html) &&
      /const payload = \{ name: desc\.name,[\s\S]{0,300}productionId: desc\.productionId, lunchEndEpoch: desc\.lunchEndEpoch, otFrom: desc\.otFrom, curtailMins: desc\.curtailMins, lunchLogged: desc\.lunchLogged, wrapCurve: desc\.wrapCurve \};/.test(html));
    check('TT7b applyWrapNow is the single solo/ingestion record wrap-path (defined once, via mapDayNow), shared with the solo WrapNowBtn; Best Boy handleWrapNow stays OVERLAY (decoupled — never calls applyWrapNow)',
      /function applyWrapNow\(production, date, t\) \{/.test(html) &&
      /setDays\(prev => mapDayNow\(prev, todayStr, null, \{ wrapTime: wrapStr, wrapped: true \}\)\)/.test(html) &&
      /const handleWrapNow = \(\) => \{[\s\S]{0,560}setDayDefault\(p, currentDate, 'wrapTime', t\)/.test(html) &&
      !/const handleWrapNow = \(\) => \{[\s\S]{0,560}applyWrapNow\(/.test(html));

    // ─ TT8: shared record-write transform + Stage-2 design-pass descriptor ─
    check('TT8a mapDayNow is the ONE day-record mutation — defined once, used by applyLunchNow, applyWrapNow, AND the solo Lunch/Wrap Now buttons',
      /function mapDayNow\(days, date, uid, patch\) \{[\s\S]{0,160}d\.date === date && \(!uid \|\| d\.crewId === uid\) \? \{ \.\.\.d, \.\.\.patch \} : d/.test(html) &&
      /function applyLunchNow\(production, date, t\) \{[\s\S]{0,460}mapDayNow\(production\.days, date, uid0, \{ lunchStartTime: t, lunchLogged: true \}\)/.test(html) &&
      /setDays\(prev => mapDayNow\(prev, todayStr, null, \{ lunchStartTime: lunchStr, lunchLogged: true \}\)\)/.test(html) &&
      /setDays\(prev => mapDayNow\(prev, todayStr, null, \{ wrapTime: wrapStr, wrapped: true \}\)\)/.test(html));
    check('TT8b descriptor derives the pre-call/call anchor + anchorLabel + endEpoch (frozen-timer on wrap); timer anchors on pre-call when set',
      /const preCall = rec\.preCallTime \|\| rec\.truckCallTime \|\| dd\.preCallTime \|\| '';/.test(html) &&
      /const anchorTime = preCall \|\| callTime;/.test(html) &&
      /const anchorLabel = preCall \? `PRE-CALL \$\{preCall\}` : `CALL \$\{callTime\}`;/.test(html) &&
      /const callEpoch = hhmmToEpochToday\(anchorTime\);/.test(html) &&
      /const endEpoch = wrapped \? hhmmToEpochToday\(rec\.wrapTime\) : 0;/.test(html));
    check('TT8c anchorLabel + endEpoch flow descriptor → sig → start/update payload (round 3: l1 REMOVED from the contract — cwd only)',
      /a: desc\.anchorLabel, e: desc\.endEpoch, w: desc\.wrapped/.test(html) &&
      /anchorLabel: desc\.anchorLabel, endEpoch: desc\.endEpoch/.test(html) &&
      /anchorLabel, endEpoch, staleEpoch, state, wrapped, cwd, lunchEndEpoch, otFrom, curtailMins, lunchLogged, wrapCurve \}/.test(html) &&
      !/desc\.l1/.test(html));
    // ─ TT8c-LA: lunch-exit fix — the activity refresh wake is aimed at lunch-end ─
    check('TT8c2 descriptor staleEpoch is LUNCH-AWARE — ON LUNCH (lunchLogged && curtailMins===0 && lunchEndEpoch>now) points the activity stale wake at lunchEndEpoch so the LOCKED card refreshes at lunch-end and the native isOnLunch flips false; else the ~16h-after-anchor safety sentinel; the OLD flat unconditional call+16h form is GONE (guards the LA lunch-exit fix against a silent regress)',
      /const nowEpoch = Math\.floor\(Date\.now\(\) \/ 1000\);/.test(html) &&
      /const onLunchNow = lunchLogged && curtailMins === 0 && lunchEndEpoch > nowEpoch;/.test(html) &&
      /const staleEpoch = onLunchNow \? lunchEndEpoch : \(callEpoch \? callEpoch \+ 16 \* 3600 : 0\);/.test(html) &&
      // the pre-fix flat form must be gone — this is the regression the bug was
      !/const staleEpoch = callEpoch \? callEpoch \+ 16 \* 3600 : 0;/.test(html));
    check('TT8c3 native lunch-end wake — TMLiveActivity.lunchStaleDate mirrors the SwiftUI isOnLunch (lunchLogged && curtailMins==0 && lunchEndEpoch>now → Date(lunchEndEpoch), else nil); confirmLunch + EVERY intent-side activity.update routes staleDate through it — no staleDate: nil left to clobber the wake',
      (() => {
        const intents = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineIntents.swift'), 'utf8');
        const helperOk = /static func lunchStaleDate\(_ s: TimeMachineActivityAttributes\.ContentState\) -> Date\? \{/.test(intents) &&
          /guard s\.lunchLogged, s\.curtailMins == 0,\s*s\.lunchEndEpoch > Date\(\)\.timeIntervalSince1970 else \{ return nil \}/.test(intents) &&
          /return Date\(timeIntervalSince1970: s\.lunchEndEpoch\)/.test(intents);
        // confirmLunch (the primary fix path) routes through the helper, not nil
        const confirmOk = /static func confirmLunch[\s\S]*?await activity\.update\(ActivityContent\(state: next, staleDate: lunchStaleDate\(next\)\)\)/.test(intents);
        // applied broadly, and NO bare staleDate: nil remains in the intents file
        const appliedCount = (intents.match(/staleDate: lunchStaleDate\(next\)\)/g) || []).length;
        const noNil = !/staleDate: nil/.test(intents);
        return helperOk && confirmOk && appliedCount >= 8 && noNil;
      })());
    check('TT8d Issue C — ingestion ALSO re-runs on the plugin drainRequest event (best-effort background apply), via the SAME idempotent ingest()',
      /const LAPlg = _capPlugins\(\)\.LiveActivity;/.test(html) &&
      /LAPlg\.addListener\('drainRequest', \(\) => ingest\(\)\)/.test(html));
    check('TT8e CWD card flag comes from the EXISTING break-state family ONLY — resolveDay + deriveBreakState (BWD-effective type mirrored from DayEntryForm), live term compares now against bs\'s OWN cwdThreshold; no threshold maths re-derived (and none in Swift); flag flows into sig + payload',
      /const vr = resolveDay\(production, rec, soloCrew\);/.test(html) &&
      /const bs = deriveBreakState\(vr, bwdOverrideApplies \? "Shoot" : vr\.dayType\);/.test(html) &&
      /const nowAbs = absTime\(nowH, bs\.callH\);/.test(html) &&
      /cwd = bs\.continuousDay \|\| \(nowAbs > bs\.cwdThreshold && lunchPending\);/.test(html) &&
      /w: desc\.wrapped, d: desc\.cwd/.test(html) &&
      /state: desc\.state, cwd: desc\.cwd/.test(html));
    check('TT8f SoloLiveActivity minute tick — recomputes the time-derived descriptor outputs (AT LUNCH window, CWD live term) while the app is foregrounded; sig still gates native updates to real changes',
      /const \[, laTick\] = React\.useReducer\(x => x \+ 1, 0\);/.test(html) &&
      /const t = setInterval\(laTick, 60000\);/.test(html));

    // ─ TT9: round 3 — lifecycle reconcile + the Live Activity master switch ─
    check('TT9a unmount-persists vs disqualification — the effect cleanup ONLY clears the debounce timer (never ends), so navigating away keeps the card; ends happen solely inside the effect body (disqualify/wrap) or via the sweep',
      /return \(\) => clearTimeout\(timer\);/.test(html) &&
      !/return \(\) => \{[^}]{0,160}LiveActivity\.end/.test(html));
    check('TT9b reconcile sweep mirrors the descriptor\'s qualify conditions (solo production, today record, callTime record-or-overlay, pref enabled), groups by productionId, ends non-qualifying via endForProduction AND converges DUPLICATES of a qualifying production (keep first, end the rest by id) — the single-activity invariant backstop',
      /const liveActivityReconcile = React\.useCallback\(async \(\) => \{\s*if \(!IS_NATIVE\) return;\s*const acts = await LiveActivity\.list\(\);/.test(html) &&
      /const soloCrew = pr && !pr\.bestBoyMode \? \(pr\.crew \|\| \[\]\)\[0\] : null;/.test(html) &&
      /const qualifies = enabled && !!rec && rec\.wrapped !== true && !!\(rec\.callTime \|\| \(dd && dd\.callTime\)\);/.test(html) &&
      /if \(!qualifies\) \{[\s\S]{0,120}LiveActivity\.endForProduction\(pid\);/.test(html) &&
      /\} else if \(ids\.length > 1\) \{[\s\S]{0,160}for \(let i = 1; i < ids\.length; i\+\+\) dupeIds\.push\(ids\[i\]\);/.test(html) &&
      /if \(dupeIds\.length\) LiveActivity\.endActivityIds\(dupeIds\);/.test(html));
    check('TT9e single-activity invariant — the endActivityIds bridge method is IS_NATIVE-guarded (the sweep\'s by-id duplicate-converge; native startActivity adopt-or-update is the primary dedupe, compile-verified)',
      /async endActivityIds\(ids\) \{\s*if \(!IS_NATIVE \|\| !ids \|\| !ids\.length\) return;/.test(html) &&
      /_capPlugins\(\)\.LiveActivity; if \(p && p\.endActivityIds\)/.test(html));
    check('TT9c change-sweep — productions edits and the Settings toggle reconcile within ~1s while the app is open (debounced IS_NATIVE-gated effect)',
      /useEffect\(\(\) => \{\s*if \(!IS_NATIVE\) return;\s*const t = setTimeout\(liveActivityReconcile, 1000\);\s*return \(\) => clearTimeout\(t\);\s*\}, \[productions, userPrefs && userPrefs\.liveActivityEnabled\]\);/.test(html));
    check('TT9d Live Activity master switch — fresh pref default ON in DEFAULT_USER_PREFS; Appearance toggle row (rendered on web with a native-only note, matching Haptics); mount site passes enabled; controller short-circuits when disabled',
      /liveActivityEnabled: true,/.test(html) &&
      /<Toggle value=\{userPrefs\.liveActivityEnabled !== false\} onChange=\{\(v\) => set\(\{ liveActivityEnabled: v \}\)\} ariaLabel="Live Activity" \/>/.test(html) &&
      /<SoloLiveActivity production=\{production\} soloCrew=\{soloCrew\} days=\{days\} enabled=\{!userPrefs \|\| userPrefs\.liveActivityEnabled !== false\} \/>/.test(html));

    // ─ TT10: Group A / A.5 — lunch countdown + OT-from + card layout (display-only) ─
    check('TT10a descriptor lunchEndEpoch — statutory hour-end (= loggedStart + 3600) set in the lunchLogged branch (single assignment, today-anchored like hhmmToEpochToday + 3600); 0 elsewhere; flows into the return for the native countdown',
      /let lunchEndEpoch = 0;/.test(descFn) &&
      /ls\.setHours\(Math\.floor\(lunchH\), Math\.round\(\(lunchH % 1\) \* 60\), 0, 0\);/.test(descFn) &&
      /lunchEndEpoch = Math\.floor\(ls\.getTime\(\) \/ 1000\) \+ 3600;/.test(descFn) &&
      (descFn.match(/lunchEndEpoch = Math\.floor/g) || []).length === 1 &&
      /state, wrapped, cwd, lunchEndEpoch, otFrom, curtailMins, lunchLogged, wrapCurve \};/.test(descFn));
    check('TT10b descriptor otFrom — READS the calc engine via calcForDisplay (a forced deep-past-midnight wrap surfaces the wrap-INDEPENDENT OT line; rec is spread-cloned, never mutated), parses the standard-OT line\'s first clock token, hidden when wrapped / no hourly-OT line (never a guessed time)',
      /let otFrom = '';\s*if \(!wrapped\) \{/.test(descFn) &&
      /calcForDisplay\(production, \{ \.\.\.rec, wrapTime: '02:00', wrapNextDay: true \}, soloCrew, null\)/.test(descFn) &&
      /\.find\(l =>/.test(descFn) && /l\.label === 'OT'/.test(descFn) && /\/\^Saturday OT\//.test(descFn) &&
      /if \(m\) otFrom = m\[1\];/.test(descFn) &&
      // display-only: the descriptor never assigns otStartAbs/basicHrs itself (no
      // engine maths re-derived here — it only reads the rendered OT line).
      !/otStartAbs\s*=[^=]/.test(descFn) && !/basicHrs\s*=/.test(descFn));
    check('TT10c sig + payload carry lunchEndEpoch + otFrom — a change in either pushes a native update, and both reach the plugin (key names match the Swift getDouble/getString reads)',
      /l: desc\.lunchEndEpoch, o: desc\.otFrom, cm: desc\.curtailMins, ll: desc\.lunchLogged, wc: desc\.wrapCurve \}/.test(html) &&
      /lunchEndEpoch: desc\.lunchEndEpoch, otFrom: desc\.otFrom, curtailMins: desc\.curtailMins, lunchLogged: desc\.lunchLogged, wrapCurve: desc\.wrapCurve \}/.test(html));
    check('TT10d ContentState schema — lunchEndEpoch: Double + otFrom: String (display-only, init-defaulted); the plugin reads both (getDouble/getString) on start AND update; the intent process preserves both across all 4 reconstructions (arm/disarm/update/endWrapped)',
      (() => {
        const attr = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineActivityAttributes.swift'), 'utf8');
        const plugin = fs.readFileSync(path.join(ROOT, 'ios/App/App/LiveActivityPlugin.swift'), 'utf8');
        const intents = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineIntents.swift'), 'utf8');
        const schemaOk = /public var lunchEndEpoch: Double/.test(attr) && /public var otFrom: String/.test(attr) &&
          /lunchEndEpoch: Double = 0, otFrom: String = ""/.test(attr) &&
          /self\.lunchEndEpoch = lunchEndEpoch/.test(attr) && /self\.otFrom = otFrom/.test(attr) &&
          !/lunchLeft/.test(attr);
        const pluginOk = (plugin.match(/call\.getDouble\("lunchEndEpoch"\)/g) || []).length >= 2 &&
          (plugin.match(/call\.getString\("otFrom"\)/g) || []).length >= 2 &&
          (plugin.match(/lunchEndEpoch: lunchEndEpoch, otFrom: otFrom/g) || []).length >= 2 &&
          !/lunchLeft/.test(plugin);
        const intentsOk = (intents.match(/lunchEndEpoch: cur\.lunchEndEpoch, otFrom: cur\.otFrom/g) || []).length >= 4 &&
          !/lunchLeft/.test(intents);
        return schemaOk && pluginOk && intentsOk;
      })());
    check('TT10e SwiftUI lunch countdown is a NATIVE ticking view — lunchCountdown renders Text(timerInterval: lunchStart…lunchEnd, countsDown: true, showsHours: false) so it advances DOWN on the locked screen with zero pushes (fork.knife + the figure only — no trailing "left" label — amber); timerSlot picks the countdown by the native onLunch predicate else the elapsed count-up; elapsedTimer stays the native Text(timerInterval:) too',
      (() => {
        const la = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineLiveActivity.swift'), 'utf8');
        const cd = (la.match(/private func lunchCountdown[\s\S]*?\n\}/) || [''])[0];
        const countdownOk = /Text\(timerInterval: callDate\(end\)\.addingTimeInterval\(-3600\)\.\.\.callDate\(end\),/.test(cd) &&
          /countsDown: true, showsHours: false\)/.test(cd) &&
          /Image\(systemName: "fork\.knife"\)/.test(cd) && !/Text\("left"\)/.test(cd) &&
          /\.foregroundColor\(\.tmAmber\)/.test(cd);
        const ts = (la.match(/private func timerSlot[\s\S]*?\n\}/) || [''])[0];
        const slotOk = /if onLunch \{/.test(ts) &&
          /lunchCountdown\(end: lunchEnd\)/.test(ts) &&
          /elapsedTimer\(anchor: anchor, end: end\)/.test(ts);
        const elapsedNativeOk = /private func elapsedTimer[\s\S]*?Text\(timerInterval: callDate\(anchor\)/.test(la);
        // the elapsed timer is now invoked ONLY through timerSlot (moved off the
        // total's line) — exactly one call site.
        const movedOk = (la.match(/elapsedTimer\(anchor: anchor/g) || []).length === 1;
        return countdownOk && slotOk && elapsedNativeOk && movedOk;
      })());
    check('TT10f SwiftUI layout — total reads clean on its own line (moneyText not beside the timer); Line-4 timerProjectionRow (timer slot + OT-from in tmFaint, hidden when wrapped) separated by spacing only (NO divider), placed on lock screen + DI expanded (×2); DI compact = status dot only (money stripped from always-visible presentations; compactTrailing renders EmptyView); the old secondaryReadout row is GONE',
      (() => {
        const la = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineLiveActivity.swift'), 'utf8');
        const gone = !/secondaryReadout/.test(la);
        const pr = (la.match(/private func timerProjectionRow[\s\S]*?\n\}/) || [''])[0];
        const rowOk = /timerSlot\(onLunch: onLunch, anchor: anchor, end: end, lunchEnd: lunchEnd\)/.test(pr) &&
          /if state != "wrapped" && !otFrom\.isEmpty \{/.test(pr) &&
          /Text\("OT from \\\(otFrom\)"\)/.test(pr) && /\.foregroundColor\(\.tmFaint\)/.test(pr);
        // lock screen: DAY TOTAL + anchor are micro-labels on one row, the total is
        // alone (moneyFont), and the divider that used to precede Line 4 is GONE —
        // the VStack spacing separates them.
        const lockOk = /microLabel\("DAY TOTAL"\)\s*Spacer\(\)\s*microLabel\(context\.state\.anchorLabel\)/.test(la) &&
          /moneyText\(context\.state\.totalText, font: moneyFont\)/.test(la) &&
          !/Rectangle\(\)\.fill\(Color\.tmFaint\.opacity\(0\.18\)\)/.test(la);
        // DI expanded: anchor relocated under the total (trailing). Compact:
        // status dot leading, NOTHING trailing — money is deliberately absent
        // from the always-visible presentations (expanded + lock screen keep it).
        const diOk = /moneyText\(context\.state\.totalText, font: moneyFontSmall\)\s*microLabel\(context\.state\.anchorLabel\)/.test(la) &&
          /compactTrailing: \{[^}]*EmptyView\(\)/.test(la) &&
          !/compactTrailing: \{[^}]*moneyText/.test(la) &&
          /compactLeading: \{\s*Circle\(\)\.fill\(chipColor/.test(la);
        const placedOk = (la.match(/timerProjectionRow\(state: context\.state\.state/g) || []).length === 2;
        return gone && rowOk && lockOk && diOk && placedOk;
      })());

    // ─ TT11: Group B — "Back early?" button (new write path, reuses the queue) ─
    check('TT11a descriptor GATES the lunch phases on lunchLogged (actually-started, NOT the seeded plan) — when rec.lunchLogged it pushes lunchEndEpoch (statutory hour) + curtailMins (recorded 0<dur<60); state never becomes a time-derived "lunch" (the on-lunch/full-hour boundary is native); the pushed lunchedFull boolean is GONE; all flow into return/sig/payload',
      /} else if \(rec\.lunchLogged === true\) \{/.test(descFn) &&
      /lunchLogged = true;/.test(descFn) &&
      /let curtailMins = 0;/.test(descFn) && /let lunchLogged = false;/.test(descFn) &&
      /if \(dur > 0 && dur < 60\) curtailMins = dur;/.test(descFn) &&
      !/lunchedFull/.test(descFn) &&            // no pushed full-hour boolean
      !/state = 'lunch'/.test(descFn) &&        // no time-derived lunch state
      /state, wrapped, cwd, lunchEndEpoch, otFrom, curtailMins, lunchLogged, wrapCurve \};/.test(descFn));
    check('TT11b ingest reuses the SAME queue — lunchCurtail added to the today-only idempotent type filter + dispatched to applyLunchCurtail, which writes lunchDurationMins through the SHARED mapDayNow transform, guarded to a genuine curtailment (0<mins<60); NO new write channel, NO calc change',
      /ev\.type !== 'lunchNow' && ev\.type !== 'wrapNow' && ev\.type !== 'lunchCurtail'/.test(html) &&
      /ev\.type === 'lunchCurtail' \? applyLunchCurtail\(next, ev\.date, ev\.durationMins\)/.test(html) &&
      /function applyLunchCurtail\(production, date, durationMins\) \{/.test(html) &&
      /if \(!\(mins > 0 && mins < 60\)\) return production;/.test(html) &&
      /mapDayNow\(production\.days, date, uid0, \{ lunchDurationMins: mins \}\)/.test(html));
    check('TT11c ContentState schema — curtailMins: Int + lunchLogged: Bool (init-defaulted, lunchedFull fully removed); the plugin reads both (getInt/getBool) on start AND update; the intent process preserves lunchLogged across its reconstructions',
      (() => {
        const attr = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineActivityAttributes.swift'), 'utf8');
        const plugin = fs.readFileSync(path.join(ROOT, 'ios/App/App/LiveActivityPlugin.swift'), 'utf8');
        const intents = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineIntents.swift'), 'utf8');
        const schemaOk = /public var curtailMins: Int/.test(attr) && /public var lunchLogged: Bool/.test(attr) &&
          /curtailMins: Int = 0, lunchLogged: Bool = false/.test(attr) &&
          /self\.curtailMins = curtailMins/.test(attr) && /self\.lunchLogged = lunchLogged/.test(attr) &&
          !/lunchedFull/.test(attr);
        const pluginOk = (plugin.match(/call\.getInt\("curtailMins"\)/g) || []).length >= 2 &&
          (plugin.match(/call\.getBool\("lunchLogged"\)/g) || []).length >= 2 &&
          (plugin.match(/curtailMins: curtailMins, lunchLogged: lunchLogged/g) || []).length >= 2 &&
          !/lunchedFull/.test(plugin);
        const intentsOk = (intents.match(/lunchLogged: cur\.lunchLogged/g) || []).length >= 4 &&
          !/lunchedFull/.test(intents);
        return schemaOk && pluginOk && intentsOk;
      })());
    check('TT11d CurtailIntent — single tap arms (native whole-minute now−lunchStart), holds the 5s undo window, then COMMITS; the lunchCurtail append happens ONLY in commitCurtailIfStillArmed (stamp+armed gated) — never on the arm and never on undo; a 2nd tap cancels (no write); duration ≥60/≤0 is a no-op',
      (() => {
        const intents = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineIntents.swift'), 'utf8');
        const append = /static func appendEvent\(type: String, productionId: String, durationMins: Int\? = nil\)/.test(intents) &&
          /if let durationMins \{ event\["durationMins"\] = durationMins \}/.test(intents);
        const helper = /static let curtailUndoWindow: TimeInterval = 5\.0/.test(intents) &&
          /let lunchStart = lunchEndEpoch - 3600/.test(intents) &&
          /return Int\(\(elapsed \/ 60\)\.rounded\(\)\)/.test(intents);
        const arm = (intents.match(/static func armCurtail[\s\S]*?\n    \}/) || [''])[0];
        const cancel = (intents.match(/static func cancelCurtail[\s\S]*?\n    \}/) || [''])[0];
        const commit = (intents.match(/static func commitCurtailIfStillArmed[\s\S]*?\n    \}/) || [''])[0];
        // the write is ONLY in commit, gated; arm + cancel never append.
        const writeOnlyInCommit = !/appendEvent/.test(arm) && !/appendEvent/.test(cancel) &&
          /guard cur\.armed == "curtail", cur\.armedAt == stamp,/.test(commit) &&
          /appendEvent\(type: "lunchCurtail", productionId: productionId, durationMins: cur\.curtailMins\)/.test(commit);
        const intent = /struct CurtailIntent: LiveActivityIntent/.test(intents) &&
          /cur\.armed == "curtail",[\s\S]{0,140}cancelCurtail\(productionId\)/.test(intents) &&  // 2nd tap = undo
          /guard mins > 0, mins < 60 else \{ return \.result\(\) \}/.test(intents) &&             // ≥60/≤0 no-op
          /armCurtail\(productionId, mins: mins\)/.test(intents) &&
          /Task\.sleep\(nanoseconds: UInt64\(TMLiveActivity\.curtailUndoWindow/.test(intents) &&
          /commitCurtailIfStillArmed\(productionId, stamp: stamp\)/.test(intents);
        return append && helper && writeOnlyInCommit && intent;
      })());
    check('TT11e WrapNowIntent commit-then-wrap — a fresh pending curtail (armed=="curtail") is FLUSHED (appendEvent lunchCurtail) before re-arming to wrap, so Wrap is never blocked and the curtail is never lost; the held CurtailIntent commit then no-ops (armed flips to wrap)',
      (() => {
        const intents = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineIntents.swift'), 'utf8');
        const wrap = (intents.match(/struct WrapNowIntent: LiveActivityIntent[\s\S]*?\n\}/) || [''])[0];
        return /cur\.armed == "curtail",[\s\S]{0,200}appendEvent\(type: "lunchCurtail", productionId: productionId, durationMins: cur\.curtailMins\)/.test(wrap) &&
          /arm\(productionId, action: "wrap"\)/.test(wrap) &&
          // the flush precedes the wrap arm
          wrap.indexOf('appendEvent(type: "lunchCurtail"') < wrap.indexOf('arm(productionId, action: "wrap")');
      })());
    check('TT11f SwiftUI lunchSlot — ENTRY gated on lunchLogged (stays Lunch now / Confirm? until lunch is started); then Undo·NNm (CurtailIntent) > Lunch NNm ✓ (disabled) > Back early? (CurtailIntent, native onLunch) > Full hour (disabled); exactly 4 Button(intent:) in the slot; wrap unchanged; lunchedFull/old signatures gone',
      (() => {
        const la = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineLiveActivity.swift'), 'utf8');
        const slot = (la.match(/private func lunchSlot[\s\S]*?\n\}/) || [''])[0];
        const sigOk = /private func lunchSlot\(_ productionId: String, armed: String, lunchLogged: Bool, curtailMins: Int, onLunch: Bool\)/.test(la) &&
          !/private func lunchButton/.test(la) && !/lunchedFull/.test(la);
        const phasesOk = /if !lunchLogged \{/.test(slot) &&                     // entry gate first
          /if armed == "lunch" \{/.test(slot) && /"Confirm\?"/.test(slot) && /"Lunch now"/.test(slot) &&
          /else if armed == "curtail" \{/.test(slot) && /"Undo · \\\(curtailMins\)m"/.test(slot) &&
          /else if curtailMins > 0 \{/.test(slot) && /ActionPill\(text: "Lunch \\\(curtailMins\)m ✓"/.test(slot) &&
          /else if onLunch \{/.test(slot) && /"Back early\?"/.test(slot) &&
          /ActionPill\(text: "Full hour"/.test(slot);
        // exactly 4 tappable phases (Lunch now/Confirm?, Undo, Back early?); 2
        // CurtailIntent (Undo + Back early?), 2 LunchNowIntent (Lunch now + Confirm?);
        // the 2 disabled phases are plain ActionPills with no intent.
        const tappableOk = (slot.match(/Button\(intent:/g) || []).length === 4 &&
          (slot.match(/CurtailIntent\(productionId: productionId\)/g) || []).length === 2 &&
          (slot.match(/LunchNowIntent\(productionId: productionId\)/g) || []).length === 2;
        const wiredOk = /lunchSlot\(productionId, armed: armed, lunchLogged: lunchLogged, curtailMins: curtailMins, onLunch: onLunch\)/.test(la) &&
          /private func actionButtons\(_ productionId: String, armed: String, lunchLogged: Bool, curtailMins: Int, onLunch: Bool\)/.test(la) &&
          /wrapButton\(productionId, armed: armed == "wrap"\)/.test(la);
        return sigOk && phasesOk && tappableOk && wiredOk;
      })());

    // ─ TT12: Group C — lunchLogged entry gate + native onLunch exit (planned≠logged) ─
    check('TT12a lunchLogged:true is written ONLY on actual lunch starts — card applyLunchNow (which ALSO overwrites the seeded start), in-app doLunch, and the today-only in-field NOW stamp; plain lunch-field typing stays PLANNED (no lunchLogged)',
      /mapDayNow\(production\.days, date, uid0, \{ lunchStartTime: t, lunchLogged: true \}\)/.test(html) &&
      /mapDayNow\(prev, todayStr, null, \{ lunchStartTime: lunchStr, lunchLogged: true \}\)/.test(html) &&
      /set\(\{ lunchStartTime: t, lunchLogged: true \}\); showToast\?\.\(`Lunch \$\{t\}`\)/.test(html) &&
      // the two plain lunch-start field edits do NOT set lunchLogged
      (html.match(/onChange=\{\(e\) => set\(\{ lunchStartTime: e\.target\.value \}\)\}/g) || []).length >= 2);
    check('TT12b new field is migration-safe — makeBlankDay seeds lunchLogged:false; migrateDay backfills with the wrapped-style date rule (past=true, today/future=false), guarded idempotent; no DEFAULT_USER_PREFS change',
      /wrapped: false,\s*lunchLogged: false,/.test(html) &&
      /if \(typeof d\.lunchLogged !== 'boolean'\) \{\s*d = \{ \.\.\.d, lunchLogged: !!\(d\.date && d\.date < todayISO\(\)\) \};/.test(html));
    check('TT12c calc NEVER reads lunchLogged — deriveBreakState, calculateDay and calculatePmpaDay (the pay engine) each contain no lunchLogged reference, so pay is driven by lunchStartTime/lunchDurationMins only (the byte-identical 84-scenario calc audit independently confirms zero drift)',
      (() => {
        // Capture each pay function up to the next top-level function — excludes the
        // migration/ingestion code (migrateDay, applyLunchNow) that legitimately
        // writes the flag.
        const bs   = (html.match(/function deriveBreakState\([\s\S]*?\n    function /) || [''])[0];
        const calc = (html.match(/function calculateDay\([\s\S]*?\n    function /) || [''])[0];
        const pmpa = (html.match(/function calculatePmpaDay\([\s\S]*?\n    function /) || [''])[0];
        return bs.length > 500 && calc.length > 500 && pmpa.length > 500 &&
          !/lunchLogged/.test(bs) && !/lunchLogged/.test(calc) && !/lunchLogged/.test(pmpa);
      })());
    check('TT12d native onLunch is the shared Date()-derived predicate — isOnLunch = lunchLogged && curtailMins==0 && lunchEndEpoch>0 && Date()<lunchEndEpoch — driving the chip, the timer slot AND the Back early?/Full-hour split, so the deadline resolves on the next render with no push; fed isOnLunch(context.state) at every surface',
      (() => {
        const la = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineLiveActivity.swift'), 'utf8');
        const predOk = /private func isOnLunch\(_ s: TimeMachineActivityAttributes\.ContentState\) -> Bool \{/.test(la) &&
          /s\.lunchLogged && s\.curtailMins == 0 && s\.lunchEndEpoch > 0 &&/.test(la) &&
          /Date\(\)\.timeIntervalSince1970 < s\.lunchEndEpoch/.test(la);
        const chipOk = /private func chipSlot\(state: String, cwd: Bool, onLunch: Bool\)/.test(la) &&
          /else if onLunch \{\s*stateChip\("lunch"\)/.test(la);
        // chip (2) + timerProjectionRow (2) + actionButtons (2) + compact dot (2)
        const fedOk = (la.match(/isOnLunch\(context\.state\)/g) || []).length >= 6;
        return predOk && chipOk && fedOk;
      })());
    check('TT12e Lunch-now confirm flips the card instantly (kills the post-confirm flicker) — confirmLunch sets lunchLogged=true + lunchEndEpoch=minute-floored-now + 3600 (matches the JS write so nothing flips on drain) + curtailMins=0 + disarm; the LunchNowIntent confirm calls confirmLunch, not the old update(state:"lunch")',
      (() => {
        const intents = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineIntents.swift'), 'utf8');
        const cl = (intents.match(/static func confirmLunch[\s\S]*?\n    \}/) || [''])[0];
        const helperOk = /let flooredMin = \(Date\(\)\.timeIntervalSince1970 \/ 60\)\.rounded\(\.down\) \* 60/.test(cl) &&
          /lunchEndEpoch: flooredMin \+ 3600/.test(cl) &&
          /curtailMins: 0, lunchLogged: true/.test(cl);
        const wiredOk = /await TMLiveActivity\.confirmLunch\(productionId\)/.test(intents) &&
          !/update\(productionId, state: "lunch"\)/.test(intents);
        return helperOk && wiredOk;
      })());

    // ─ TT13: Siri Stage B — activeShoot snapshot + "log my times" ingestion (JS) ─
    check('TT13a activeShoot snapshot — LiveActivity.setActiveShoot/clearActiveShoot are IS_NATIVE-gated bridges; the App effect writes {productionId,date:today} when the open shoot has a today day and clears otherwise (openId disambiguates multi-shoot-today)',
      /async setActiveShoot\(productionId, date\) \{\s*if \(!IS_NATIVE\) return;/.test(html) &&
      /async clearActiveShoot\(\) \{\s*if \(!IS_NATIVE\) return;/.test(html) &&
      /const prod = productions\.find\(p => p\.id === openId\);/.test(html) &&
      /if \(openId && prod && \(prod\.days \|\| \[\]\)\.some\(d => d\.date === today\)\) \{\s*LiveActivity\.setActiveShoot\(openId, today\);\s*\} else \{\s*LiveActivity\.clearActiveShoot\(\);/.test(html));
    check('TT13b applySetTimes — Siri "log my times" rides the SHARED mapDayNow write (resolveDay→calc apply), targets the user crew (getEffectiveUserCrewId), writes TIME fields ONLY (never wrapped/lunchLogged), call-only mirrors onCallChange derivations (lunch=call+5h, 2nd break=call+11h, wrapAuto); ingest filter + dispatch include setTimes',
      (() => {
        const fn = (html.match(/function applySetTimes\(production, date, ev, userPrefs\)[\s\S]*?\n    \}/) || [''])[0];
        const coreOk = /const uid0 = getEffectiveUserCrewId\(production, userPrefs\) \|\|/.test(fn) &&
          /const vr = resolveDay\(production, dayRecord, crewMember\);/.test(fn) &&
          /if \(!ev\.lunch\) patch\.lunchStartTime = toHHMM\(newCallH \+ 5\);/.test(fn) &&
          /patch\.secondBreakStartTime = toHHMM\(newCallH \+ 11\);/.test(fn) &&
          /const wrapAuto = parseHHMM\(vr\.wrapTime\) === null \|\|/.test(fn) &&
          /mapDayNow\(production\.days, date, uid0, patch\)/.test(fn);
        const timeOnly = !/wrapped/.test(fn) && !/lunchLogged/.test(fn);   // never the deliberate-action flags
        const wiredOk = /ev\.type !== 'setTimes'/.test(html) &&
          /ev\.type === 'setTimes'\s*\? applySetTimes\(next, ev\.date, ev, userPrefs\)/.test(html);
        return coreOk && timeOnly && wiredOk;
      })());
    check('TT13c LogMyTimes voice fix — LogMyTimesVoiceIntent is a plain AppIntent (NOT LiveActivityIntent) so Siri VOICE can run the spoken @Parameter elicitation; a LOAD-BEARING parameterSummary includes $spoken (else iOS 18 NSCocoaErrorDomain 4099 re-breaks the ask); requestConfirmation migrated to the modern dialog: form gated #available(iOS 18) with the deprecated result: form kept for the iOS 17 floor; the Wrap/Lunch voice intents stay LiveActivityIntent, untouched',
      (() => {
        const sc = fs.readFileSync(path.join(ROOT, 'ios/App/App/TimeMachineAppShortcuts.swift'), 'utf8');
        const conformanceOk = /struct LogMyTimesVoiceIntent: AppIntent \{/.test(sc) &&
          !/struct LogMyTimesVoiceIntent: LiveActivityIntent/.test(sc);
        const summaryOk = /static var parameterSummary: some ParameterSummary \{ Summary\("Log /.test(sc) &&
          /parameterSummary[\s\S]{0,90}spoken/.test(sc);
        // Stage A voice intents need no elicitation — must stay LiveActivityIntent
        const stageAOk = /struct WrapNowVoiceIntent: LiveActivityIntent \{/.test(sc) &&
          /struct LunchNowVoiceIntent: LiveActivityIntent \{/.test(sc);
        // confirmation migration present + availability-gated (modern + deprecated fallback)
        const confirmOk = /if #available\(iOS 18\.0, \*\) \{/.test(sc) &&
          /\.custom\(acceptLabel: "Log it", acceptAlternatives: \[\], denyLabel:/.test(sc) &&
          /requestConfirmation\(result: \.result\(dialog:/.test(sc);
        return conformanceOk && summaryOk && stageAOk && confirmOk;
      })());

    // ─ TT14: Overdue-invoice reminders — pref + bridge + helpers + sweep + tap ─
    // Pins the pure helpers (behavioural eval), the reconcile predicate, the
    // schedule/cancel side-channel shape, the TZ-safe fire date, the stable id,
    // the extra payload, and the deep-link tap (incl. the native retain that
    // covers cold launch). NONE of this touches calc — the byte-identical
    // 87-scenario calc audit independently confirms zero drift.
    //
    // Local extractors (the R-block's sliceBetween is out of scope here): pull a
    // `const NAME = (args) => <block|expr>;` slice and compile it to a callable.
    const sliceArrow = (src, startNeedle, endNeedle) => {
      const i = src.indexOf(startNeedle);
      if (i === -1) return null;
      const j = src.indexOf(endNeedle, i);
      if (j === -1) return null;
      return src.slice(i, j + endNeedle.length);
    };
    const evalArrow = (src) => {
      const expr = src.replace(/^const \w+ = /, '').replace(/;\s*$/, '');
      return new Function(`return (${expr});`)();
    };

    check('TT14a Notifications bridge — checkPermission/requestPermission/getPending/schedule/cancel/openIOSSettings each return a web-safe default BEFORE touching _capPlugins() unless IS_NATIVE (audit:web independently proves no Capacitor on web)',
      /const Notifications = \{/.test(html) &&
      /async checkPermission\(\) \{\s*if \(!IS_NATIVE\) return 'denied';/.test(html) &&
      /async requestPermission\(\) \{\s*if \(!IS_NATIVE\) return 'denied';/.test(html) &&
      /async getPending\(\) \{\s*if \(!IS_NATIVE\) return \[\];/.test(html) &&
      /async schedule\(notifications\) \{\s*if \(!IS_NATIVE \|\| !notifications \|\| !notifications\.length\) return;/.test(html) &&
      /async cancel\(ids\) \{\s*if \(!IS_NATIVE \|\| !ids \|\| !ids\.length\) return;/.test(html) &&
      /openIOSSettings\(\) \{\s*if \(!IS_NATIVE\) return;/.test(html) &&
      /_capPlugins\(\)\.LocalNotifications/.test(html));

    check('TT14b overdueRemindersEnabled — fresh default true in DEFAULT_USER_PREFS, additive merge-over-default (existing users inherit true via the useStoredState object merge; NO MIGRATIONS entry, NO SCHEMA_VERSION bump)',
      /overdueRemindersEnabled: true,/.test(html) &&
      /v = \{ \.\.\.initial, \.\.\.v \};/.test(html));

    check('TT14c overdueNotifId — deterministic stable 31-bit positive int from the STRING invoice id (same id → same id every run; distinct ids differ; empty/undefined safe; never 0/negative/>2^31-1)',
      (() => {
        const src = sliceArrow(html, 'const overdueNotifId = (invoiceId) => {', '};');
        if (!src) return false;
        const fn = evalArrow(src);
        const a = fn('inv-abc123'), b = fn('inv-abc123'), c = fn('inv-xyz789'), z = fn(''), u = fn(undefined);
        const is31 = (x) => Number.isInteger(x) && x > 0 && x <= 0x7fffffff;
        return a === b && a !== c && is31(a) && is31(c) && is31(z) && is31(u) && z === u;
      })());

    check('TT14d overdueFireDate — 08:00 LOCAL on dueDate+1, built from LOCAL Y/M/D components (TZ-safe: never UTC-parsed or toISOString-sliced); month + year rollover correct; malformed dueDate → null',
      (() => {
        const src = sliceArrow(html, 'const overdueFireDate = (dueDateISO) => {', '};');
        if (!src) return false;
        const fn = evalArrow(src);
        const base = (() => { const d = fn('2026-06-15'); return d && d.getFullYear() === 2026 && d.getMonth() === 5 && d.getDate() === 16 && d.getHours() === 8 && d.getMinutes() === 0 && d.getSeconds() === 0; })();
        const monthRoll = (() => { const d = fn('2026-06-30'); return d && d.getMonth() === 6 && d.getDate() === 1 && d.getHours() === 8; })();   // Jun 30 → Jul 1 08:00
        const yearRoll = (() => { const d = fn('2026-12-31'); return d && d.getFullYear() === 2027 && d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 8; })();   // Dec 31 → Jan 1 08:00
        const bad = fn('') === null && fn('not-a-date') === null && fn(undefined) === null;   // shape-gate (dueDate always comes from addDays)
        // source: the LOCAL constructor, and NO UTC slicing in the helper body
        const srcOk = /return new Date\(\+m\[1\], \+m\[2\] - 1, \+m\[3\] \+ 1, 8, 0, 0, 0\);/.test(src) && !/toISOString|getTimezoneOffset|Z'|T08:00/.test(src);
        return base && monthRoll && yearRoll && bad && srcOk;
      })());

    check('TT14e invoiceNeedsOverdueReminder — true ONLY for status===sent && !datePaid && dueDate present; draft / paid / datePaid-set / no-dueDate / null all false',
      (() => {
        const src = sliceArrow(html, 'const invoiceNeedsOverdueReminder = (inv) =>', ';');
        if (!src) return false;
        const fn = evalArrow(src);
        return fn({ status: 'sent', dueDate: '2026-06-01' }) === true &&
          fn({ status: 'sent', dueDate: '2026-06-01', datePaid: '2026-06-05' }) === false &&
          fn({ status: 'draft', dueDate: '2026-06-01' }) === false &&
          fn({ status: 'paid', dueDate: '2026-06-01' }) === false &&
          fn({ status: 'sent' }) === false &&
          fn(null) === false && fn(undefined) === false;
      })());

    check('TT14f reconcile sweep — whole-set reconcile against getPending: schedules ONE per qualifying invoice (id=overdueNotifId, extra={productionId,invoiceId}, schedule.at), cancels stale (ours-but-not-desired), leaves already-pending untouched (no churn); already-overdue → ~1 min out else the 08:00 day-after; copy carries the job name, NO amount / invoice number; IS_NATIVE-gated; writes NO day records',
      (() => {
        const sweep = sliceArrow(html, 'const overdueReconcile = React.useCallback(async () => {', '}, []);');
        if (!sweep) return false;
        const gatedOk = /if \(!IS_NATIVE\) return;/.test(sweep);
        const desiredOk = /if \(!invoiceNeedsOverdueReminder\(inv\)\) continue;/.test(sweep) &&
          /const fireAt = overdueFireDate\(inv\.dueDate\);/.test(sweep) &&
          /desired\.set\(overdueNotifId\(inv\.id\), \{ p, inv, fireAt \}\);/.test(sweep);
        const reconcileOk = /const pending = await Notifications\.getPending\(\);/.test(sweep) &&
          /if \(!n \|\| typeof n\.id !== 'number' \|\| !\(n\.extra && n\.extra\.invoiceId\)\) continue;/.test(sweep) &&
          /if \(!desired\.has\(n\.id\)\) toCancel\.push\(n\.id\);/.test(sweep) &&
          /if \(pendingOurs\.has\(id\)\) continue;/.test(sweep);
        const fireOk = /const at = fireAt\.getTime\(\) > NOW \+ 1000 \? fireAt : new Date\(NOW \+ 60 \* 1000\);/.test(sweep);
        // The EXACT title + body pins ARE the "no amount / no invoice number"
        // guarantee — the only user-facing strings, and neither interpolates a
        // figure or number (job name only).
        const payloadOk = /extra: \{ productionId: p\.id, invoiceId: inv\.id \},/.test(sweep) &&
          /schedule: \{ at \},/.test(sweep) &&
          /title: 'Invoice overdue',/.test(sweep) &&
          /body: `\$\{p\.title \|\| 'Your'\} invoice is now overdue\. Chase it\?`,/.test(sweep);
        const applyOk = /if \(toCancel\.length\) await Notifications\.cancel\(toCancel\);/.test(sweep) &&
          /if \(toSchedule\.length\) await Notifications\.schedule\(toSchedule\);/.test(sweep);
        const calcNeutralOk = !/setProductions\(|setDays\(|setProduction\(/.test(sweep);
        return gatedOk && desiredOk && reconcileOk && fireOk && payloadOk && applyOk && calcNeutralOk;
      })());

    check('TT14g tap → deep-link — localNotificationActionPerformed listener routes extra.{productionId,invoiceId} → openProduction(pid,{invoiceId}); dismiss ignored; IS_NATIVE-gated; cold launch covered by the SAME listener (native didReceive posts retainUntilConsumed:true, replayed on attach — no getLaunchNotification path needed)',
      (() => {
        const handlerOk = /if \(!ev \|\| ev\.actionId === 'dismiss'\) return;/.test(html) &&
          /const extra = ev\.notification && ev\.notification\.extra;/.test(html) &&
          /const pid = extra && extra\.productionId;/.test(html) &&
          /openProduction\(pid, invoiceId \? \{ invoiceId \} : \{\}\);/.test(html);
        const registerOk = /addListener\('localNotificationActionPerformed', onAction\)/.test(html) &&
          /const p = _capPlugins\(\)\.LocalNotifications;/.test(html);
        // The cold-launch guarantee is the plugin's retainUntilConsumed in
        // didReceive — pin it so a dep bump that drops it trips this assertion
        // (and we re-verify cold launch on device).
        let nativeRetain = false;
        try {
          const handler = fs.readFileSync(path.join(ROOT, 'node_modules/@capacitor/local-notifications/ios/Sources/LocalNotificationsPlugin/LocalNotificationsHandler.swift'), 'utf8');
          nativeRetain = /notifyListeners\("localNotificationActionPerformed", data: data, retainUntilConsumed: true\)/.test(handler);
        } catch (_) {}
        return handlerOk && registerOk && nativeRetain;
      })());

    check('TT14h Settings toggle + contextual permission — IS_NATIVE-gated "Overdue reminders" toggle bound to overdueRemindersEnabled (denied state → Open Settings); permission requested on toggle-on AND in BOTH send paths (editor sendInvoice + App handleUpdateInvoice), gated on status===sent && toggle on; SettingsScreen mount only CHECKS (never requests → never on launch)',
      /value=\{userPrefs\.overdueRemindersEnabled !== false\}/.test(html) &&
      /onChange=\{async \(v\) => \{ set\(\{ overdueRemindersEnabled: v \}\); if \(v\) setNotifPerm\(await Notifications\.requestPermission\(\)\); \}\}/.test(html) &&
      /notifPerm === 'denied'/.test(html) &&
      /onClick=\{\(\) => Notifications\.openIOSSettings\(\)\}/.test(html) &&
      (html.match(/if \(frozenPatch && frozenPatch\.status === 'sent' && userPrefs\.overdueRemindersEnabled !== false\) \{\s*Notifications\.requestPermission\(\);/g) || []).length === 2 &&
      /useEffect\(\(\) => \{ if \(IS_NATIVE\) Notifications\.checkPermission\(\)\.then\(setNotifPerm\); \}, \[\]\);/.test(html));

    // ─ TT15: Second app icon ("Scribble") — bridge + Settings picker (+ native) ─
    // The web build must never touch the AppIcon native bridge (audit:web also
    // proves this); every JS path is IS_NATIVE-guarded. No stored pref — iOS owns
    // the alternate-icon name, the picker just mirrors it. Calc untouched (the
    // byte-identical scenario audit confirms zero drift).
    check('TT15a AppIcon bridge — get/set each return the web-safe "default" BEFORE touching _capPlugins() unless IS_NATIVE (audit:web independently proves no Capacitor on web)',
      /const AppIcon = \{/.test(html) &&
      /async get\(\) \{\s*if \(!IS_NATIVE\) return 'default';/.test(html) &&
      /async set\(name\) \{\s*if \(!IS_NATIVE\) return 'default';/.test(html) &&
      /_capPlugins\(\)\.AppIcon/.test(html) &&
      /await p\.getAppIcon\(\)/.test(html) &&
      /await p\.setAppIcon\(\{ name: name \|\| 'default' \}\)/.test(html));
    check('TT15b Settings app-icon picker — IS_NATIVE-gated (hidden on web); reads the LIVE name via AppIcon.get() on mount (NO stored pref); Default/Scribble cards set via AppIcon.set() on choice and reconcile with the returned name; the choice handler writes no userPrefs (no set(...))',
      /const \[iconName, setIconName\] = useState\('default'\);/.test(html) &&
      /useEffect\(\(\) => \{ if \(IS_NATIVE\) AppIcon\.get\(\)\.then\(setIconName\); \}, \[\]\);/.test(html) &&
      /\{IS_NATIVE && \([\s\S]{0,220}>App icon<\/div>/.test(html) &&
      /\{ key: 'Scribble', label: 'Scribble'/.test(html) &&
      /onClick=\{\(\) => \{ setIconName\(opt\.key\); AppIcon\.set\(opt\.key\)\.then\(setIconName\); \}\}/.test(html));
    check('TT15c native wiring — AppIconPlugin (jsName AppIcon, getAppIcon/setAppIcon, main-thread + supportsAlternateIcons-guarded setAlternateIconName) registered in MainViewController; Scribble.appiconset in the catalog; ALTERNATE_APPICON_NAMES=Scribble + INCLUDE_ALL_APPICON_ASSETS=YES in BOTH app-target configs; the plugin compiled (Sources)',
      (() => {
        const readSafe = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return ''; } };
        const plugin = readSafe('ios/App/App/AppIconPlugin.swift');
        const mvc = readSafe('ios/App/App/MainViewController.swift');
        const pbx = readSafe('ios/App/App.xcodeproj/project.pbxproj');
        const contents = readSafe('ios/App/App/Assets.xcassets/Scribble.appiconset/Contents.json');
        const pluginOk = /@objc\(AppIconPlugin\)/.test(plugin) && /public let jsName = "AppIcon"/.test(plugin) &&
          /func getAppIcon\(_ call: CAPPluginCall\)/.test(plugin) && /func setAppIcon\(_ call: CAPPluginCall\)/.test(plugin) &&
          /UIApplication\.shared\.setAlternateIconName/.test(plugin) && /supportsAlternateIcons/.test(plugin) &&
          /DispatchQueue\.main\.async/.test(plugin);
        const regOk = /registerPluginInstance\(AppIconPlugin\(\)\)/.test(mvc);
        const buildOk = (pbx.match(/ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = Scribble;/g) || []).length === 2 &&
          (pbx.match(/ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS = YES;/g) || []).length === 2 &&
          /AppIconPlugin\.swift in Sources/.test(pbx);
        const assetOk = /Scribble-1024\.png/.test(contents);
        return pluginOk && regOk && buildOk && assetOk;
      })());

    // ─ TT16: wrap curve — the card freezes the CORRECT total at a card wrap ─
    check('TT16a wrap curve (JS) — descriptor precomputes flattened [epoch,pence] pairs by sampling the calc engine at 30-min OT boundaries (hypothetical-wrap probes off otFrom; empty when wrapped / no hourly-OT line / probe failure), and the curve flows into return, sig and start/update payload',
      (() => {
        const descFn2 = (html.match(/function liveActivityDescriptor[\s\S]*?\n    \}/) || [''])[0];
        return /let wrapCurve = \[\];/.test(descFn2) &&
          /wrapCurve\.push\(bEpoch, Math\.round\(t \* 100\)\);/.test(descFn2) &&
          /calcForDisplay\(production, \{ \.\.\.rec, wrapTime: hhmm, wrapNextDay: nextDay \}, soloCrew, prevDay\)/.test(descFn2) &&
          /curtailMins, lunchLogged, wrapCurve \};/.test(descFn2) &&
          /ll: desc\.lunchLogged, wc: desc\.wrapCurve \}/.test(html) &&
          /lunchLogged: desc\.lunchLogged, wrapCurve: desc\.wrapCurve \};/.test(html);
      })());
    check('TT16b wrap curve (native) — ContentState carries wrapCurve: [Double] (init-defaulted [] so pre-curve payloads decode); the plugin reads it on start AND update; every intent-side reconstruction preserves it (8 sites); endWrapped freezes totalText via wrapTotalText (FIRST breakpoint ≥ now — the crew-favour round-up), falling back to the pushed total on an empty curve; gbpText byte-matches fmtGBP',
      (() => {
        const readSafe = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return ''; } };
        const attrs = readSafe('ios/App/TimeMachineWidget/TimeMachineActivityAttributes.swift');
        const plugin = readSafe('ios/App/App/LiveActivityPlugin.swift');
        const intents = readSafe('ios/App/TimeMachineWidget/TimeMachineIntents.swift');
        const schemaOk = /public var wrapCurve: \[Double\]/.test(attrs) &&
          /wrapCurve: \[Double\] = \[\]/.test(attrs);
        const pluginOk = (plugin.match(/call\.getArray\("wrapCurve"\)/g) || []).length >= 2 &&
          (plugin.match(/lunchLogged: lunchLogged, wrapCurve: wrapCurve/g) || []).length >= 2;
        const intentsOk = (intents.match(/wrapCurve: cur\.wrapCurve/g) || []).length >= 8 &&
          /totalText: wrapTotalText\(cur\),/.test(intents) &&
          /guard s\.wrapCurve\.count >= 2 else \{ return s\.totalText \}/.test(intents) &&
          /if s\.wrapCurve\[i\] >= now \{ pence = s\.wrapCurve\[i \+ 1\]; break \}/.test(intents);
        return schemaOk && pluginOk && intentsOk;
      })());

    // ─ TT17: solo wrap-edit intent — in-app wrap ends the card like card wrap ─
    check('TT17a applySoloWrapIntent — fires ONLY on a wrapTime/wrapNextDay change; a PASSED wrap moment sets wrapped:true (the card-wrap flag → same WRAPPED send-off), a future/cleared wrap clears it; call-relative next-day handling (wrap < call or explicit wrapNextDay → +24h) protects night shifts; wired into BOTH solo write paths (dayOnChange + handleDayChange); reconcile qualifies excludes wrapped days',
      (() => {
        const fn = (html.match(/function applySoloWrapIntent\(prevDay, nextDay\)[\s\S]*?\n    \}/) || [''])[0];
        const fnOk = /if \(nextDay\.wrapTime === prevDay\.wrapTime && !!nextDay\.wrapNextDay === !!prevDay\.wrapNextDay\) return nextDay;/.test(fn) &&
          /const nextDayShift = nextDay\.wrapNextDay === true \|\| \(callH != null && wrapH < callH\);/.test(fn) &&
          /if \(passed && nextDay\.wrapped !== true\) return \{ \.\.\.nextDay, wrapped: true \};/.test(fn) &&
          /if \(!passed && nextDay\.wrapped === true\) return \{ \.\.\.nextDay, wrapped: false \};/.test(fn);
        const wiredOk = /prev\.map\(d => d\.id === day\.id \? applySoloWrapIntent\(d, updatedDay\) : d\)/.test(html) &&
          /prev\.map\(d => d\.id === currentDay\.id \? applySoloWrapIntent\(d, updatedDay\) : d\)/.test(html);
        const sweepOk = /const qualifies = enabled && !!rec && rec\.wrapped !== true && !!\(rec\.callTime \|\| \(dd && dd\.callTime\)\);/.test(html);
        return fnOk && wiredOk && sweepOk;
      })());
  }

  // IM — Invoice email method ("Apple Mail" composer vs "Another app" / share
  // sheet). The method pref + the share/clipboard path are native; the web build
  // keeps the mailto: path (audit:web independently proves the web build stays
  // clean — no Capacitor). Source-presence only.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');

    check('IM1 additive pref — invoiceEmailMethod defaults to appleMail in DEFAULT_USER_PREFS; inherited by existing users via the useStoredState object merge (NO MIGRATIONS entry, NO SCHEMA_VERSION bump)',
      /invoiceEmailMethod: 'appleMail',/.test(html) &&
      /v = \{ \.\.\.initial, \.\.\.v \};/.test(html));

    check('IM2 shared subject/body builder — ONE buildInvoiceEmailContent feeds ALL send paths (web mailto + native composer/share-text) so the wording cannot drift; the body template now exists EXACTLY ONCE (in the builder, not re-inlined per path)',
      /function buildInvoiceEmailContent\(invoice\) \{/.test(html) &&
      /const \{ subject, body \} = buildInvoiceEmailContent\(invoice\);/.test(html) &&   // web mailto
      /const \{ subject, body \} = buildInvoiceEmailContent\(inv\);/.test(html) &&       // native effect
      (html.match(/Please find attached invoice/g) || []).length === 1);

    check('IM3 method routing — appleMail (with a Mail account) → EmailComposer.open; shareSheet OR no Mail account → the share-sheet path; the chosen method is carried into nativeSendInvoiceEmail from a userPrefs-seeded ref',
      /if \(method !== 'shareSheet' && hasAccount\) \{/.test(html) &&
      /await EmailComposer\.open\(\{/.test(html) &&
      /emailMethodRef\.current = userPrefs\.invoiceEmailMethod \|\| 'appleMail';/.test(html) &&
      /subject, body, base64, filename, method,/.test(html));

    check('IM4 share-sheet path — body sent ALONE as the share text (subject-fold REMOVED; the mail app derives the subject from the filename and the body names the invoice no.); paragraph breaks PRESERVED by routing through the app ShareSheet plugin (body as HTML→NSAttributedString so Gmail keeps the \\n\\n) with a @capacitor/share fallback that also shares the body alone; recipient copied pre-sheet; one-tap Copy Cc',
      // fix #2: the subject-fold is GONE; the @capacitor/share fallback shares the body alone
      !/const shareText = subject \? `\$\{subject\}\\n\\n\$\{body\}` : body;/.test(html) &&
      /await nativeSaveAndShare\(filename, base64, \{ title: filename, text: body \}\)/.test(html) &&
      // fix #1: the HTML builder + the ShareSheet plugin route (body-only html + plain)
      /function invoiceBodyToHtml\(body\) \{/.test(html) &&
      /await ShareSheet\.shareEmail\(\{ subject, html: invoiceBodyToHtml\(body\), plain: body, fileUri: uri \}\)/.test(html) &&
      // recipient + cc clipboard steps unchanged
      /if \(onShareFallback\) \{ try \{ await onShareFallback\(\); \} catch \(_\) \{\} \}/.test(html) &&
      /await navigator\.clipboard\.writeText\(recip\)/.test(html) &&
      /await navigator\.clipboard\.writeText\(cc\)/.test(html));
    check('IM6 native ShareSheet plugin — escaped HTML body (escapeHtml BEFORE the <br> substitution) parsed to an NSAttributedString and vended via UIActivityItemSource (mail → HTML body with paragraphs; non-mail → plain .string, so it can never regress to raw tags), registered in MainViewController',
      /function escapeHtml\(s\) \{/.test(html) &&
      /escapeHtml\(body\)\.replace\(\/\\n\/g, '<br>'\)/.test(html) &&   // escape THEN \n→<br> (order is load-bearing; \n\n→<br><br>)
      (() => {
        const readSafe = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return ''; } };
        const plugin = readSafe('ios/App/App/ShareSheetPlugin.swift');
        const mvc = readSafe('ios/App/App/MainViewController.swift');
        return /@objc\(ShareSheetPlugin\)/.test(plugin) && /public let jsName = "ShareSheet"/.test(plugin) &&
          /func shareEmail\(_ call: CAPPluginCall\)/.test(plugin) &&
          /: NSObject, UIActivityItemSource/.test(plugin) &&
          /NSAttributedString\.DocumentType\.html/.test(plugin) &&
          /registerPluginInstance\(ShareSheetPlugin\(\)\)/.test(mvc);
      })());

    check('IM5 Settings picker — IS_NATIVE-gated (hidden on web, which keeps mailto), two RoundingOptionCard options bound to invoiceEmailMethod (appleMail / shareSheet), the trade-off spelled out in the card descriptions',
      /Send invoices via/.test(html) &&
      /onClick=\{\(\) => set\(\{ invoiceEmailMethod: 'appleMail' \}\)\}/.test(html) &&
      /onClick=\{\(\) => set\(\{ invoiceEmailMethod: 'shareSheet' \}\)\}/.test(html) &&
      /The share sheet can't carry a recipient/.test(html));
  }

  // UU — AI call-sheet reader, Stage 2 (shoot-level review-sheet UX). The WEB
  // build must never touch the CallSheet native bridge (audit:web also proves
  // this); every JS path is IS_NATIVE-guarded. CORE PRINCIPLE — no new write
  // path: "Apply to shoot" routes through the SAME setProduction merge the
  // production-settings inputs use on change; the importer never touches
  // storage/userPrefs. The Swift pipeline lives outside index.html
  // (ios/App/App/CallSheetPlugin.swift) so it can't affect any audit.
  // Source-presence only.
  {
    const html = fs.readFileSync(SRC_HTML, 'utf8');
    const importFn = (html.match(/function CallSheetImport\(\{ production, setProduction, userPrefs, autoFile, onImportApplied \}\)[\s\S]*?\n    \}\n\n    function SettingsScreen/) || [''])[0];

    check('UU1a CallSheet bridge defines isAvailable/pickDocument/extract, each returning BEFORE touching _capPlugins() unless IS_NATIVE',
      /const CallSheet = \{/.test(html) &&
      /async isAvailable\(\) \{\s*if \(!IS_NATIVE\) return \{ available: false, reason: 'web' \};/.test(html) &&
      /async pickDocument\(\) \{\s*if \(!IS_NATIVE\) return null;/.test(html) &&
      /async extract\(path\) \{\s*if \(!IS_NATIVE\) return null;/.test(html) &&
      /_capPlugins\(\)\.CallSheet/.test(html));
    check('UU1b importer self-gates — IS_NATIVE + availability (available / appleIntelligenceNotEnabled / modelNotReady); web and ineligible devices render null; not-enabled/not-ready get hint lines',
      /function CallSheetImport\(\{ production, setProduction, userPrefs, autoFile, onImportApplied \}\)/.test(html) &&
      /const visible = IS_NATIVE && avail && \(avail\.available \|\| avail\.reason === 'appleIntelligenceNotEnabled' \|\| avail\.reason === 'modelNotReady'\);/.test(html) &&
      /if \(!visible\) return null;/.test(html) &&
      /turn on Apple Intelligence in Settings\./.test(html) &&
      /preparing - try again shortly\./.test(html));
    check('UU1c no new write path — Apply is ONE setProduction merge (the form\'s own pattern); the importer never touches storage.set/setUserPrefs/setProductions',
      importFn.length > 0 &&
      /setProduction\(p => \(\{ \.\.\.p, \.\.\.patch \}\)\)/.test(importFn) &&
      (importFn.match(/setProduction\(/g) || []).length === 1 &&
      !/storage\.set|setUserPrefs\(|setProductions\(/.test(importFn));
    check('UU1d review-sheet states — quiet verified with p.N page ref; amber unverified with the check-before-applying reason; dashed missing tap-to-enter; replaces diff line shown up front',
      /Couldn't locate on document - check before applying/.test(html) &&
      /Not found - tap to enter/.test(html) &&
      /p\.\{st\.page\}/.test(html) &&
      /replaces: \{current\}/.test(html) &&
      /border-dashed/.test(importFn));
    check('UU1e saved-client linkage via the EXISTING matcher — exact-name match through matchClientsByPrefix, clientId + canonical name applied like manual ClientPicker selection; match indicated on the prodCo row',
      /matchClientsByPrefix\(\(userPrefs && userPrefs\.clients\) \|\| \[\], v\)/.test(importFn) &&
      /patch\.clientId = matchedClient\.id;/.test(importFn) &&
      /Matches saved client · \{matchedClient\.name\}/.test(importFn));
    check('UU1f Stage 2 entry lives at SHOOT level and the dev panel is fully retired — mounted inside ProductionSettingsSheet\'s invoicing section; no CallSheetDevPanel anywhere; AI-extraction footer present',
      /<CallSheetImport production=\{production\} setProduction=\{setProduction\} userPrefs=\{userPrefs\} autoFile=\{importFile\} onImportApplied=\{onImportApplied\} \/>/.test(html) &&
      !/CallSheetDevPanel/.test(html) &&
      /Extracted on-device by Apple Intelligence - verify each field\./.test(html));

    // ── Stage 3 — acquisition breadth ──
    check('UU1g Stage 3 bridge sources are IS_NATIVE-guarded (pickPhotos / scanDocument / ingestShared) and extract accepts an array of image paths as pages',
      /async pickPhotos\(\) \{\s*if \(!IS_NATIVE\) return null;/.test(html) &&
      /async scanDocument\(\) \{\s*if \(!IS_NATIVE\) return null;/.test(html) &&
      /async ingestShared\(url\) \{\s*if \(!IS_NATIVE\) return null;/.test(html) &&
      /Array\.isArray\(path\) \? \{ paths: path \} : \{ path \}/.test(html));
    check('UU1h source chooser — one extra tap, three sources, camera row gated on the device scanner flag; every source funnels into the SAME runExtract',
      /title="Import from…"/.test(importFn) &&
      /\{ key: 'files', label: 'Files'/.test(importFn) &&
      /\{ key: 'photos', label: 'Photos'/.test(importFn) &&
      /avail\.scanner \? \[\{ key: 'camera', label: 'Camera'/.test(importFn) &&
      /const pickFrom = async \(source\) => \{/.test(importFn) &&
      // two call sites: pickFrom (all three sources funnel through it) + the
      // share-in autoFile consumption effect
      (importFn.match(/runExtract\(/g) || []).length === 2);
    check('UU1i share-in routing — appUrlOpen listener + cold-start getLaunchUrl (IS_NATIVE-gated) → native ingest → "Import call sheet into…" chooser (New shoot + recents) → openProduction importFile deep-link / cached-result attach; one-shot autoFile consumption in the importer',
      /addListener\('appUrlOpen', \(d\) => \{ if \(d && d\.url\) handleUrl\(d\.url\); \}\)/.test(html) &&
      /AppPlg\.getLaunchUrl\(\)/.test(html) &&
      /await CallSheet\.ingestShared\(url\)/.test(html) &&
      /title="Import call sheet into…"/.test(html) &&
      /openProduction\(productionId, \{ importFile: \{ path: file\.path \} \}\)/.test(html) &&
      // New-shoot path: the cached result is staged BEFORE creation (after
      // closeProduction, which clears it — order matters) so the new page
      // mounts with initialImportFile already present, exactly like the
      // existing-shoot openProduction path. A late [openId]-keyed attach
      // effect raced the one-shot prop capture and is asserted ABSENT.
      /closeProduction\(\);[\s\S]{0,120}setOpenImportFile\(r && r\.perField \? \{ result: r, path: file\.path \} : null\);\s*setShowNewProduction\(true\);/.test(html) &&
      !/setOpenImportFile\(\{ result: pendingNewImport\.result \}\)/.test(html) &&
      /initialTitle=\{\(openImportFile && openImportFile\.result && openImportFile\.result\.fields && openImportFile\.result\.fields\.title\) \|\| ''\}/.test(html) &&
      /initialImportFile=\{openImportFile\}/.test(html) &&
      /const \[pendingImportFile, setPendingImportFile\] = useState\(\(\) => initialImportFile \|\| null\);/.test(html) &&
      /autoConsumedRef\.current = true;/.test(importFn));
    check('UU1j Info.plist carries the share-in document types + the camera usage string; the Stage 2 single-merge write path is STILL the only write (no second setProduction in the importer)',
      (() => {
        const plist = fs.readFileSync(path.join(ROOT, 'ios/App/App/Info.plist'), 'utf8');
        return /NSCameraUsageDescription/.test(plist) &&
          /TimeMachine uses the camera to scan call sheets for import\./.test(plist) &&
          /CFBundleDocumentTypes/.test(plist) &&
          /com\.adobe\.pdf/.test(plist) &&
          /public\.image/.test(plist) &&
          /LSSupportsOpeningDocumentsInPlace/.test(plist);
      })() &&
      (importFn.match(/setProduction\(/g) || []).length === 1);
    check('UU1k hooks-order guard (React #310) — every hook in CallSheetImport registers BEFORE the `if (!visible) return null` gate (positional: last useState/useEffect/useRef index < gate index), so the hook count never changes between the gated first render and the post-availability render',
      (() => {
        const gate = importFn.indexOf('if (!visible) return null;');
        const lastHook = Math.max(
          importFn.lastIndexOf('useState('),
          importFn.lastIndexOf('useEffect('),
          importFn.lastIndexOf('useRef(')
        );
        return gate !== -1 && lastHook !== -1 && lastHook < gate;
      })());

    // ── Stage 3.5 — input-quality honesty + correction UX ──
    check('UU1l weak-OCR banner is present and NON-BLOCKING — exact copy, gated only on native quality metrics, and the field rows render unconditionally after it (banner index < rows index)',
      /This image was hard to read - text may be too small\. Zoomed screenshots \(e\.g\. the invoicing section\) or sharing the PDF itself work best\./.test(importFn) &&
      /result && result\.quality && result\.quality\.weakPages && result\.quality\.weakPages\.length > 0/.test(importFn) &&
      /\{FIELDS\.map\(reviewRow\)\}/.test(importFn) &&
      importFn.indexOf('This image was hard to read') < importFn.indexOf('{FIELDS.map(reviewRow)}'));
    check('UU1m select-on-sheet — pageRuns bridge is IS_NATIVE-guarded and READ-ONLY (loads via convertFileSrc, no storage verbs); native one-finger scroll (touch-action pan-x pan-y) + two-finger pinch; replace-then-append join rule (newline for the address, space otherwise); field-shape re-checked on Done; commits via setEdits only (the single-merge Apply is untouched — UU1j re-proves one setProduction)',
      /async pageRuns\(path, page\) \{\s*if \(!IS_NATIVE\) return null;/.test(html) &&
      /window\.Capacitor\.convertFileSrc/.test(importFn) &&
      /const joinFor = \(key\) => \(key === 'invoicingAddress' \? '\\n' : ' '\);/.test(importFn) &&
      /const verified = shapeCheck\(verifyKey, v\)\.ok;/.test(importFn) &&
      /touchAction: 'pan-x pan-y'/.test(importFn) &&
      /Select on sheet/.test(importFn) &&
      !/storage\.set|setUserPrefs\(|setProductions\(/.test(importFn));
    check('UU1n photos tip caption + explicit edit affordance in the verify view',
      /Tip: zoomed screenshots read best - try one of the masthead and one of the invoicing section\./.test(importFn) &&
      /Value - tap to edit/.test(importFn));
    // ── Prompt (2) — CC secondary email + field-shape validation + LA wording ──
    check('UU1o CC secondary invoicing email maps to the EXISTING ccEmail field (no schema change), through the SAME single-merge Apply (one setProduction in the importer)',
      /\{ key: 'ccEmail', label: 'CC email', target: 'ccEmail' \},/.test(importFn) &&
      (importFn.match(/setProduction\(/g) || []).length === 1);
    check('UU1p field-shape validation EXTENDS match-back — email keys checked for name@domain.tld, address for a UK postcode; a shape failure shows the value but stays UNVERIFIED (amber) with a reason; verified-via-shape on select/typed',
      /const EMAIL_KEYS = new Set\(\['invoicingEmail', 'ccEmail'\]\);/.test(importFn) &&
      /const UK_POSTCODE_RE = /.test(importFn) &&
      /Doesn't look like an email/.test(importFn) &&
      /No postcode found - check the address/.test(importFn) &&
      /const unverified = hasVal && \(!shape\.ok \|\| /.test(importFn));
    check('UU1q Live Activity lunch label is "ON LUNCH" (not "AT LUNCH") in the widget chip',
      (() => {
        const la = fs.readFileSync(path.join(ROOT, 'ios/App/TimeMachineWidget/TimeMachineLiveActivity.swift'), 'utf8');
        return /case "lunch":\s*return "ON LUNCH"/.test(la) && !/return "AT LUNCH"/.test(la);
      })());
    // ── Prompt (2b) — email extraction regression + select-on-sheet gaps ──
    check('UU1r email extraction is deterministic (regex, no model) — a shared extractEmails helper pulls address token(s); used by select-on-sheet (line → token; a 2nd distinct address → ccEmail) AND by the email shape check; the native extraction path post-processes the same way',
      /const extractEmails = \(s\) => \{/.test(importFn) &&
      /if \(EMAIL_KEYS\.has\(verifyKey\)\) \{\s*const tokens = extractEmails\(v\);/.test(importFn) &&
      /editUpd\.ccEmail = tokens\[1\];/.test(importFn) &&
      /extractEmails\(v\)\.length >= 1/.test(importFn) &&
      (() => {
        const sw = fs.readFileSync(path.join(ROOT, 'ios/App/App/CallSheetPlugin.swift'), 'utf8');
        return /static func extractEmails\(_ s: String\) -> \[String\]/.test(sw) && /let primaryTokens = extractEmails\(primaryRaw\)/.test(sw);
      })());
    check('UU1s select-on-sheet covers ALL pages — loadPage/gotoPage keyed on pageCount, opens on the field\'s detected page (defaultPageFor), Prev/Next nav with "Page X of N"',
      /const loadPage = async \(page\) => \{/.test(importFn) &&
      /const gotoPage = \(p\) => \{ if \(selectMode && selectMode !== 'loading' && p >= 1 && p <= selectMode\.pageCount\) loadPage\(p\); \};/.test(importFn) &&
      /await loadPage\(defaultPageFor\(verifyKey\)\);/.test(importFn) &&
      /Page \{selectMode\.page\} of \{selectMode\.pageCount\}/.test(importFn));
    check('UU1t pinch restored alongside native scroll — a NON-PASSIVE touchmove listener (React onTouchMove is passive) preventDefaults during a two-finger pinch and scales 1–4×, while one finger scrolls natively (touch-action pan-x pan-y); pointer-event pinch removed',
      /el\.addEventListener\('touchmove', onMove, \{ passive: false \}\)/.test(importFn) &&
      /if \(e\.touches\.length === 2 && P\.startDist > 0\) \{\s*e\.preventDefault\(\);/.test(importFn) &&
      /touchAction: 'pan-x pan-y'/.test(importFn) &&
      !/onPointerDown=\{onSelPointerDown\}/.test(importFn));
    // ── Prompt (2c) — deterministic invoicing-email harvest with proximity scoring ──
    check('UU1u email fields use the deterministic harvest as the PRIMARY source (regex every address + proximity scoring: invoicing-intent keywords positive, crew-context/phone/cluster demotions); model is fallback-only; harvested email verified with a crop from its position',
      (() => {
        const sw = fs.readFileSync(path.join(ROOT, 'ios/App/App/CallSheetPlugin.swift'), 'utf8');
        return /static func harvestInvoicingEmails\(_ pages: \[SourcePage\]\) -> \(primary: EmailHit\?, cc: EmailHit\?\)/.test(sw) &&
          /static let invoiceIntentKeywords =/.test(sw) &&
          /static let crewContextKeywords =/.test(sw) &&
          /if positive == 0 \{ continue \}/.test(sw) &&                       // crew-safe: no invoicing intent → not a candidate
          /let harvest = harvestInvoicingEmails\(pages\)/.test(sw) &&         // used in run()
          /if let primary = harvest\.primary \{\s*setHarvested\("invoicingEmail", primary\)/.test(sw) && // primary source
          /\} else \{[\s\S]{0,200}FALLBACK — no scored invoicing email/.test(sw) &&  // model is fallback-only
          /if let crop = cropImage\(for: hit\.range, on: page\) \{ e\["crop"\] = crop \}/.test(sw); // crop from position
      })());
    // ── Prompt (2d) — title prefers the labelled production field, rejects boilerplate ──
    check('UU1v title uses a deterministic LABEL harvest first (production/brand labels rank above campaign/project), rejects call-sheet boilerplate (call sheet / shoot day / DAY N OF N / weekday+date), masthead-line fallback for label-less sheets, model only when non-boilerplate — used as the title source in run()',
      (() => {
        const sw = fs.readFileSync(path.join(ROOT, 'ios/App/App/CallSheetPlugin.swift'), 'utf8');
        return /static let titleLabels = \["production:", "production title:", "client:", "title:", "project:", "job name:", "campaign:"\]/.test(sw) && // priority order, brand above campaign
          /static func isTitleBoilerplate\(_ s: String\) -> Bool/.test(sw) &&
          /v\.contains\("call sheet"\)/.test(sw) &&
          /"day\\\\s\+\\\\d\+\\\\s\+of\\\\s\+\\\\d\+"/.test(sw) &&                       // DAY N OF N
          /static func harvestTitle\(_ pages: \[SourcePage\]\)/.test(sw) &&
          /static func mastheadTitle\(_ pages: \[SourcePage\]\)/.test(sw) &&
          /if let labelled = harvestTitle\(pages\) \{\s*setHarvestedTitle\(labelled\)/.test(sw) &&  // label harvest is primary
          /if modelTitle\.isEmpty \|\| isTitleBoilerplate\(modelTitle\)/.test(sw);          // model kept only if non-boilerplate
      })());
  }

  // K3 — IDB UNHEALTHY → LS-as-primary, not partial IDB. A broken

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
