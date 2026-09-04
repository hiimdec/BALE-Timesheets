//
//  DurableStorePlugin.swift
//  App
//
//  The Capacitor face of DurableStore: write / read / stat / remove for the
//  record's atomic file. Every method routes through DurableStore; nothing
//  here decides anything. The JS storage adapter uses it for
//  bigals_productions only (its DURABLE_KEYS list) and mirrors to
//  Preferences afterwards, so an older bundle still reads a recent record.
//

import Foundation
import Capacitor

public class DurableStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DurableStorePlugin"
    public let jsName = "DurableStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
    ]

    @objc func write(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else {
            call.reject("DurableStore.write: key and value are required")
            return
        }
        do {
            let info = try DurableStore.write(base: DurableStore.appBase, key: key, value: value)
            call.resolve(["bytes": info.bytes, "mtimeMs": info.mtimeMs])
        } catch {
            call.reject("DurableStore.write failed: \(error.localizedDescription)")
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("DurableStore.read: key is required"); return }
        if let r = DurableStore.read(base: DurableStore.appBase, key: key) {
            call.resolve(["value": r.value, "bytes": r.info.bytes, "mtimeMs": r.info.mtimeMs])
        } else {
            call.resolve(["value": NSNull()])
        }
    }

    @objc func stat(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("DurableStore.stat: key is required"); return }
        if let s = DurableStore.stat(base: DurableStore.appBase, key: key) {
            call.resolve(["exists": true, "bytes": s.bytes, "mtimeMs": s.mtimeMs])
        } else {
            call.resolve(["exists": false])
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("DurableStore.remove: key is required"); return }
        do { try DurableStore.remove(base: DurableStore.appBase, key: key); call.resolve() }
        catch { call.reject("DurableStore.remove failed: \(error.localizedDescription)") }
    }
}
