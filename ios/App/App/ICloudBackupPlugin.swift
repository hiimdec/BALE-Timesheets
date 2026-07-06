//
//  ICloudBackupPlugin.swift
//
//  Private iCloud snapshot backup for the app's JSON data set. Files live at
//  the ubiquity container ROOT — deliberately NOT the Documents/ subfolder and
//  with no NSUbiquitousContainerIsDocumentScopePublic key, so nothing ever
//  appears in the Files app. No permission dialogs: a private container needs
//  none. Same app-embedded pattern as the other plugins (explicit
//  registerPluginInstance in MainViewController; Capacitor 8 under SPM does
//  not auto-scan for app-embedded plugins).
//
//  Silent-degradation contract: every failure path resolves/rejects quietly
//  and the JS layer swallows it — iCloud signed out, quota full, or airplane
//  mode must never surface as an error to the user (the manual export remains
//  the fallback). Writes land in the container's LOCAL directory even when
//  offline; the iCloud daemon uploads when it can.
//
//  App target only. The widget extension never links or touches this.
//

import Foundation
import Capacitor

@objc(ICloudBackupPlugin)
public class ICloudBackupPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ICloudBackupPlugin"
    public let jsName = "ICloudBackup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listSnapshots", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteSnapshot", returnType: CAPPluginReturnPromise)
    ]

    private static let containerId = "iCloud.uk.co.timemachineapp.app"
    // Snapshot names are date-stamped and nothing else — the JS side writes
    // snapshot-YYYY-MM-DD.json. The pattern doubles as path-traversal guard.
    private static let namePattern = "^snapshot-\\d{4}-\\d{2}-\\d{2}\\.json$"

    // url(forUbiquityContainerIdentifier:) can block on first call — never on
    // the main thread. One serial queue orders all container work.
    private let queue = DispatchQueue(label: "uk.co.timemachineapp.icloudbackup")

    private func containerRoot() -> URL? {
        FileManager.default.url(forUbiquityContainerIdentifier: Self.containerId)
    }

    private func validName(_ call: CAPPluginCall) -> String? {
        guard let name = call.getString("filename"),
              name.range(of: Self.namePattern, options: .regularExpression) != nil else {
            call.reject("invalid snapshot filename")
            return nil
        }
        return name
    }

    // MARK: - status

    // available = signed in AND the container resolves. reason is for the
    // Settings status line ("sign in to iCloud"), never an error surface.
    @objc func status(_ call: CAPPluginCall) {
        queue.async {
            if FileManager.default.ubiquityIdentityToken == nil {
                call.resolve(["available": false, "reason": "signed-out"])
                return
            }
            guard self.containerRoot() != nil else {
                call.resolve(["available": false, "reason": "no-container"])
                return
            }
            call.resolve(["available": true, "reason": ""])
        }
    }

    // MARK: - writeSnapshot

    // Coordinated atomic write to the container root. Works offline — the
    // daemon syncs the file up when connectivity/quota allow.
    @objc func writeSnapshot(_ call: CAPPluginCall) {
        guard let name = validName(call) else { return }
        guard let data = call.getString("data")?.data(using: .utf8) else {
            call.reject("missing data")
            return
        }
        queue.async {
            guard let root = self.containerRoot() else {
                call.reject("icloud-unavailable")
                return
            }
            let url = root.appendingPathComponent(name)
            var coordErr: NSError?
            var writeErr: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(
                writingItemAt: url, options: .forReplacing, error: &coordErr
            ) { dest in
                do {
                    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                    try data.write(to: dest, options: .atomic)
                } catch { writeErr = error }
            }
            if let err = coordErr ?? (writeErr as NSError?) {
                call.reject("write failed: \(err.localizedDescription)")
            } else {
                call.resolve(["ok": true])
            }
        }
    }

    // MARK: - listSnapshots

    // NSMetadataQuery over the ubiquitous DATA scope (everything except
    // Documents/ — exactly where we write). The query sees files that exist
    // in iCloud but haven't downloaded to this device yet — the fresh-install
    // discovery case a plain directory listing would miss. Bounded by a 5s
    // timeout, then merged with the local directory view so an offline device
    // still lists what it has.
    @objc func listSnapshots(_ call: CAPPluginCall) {
        queue.async {
            guard let root = self.containerRoot() else {
                call.resolve(["snapshots": [] as [[String: Any]]])
                return
            }
            var found: [String: [String: Any]] = [:]

            // Local view first (works offline, instant).
            let local = (try? FileManager.default.contentsOfDirectory(
                at: root, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]
            )) ?? []
            for url in local where url.lastPathComponent.range(of: Self.namePattern, options: .regularExpression) != nil {
                let vals = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                found[url.lastPathComponent] = [
                    "name": url.lastPathComponent,
                    "size": vals?.fileSize ?? 0,
                    "modifiedAt": Int((vals?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000),
                    "downloaded": true,
                ]
            }

            // Cloud metadata view (needs a run loop → main), 5s bound.
            DispatchQueue.main.async {
                let query = NSMetadataQuery()
                query.searchScopes = [NSMetadataQueryUbiquitousDataScope]
                query.predicate = NSPredicate(format: "%K LIKE 'snapshot-*.json'", NSMetadataItemFSNameKey)
                var finished = false
                var observer: NSObjectProtocol?

                let finish: () -> Void = {
                    guard !finished else { return }
                    finished = true
                    query.stop()
                    if let obs = observer { NotificationCenter.default.removeObserver(obs) }
                    let items = (query.results as? [NSMetadataItem]) ?? []
                    for item in items {
                        guard let name = item.value(forAttribute: NSMetadataItemFSNameKey) as? String,
                              name.range(of: Self.namePattern, options: .regularExpression) != nil else { continue }
                        let size = (item.value(forAttribute: NSMetadataItemFSSizeKey) as? NSNumber)?.intValue ?? 0
                        let date = (item.value(forAttribute: NSMetadataItemFSContentChangeDateKey) as? Date) ?? Date(timeIntervalSince1970: 0)
                        let status = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
                        let downloaded = status == NSMetadataUbiquitousItemDownloadingStatusCurrent
                        // Cloud metadata wins over the local stat for the same name.
                        found[name] = [
                            "name": name,
                            "size": size,
                            "modifiedAt": Int(date.timeIntervalSince1970 * 1000),
                            "downloaded": downloaded || (found[name]?["downloaded"] as? Bool ?? false),
                        ]
                    }
                    let snapshots = found.values.sorted {
                        (($0["name"] as? String) ?? "") > (($1["name"] as? String) ?? "")
                    }
                    call.resolve(["snapshots": snapshots])
                }

                observer = NotificationCenter.default.addObserver(
                    forName: .NSMetadataQueryDidFinishGathering, object: query, queue: .main
                ) { _ in finish() }
                DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) { finish() }
                query.start()
            }
        }
    }

    // MARK: - readSnapshot

    // Not-yet-downloaded snapshots (fresh install) are pulled with
    // startDownloadingUbiquitousItem and polled up to ~10s before the
    // coordinated read.
    @objc func readSnapshot(_ call: CAPPluginCall) {
        guard let name = validName(call) else { return }
        queue.async {
            guard let root = self.containerRoot() else {
                call.reject("icloud-unavailable")
                return
            }
            let url = root.appendingPathComponent(name)
            let fm = FileManager.default

            if !fm.fileExists(atPath: url.path) {
                try? fm.startDownloadingUbiquitousItem(at: url)
                let deadline = Date().addingTimeInterval(10.0)
                while !fm.fileExists(atPath: url.path) && Date() < deadline {
                    Thread.sleep(forTimeInterval: 0.3)
                }
            }
            guard fm.fileExists(atPath: url.path) else {
                call.reject("snapshot not available yet")
                return
            }

            var coordErr: NSError?
            var text: String?
            NSFileCoordinator(filePresenter: nil).coordinate(
                readingItemAt: url, options: [], error: &coordErr
            ) { src in
                text = try? String(contentsOf: src, encoding: .utf8)
            }
            if let text = text {
                call.resolve(["data": text])
            } else {
                call.reject("read failed: \(coordErr?.localizedDescription ?? "unreadable")")
            }
        }
    }

    // MARK: - deleteSnapshot

    @objc func deleteSnapshot(_ call: CAPPluginCall) {
        guard let name = validName(call) else { return }
        queue.async {
            guard let root = self.containerRoot() else {
                call.reject("icloud-unavailable")
                return
            }
            let url = root.appendingPathComponent(name)
            var coordErr: NSError?
            var deleteErr: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(
                writingItemAt: url, options: .forDeleting, error: &coordErr
            ) { target in
                do { try FileManager.default.removeItem(at: target) } catch { deleteErr = error }
            }
            if let err = coordErr ?? (deleteErr as NSError?) {
                call.reject("delete failed: \(err.localizedDescription)")
            } else {
                call.resolve(["ok": true])
            }
        }
    }
}
