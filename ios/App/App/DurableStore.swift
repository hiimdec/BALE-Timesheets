//
//  DurableStore.swift
//  App
//
//  "Saved" finally means saved (founder-ruled 2026-09-04). The record
//  (bigals_productions) used to persist through Capacitor Preferences, which
//  resolves on UserDefaults.set - the value is in the process's cache and
//  handed to cfprefsd asynchronously. A kill inside that gap lost a confirmed
//  curtail twice on device, and synchronize() measured 0 ms without landing
//  anything. This store writes an ATOMIC FILE instead: a temp file then a
//  rename, so a kill leaves the old file or the new one, never a torn one,
//  and the bytes are in the kernel's cache when write() returns - a kill
//  cannot take them back. Scoped to the record: the one key that is money.
//
//  Pure Foundation, no Capacitor, so scripts/native-audit/durable-store.js
//  compiles it with swiftc and EXECUTES the pins in a temp directory. The
//  plugin (DurableStorePlugin.swift) is the thin Capacitor face.
//

import Foundation

enum DurableStore {
    static let dirName = "tm-durable"

    struct Info {
        let bytes: Int
        let mtimeMs: Int
    }

    enum StoreError: Error { case invalidKey }

    /// Keys are file names: letters, digits, underscore, dot, dash; never a path.
    static func isValidKey(_ key: String) -> Bool {
        !key.isEmpty && key.count <= 128 && key.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil
    }

    static func directory(base: URL) -> URL {
        base.appendingPathComponent(dirName, isDirectory: true)
    }

    static func fileURL(base: URL, key: String) -> URL? {
        guard isValidKey(key) else { return nil }
        return directory(base: base).appendingPathComponent(key + ".json", isDirectory: false)
    }

    /// ATOMIC: Data.write(options: .atomic) writes a temp file and renames it into
    /// place. The directory is created on first use.
    @discardableResult
    static func write(base: URL, key: String, value: String) throws -> Info {
        guard let url = fileURL(base: base, key: key) else { throw StoreError.invalidKey }
        try FileManager.default.createDirectory(at: directory(base: base), withIntermediateDirectories: true)
        let data = Data(value.utf8)
        try data.write(to: url, options: .atomic)
        return stat(base: base, key: key) ?? Info(bytes: data.count, mtimeMs: Int(Date().timeIntervalSince1970 * 1000))
    }

    static func read(base: URL, key: String) -> (value: String, info: Info)? {
        guard let url = fileURL(base: base, key: key),
              let data = FileManager.default.contents(atPath: url.path),
              let s = String(data: data, encoding: .utf8) else { return nil }
        return (s, stat(base: base, key: key) ?? Info(bytes: data.count, mtimeMs: 0))
    }

    static func stat(base: URL, key: String) -> Info? {
        guard let url = fileURL(base: base, key: key),
              let attrs = try? FileManager.default.attributesOfItem(atPath: url.path) else { return nil }
        let bytes = (attrs[.size] as? NSNumber)?.intValue ?? 0
        let m = (attrs[.modificationDate] as? Date) ?? Date(timeIntervalSince1970: 0)
        return Info(bytes: bytes, mtimeMs: Int(m.timeIntervalSince1970 * 1000))
    }

    static func remove(base: URL, key: String) throws {
        guard let url = fileURL(base: base, key: key) else { throw StoreError.invalidKey }
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }

    /// The app's base: Application Support (backed up, never purged - unlike Caches).
    static var appBase: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
    }
}
