//
//  CallSheetPlugin.swift
//
//  Stage 1 — AI call-sheet reader: prove the extraction pipeline.
//
//  In-app Capacitor 8 plugin (same template as NativePdfPlugin /
//  LiveActivityPlugin: @objc CAPPlugin / CAPBridgedPlugin, registered
//  explicitly in MainViewController). Three methods:
//
//    isAvailable()   → maps SystemLanguageModel availability to the four
//                      documented cases (+ osTooOld below iOS 26).
//    pickDocument()  → UIDocumentPickerViewController (PDF + images, asCopy),
//                      returns a tmp-dir path.
//    extract(path)   → the full ON-DEVICE pipeline:
//                        1. per-page text — PDFKit text layer; Vision OCR
//                           (VNRecognizeTextRequest, accurate) only for pages
//                           whose layer is empty, and for plain images;
//                        2. page selection — page 1 (masthead) + every page
//                           whose text contains "invoic" (case-insensitive);
//                           only if none match, sequential per-page fallback;
//                        3. guided generation per selected page — @Generable
//                           CallSheetFields (five OPTIONAL fields), short
//                           instructions with a hard no-guessing rule, GREEDY
//                           sampling; context overflow handled by catching
//                           exceededContextWindowSize and splitting on line
//                           boundaries (plus an upfront ~10k-char budget);
//                        4. merge — per field: for the three invoicing fields
//                           candidates from "invoic" pages outrank page-1,
//                           then verified beats unverified, then session
//                           order; title/prodCo: verified first, then order;
//                        5. verification — every value is matched back into
//                           its page text (exact → case/whitespace-normalised
//                           regex → ≥70% token-subset). invoicingAddress is
//                           verified ONLY if the matched span contains a UK
//                           postcode; invoicingEmail must look like an email
//                           (single @, no whitespace, dotted domain) no
//                           matter what matched. This match-back IS the
//                           confidence system — the FM API exposes none.
//                        6. crops — for verified fields a zoomed PNG of the
//                           matched region (PDF: characterBounds union,
//                           re-rendered at scale; OCR: line-rect union cut
//                           from the OCR bitmap), base64 across the bridge
//                           (same transport NativePdf already uses).
//
//  NOTHING here writes to storage — extraction results go back to JS for a
//  display-only dev screen. iOS-version safety: the App target minimum stays
//  15.0; FoundationModels / Vision usage lives behind #available(iOS 26.0, *)
//  (auto-weak-linked, the ActivityKit pattern). PDFKit is iOS 11+.
//

import Foundation
import Capacitor
import UIKit
import PDFKit
import Vision
import VisionKit
import PhotosUI
import UniformTypeIdentifiers
import FoundationModels

// MARK: - The schema (FINAL, five optional fields)

@available(iOS 26.0, *)
@Generable
struct CallSheetFields {
    @Guide(description: "Production or job title as printed on the call sheet")
    var title: String?
    @Guide(description: "The production company that invoices are addressed to. If more than one production company appears on the sheet, use the one named in the invoicing or 'address invoices to' section, not the header.")
    var prodCo: String?
    @Guide(description: "Job number, job reference or code that must be quoted on the invoice, e.g. 9627, SERV56, BFC#0032, BARKER03, NU684")
    var jobReference: String?
    @Guide(description: "The primary email address invoices are sent to, in name@domain.tld form. If several are listed, the main 'send to' / accounts address.")
    var invoicingEmail: String?
    @Guide(description: "A SECOND invoicing email in name@domain.tld form — ONLY when the sheet plainly addresses invoices to more than one person (e.g. a 'cc' recipient). Must differ from the primary, and must be an invoicing recipient, not a crew or agent address. Leave empty if only one invoicing recipient is listed.")
    var ccEmail: String?
    @Guide(description: "The UK postal address invoices are addressed to — street line(s) plus postcode, multi-line.")
    var invoicingAddress: String?
}

// MARK: - Plugin

@objc(CallSheetPlugin)
public class CallSheetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CallSheetPlugin"
    public let jsName = "CallSheet"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ingestSharedFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "extract", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPageRuns", returnType: CAPPluginReturnPromise)
    ]

    private var pendingPickCall: CAPPluginCall?
    private var pickerDelegate: CallSheetPickerDelegate?
    private var photoDelegate: CallSheetPhotoDelegate?
    private var scanDelegate: CallSheetScanDelegate?
    // Select-on-sheet page cache (path(s)+page → rendered image + runs) so
    // reopening a page doesn't re-render/re-OCR. Tiny and bounded.
    private var pageRunsCache: [String: [String: Any]] = [:]

    // MARK: isAvailable — the four documented cases (+ osTooOld) + scanner flag

    @objc func isAvailable(_ call: CAPPluginCall) {
        let scanner = VNDocumentCameraViewController.isSupported
        guard #available(iOS 26.0, *) else {
            call.resolve(["available": false, "reason": "osTooOld", "scanner": scanner])
            return
        }
        switch SystemLanguageModel.default.availability {
        case .available:
            call.resolve(["available": true, "reason": "", "scanner": scanner])
        case .unavailable(.deviceNotEligible):
            call.resolve(["available": false, "reason": "deviceNotEligible", "scanner": scanner])
        case .unavailable(.appleIntelligenceNotEnabled):
            call.resolve(["available": false, "reason": "appleIntelligenceNotEnabled", "scanner": scanner])
        case .unavailable(.modelNotReady):
            call.resolve(["available": false, "reason": "modelNotReady", "scanner": scanner])
        case .unavailable(_):
            call.resolve(["available": false, "reason": "unavailable", "scanner": scanner])
        }
    }

    // MARK: pickDocument — PDF + image, copied into tmp

    @objc func pickDocument(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.pdf, UTType.image], asCopy: true)
            let delegate = CallSheetPickerDelegate { [weak self] url in
                guard let self = self else { return }
                defer { self.pickerDelegate = nil; self.pendingPickCall = nil }
                guard let url = url else {
                    self.pendingPickCall?.reject("cancelled")
                    return
                }
                let ext = url.pathExtension.isEmpty ? "pdf" : url.pathExtension
                let dest = FileManager.default.temporaryDirectory
                    .appendingPathComponent("callsheet-\(UUID().uuidString).\(ext)")
                do {
                    try? FileManager.default.removeItem(at: dest)
                    try FileManager.default.copyItem(at: url, to: dest)
                } catch {
                    self.pendingPickCall?.reject("copy failed: \(error.localizedDescription)")
                    return
                }
                let isPdf = UTType(filenameExtension: ext)?.conforms(to: .pdf) ?? (ext.lowercased() == "pdf")
                self.pendingPickCall?.resolve(["path": dest.path, "kind": isPdf ? "pdf" : "image"])
            }
            self.pickerDelegate = delegate
            self.pendingPickCall = call
            picker.delegate = delegate
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    // MARK: pickPhotos — PHPicker, multi-select (≤5), each image = a page.
    // Out-of-process picker: no photo-library usage description required.

    @objc func pickPhotos(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var config = PHPickerConfiguration()
            config.selectionLimit = 5
            config.filter = .images
            let picker = PHPickerViewController(configuration: config)
            let delegate = CallSheetPhotoDelegate { [weak self] paths in
                guard let self = self else { return }
                defer { self.photoDelegate = nil; self.pendingPickCall = nil }
                guard let paths = paths, !paths.isEmpty else {
                    self.pendingPickCall?.reject("cancelled")
                    return
                }
                self.pendingPickCall?.resolve(["paths": paths, "kind": "image"])
            }
            self.photoDelegate = delegate
            self.pendingPickCall = call
            picker.delegate = delegate
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    // MARK: scanDocument — VisionKit document camera (auto-crop/deskew).
    // Needs NSCameraUsageDescription (Info.plist). Multi-page scans = pages.

    @objc func scanDocument(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("This device can't scan documents. Import from Files or Photos instead.")
            return
        }
        DispatchQueue.main.async {
            let scanner = VNDocumentCameraViewController()
            let delegate = CallSheetScanDelegate { [weak self] paths in
                guard let self = self else { return }
                defer { self.scanDelegate = nil; self.pendingPickCall = nil }
                guard let paths = paths, !paths.isEmpty else {
                    self.pendingPickCall?.reject("cancelled")
                    return
                }
                self.pendingPickCall?.resolve(["paths": paths, "kind": "image"])
            }
            self.scanDelegate = delegate
            self.pendingPickCall = call
            scanner.delegate = delegate
            self.bridge?.viewController?.present(scanner, animated: true)
        }
    }

    // MARK: ingestSharedFile — share-in route (CFBundleDocumentTypes →
    // appUrlOpen). Copies the incoming file into our tmp immediately, with
    // security-scoped access when the source URL demands it (harmless no-op
    // for sandbox-Inbox copies).

    @objc func ingestSharedFile(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString), url.isFileURL else {
            call.reject("file url required")
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let ext = url.pathExtension.isEmpty ? "pdf" : url.pathExtension
        let dest = FileManager.default.temporaryDirectory
            .appendingPathComponent("callsheet-\(UUID().uuidString).\(ext)")
        do {
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.copyItem(at: url, to: dest)
        } catch {
            call.reject("copy failed: \(error.localizedDescription)")
            return
        }
        // THE INBOX IS NOT AN ARCHIVE (founder-ruled 7 September 2026): iOS
        // copies every "Copy to TimeMachine" file into Documents/Inbox and
        // leaves deletion to the app - nothing ever did, so every shared sheet
        // was kept for ever. Our copy is in tmp now, so the Inbox original
        // goes, and older Inbox siblings go with it (a minute or more old -
        // never a file another share might be landing right now). ONLY under
        // the app's own Inbox: a picker or security-scoped URL is the user's
        // file and is never touched.
        if let inbox = inboxDirectory(), isInInbox(url, inbox: inbox) {
            try? FileManager.default.removeItem(at: url)
            sweepInbox(inbox, olderThan: 60)
        }
        let isPdf = UTType(filenameExtension: ext)?.conforms(to: .pdf) ?? (ext.lowercased() == "pdf")
        call.resolve(["path": dest.path, "kind": isPdf ? "pdf" : "image"])
    }

    private func inboxDirectory() -> URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("Inbox", isDirectory: true)
    }

    /// True only when `url` lies inside the app's own Documents/Inbox. Both
    /// sides are standardised and symlink-resolved: the system hands the Inbox
    /// file as /private/var/... while the documents URL reads /var/...
    private func isInInbox(_ url: URL, inbox: URL) -> Bool {
        let file = url.standardizedFileURL.resolvingSymlinksInPath().path
        let dir = inbox.standardizedFileURL.resolvingSymlinksInPath().path
        return file.hasPrefix(dir.hasSuffix("/") ? dir : dir + "/")
    }

    private func sweepInbox(_ inbox: URL, olderThan seconds: TimeInterval) {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: inbox, includingPropertiesForKeys: [.contentModificationDateKey], options: []) else { return }
        let cutoff = Date().addingTimeInterval(-seconds)
        for item in items {
            let mtime = (try? item.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if mtime < cutoff { try? fm.removeItem(at: item) }
        }
    }

    // MARK: getPageRuns — select-on-sheet support (Stage 3.5). READ-ONLY: a
    // full-page display image (tmp JPEG; JS loads it via convertFileSrc) plus
    // the page's text line runs with rects in that image's pixel space, so the
    // verify view can overlay tappable regions. No iOS 26 gate — Vision/PDFKit
    // only — and no behaviour change anywhere else.

    @objc func getPageRuns(_ call: CAPPluginCall) {
        // UNGATED (commit 3): the reason for the old gate was that the
        // pipeline namespace was availability-scoped. It no longer is, and
        // page runs are Vision + PDFKit, which the App target already has.
        var paths = (call.getArray("paths", String.self) ?? []).filter { !$0.isEmpty }
        if paths.isEmpty, let single = call.getString("path"), !single.isEmpty { paths = [single] }
        let page = call.getInt("page") ?? 1
        guard !paths.isEmpty else { call.reject("path required"); return }
        let key = paths.joined(separator: "|") + "#\(page)"
        if let cached = pageRunsCache[key] { call.resolve(cached); return }
        Task {
            do {
                let result = try CallSheetPipeline.pageRuns(paths: paths, page: page)
                if self.pageRunsCache.count > 6 { self.pageRunsCache.removeAll() }
                self.pageRunsCache[key] = result
                call.resolve(result)
            } catch {
                call.reject("pageRuns failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: extract — the pipeline (single path OR multiple image paths,
    // each image acting as a page of one document)

    // UNGATED (commit 3). Both guards are gone: the reader now runs its
    // pattern work on every device, and run() folds the model in only where
    // it exists. Rejecting here would refuse a sheet the patterns can read.
    @objc func extract(_ call: CAPPluginCall) {
        var paths = (call.getArray("paths", String.self) ?? []).filter { !$0.isEmpty }
        if paths.isEmpty, let single = call.getString("path"), !single.isEmpty { paths = [single] }
        guard !paths.isEmpty else {
            call.reject("path required")
            return
        }
        Task {
            do {
                let result = try await CallSheetPipeline.run(paths: paths)
                call.resolve(result)
            } catch {
                NSLog("[CallSheet] extract failed: %@", error.localizedDescription)
                call.reject("Couldn't read that call sheet. Try again, or use a clearer page.")
            }
        }
    }
}

// MARK: - Document picker delegate

private final class CallSheetPickerDelegate: NSObject, UIDocumentPickerDelegate {
    private let completion: (URL?) -> Void
    init(completion: @escaping (URL?) -> Void) { self.completion = completion }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        completion(urls.first)
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        completion(nil)
    }
}

// MARK: - Photo picker delegate (multi-select, order-preserving)

private final class CallSheetPhotoDelegate: NSObject, PHPickerViewControllerDelegate {
    private let completion: ([String]?) -> Void
    init(completion: @escaping ([String]?) -> Void) { self.completion = completion }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard !results.isEmpty else { completion(nil); return }
        // loadFileRepresentation hands us a TEMPORARY url — copy inside the
        // callback. Indexed slots keep the user's selection order.
        var slots: [String?] = Array(repeating: nil, count: results.count)
        let group = DispatchGroup()
        for (i, result) in results.enumerated() {
            group.enter()
            result.itemProvider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
                defer { group.leave() }
                guard let url = url else { return }
                let ext = url.pathExtension.isEmpty ? "jpg" : url.pathExtension
                let dest = FileManager.default.temporaryDirectory
                    .appendingPathComponent("callsheet-\(UUID().uuidString).\(ext)")
                try? FileManager.default.removeItem(at: dest)
                if (try? FileManager.default.copyItem(at: url, to: dest)) != nil {
                    slots[i] = dest.path
                }
            }
        }
        group.notify(queue: .main) {
            let paths = slots.compactMap { $0 }
            self.completion(paths.isEmpty ? nil : paths)
        }
    }
}

// MARK: - Document camera delegate (multi-page scan → page images)

private final class CallSheetScanDelegate: NSObject, VNDocumentCameraViewControllerDelegate {
    private let completion: ([String]?) -> Void
    init(completion: @escaping ([String]?) -> Void) { self.completion = completion }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        controller.dismiss(animated: true)
        var paths: [String] = []
        for i in 0..<scan.pageCount {
            let image = scan.imageOfPage(at: i)
            guard let data = image.jpegData(compressionQuality: 0.85) else { continue }
            let dest = FileManager.default.temporaryDirectory
                .appendingPathComponent("callsheet-\(UUID().uuidString).jpg")
            if (try? data.write(to: dest)) != nil { paths.append(dest.path) }
        }
        completion(paths.isEmpty ? nil : paths)
    }
    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        completion(nil)
    }
    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        completion(nil)
    }
}

// MARK: - Pipeline

// UNGATED FROM 2026.12 (pattern-primary commit 3). The pipeline itself needs
// nothing newer than the App target: PDFKit is iOS 11+, VNRecognizeTextRequest
// iOS 13+. The ONLY iOS 26 dependency is FoundationModels, so the annotation
// now sits on the four members that touch it - generate, mergeFirstNonNil,
// fieldValues, modelCandidates - rather than on the whole namespace.
//
// run() therefore executes the pattern work on EVERY device the app runs on,
// and folds the model in on top where it is available. That ordering is what
// preserves the byte-identity promise: on a 15 Pro with Apple Intelligence on,
// modelCandidates returns exactly what the old loop returned, and every
// downstream step is untouched, so a verified model value is still never
// displaced. On a 12, candidates is empty and the pattern harvests answer.
enum CallSheetPipeline {

    // ── Page model ──────────────────────────────────────────────────────────

    struct OcrLine {
        let text: String
        let range: NSRange      // range within the page's joined text
        let rectPx: CGRect      // pixel rect in the OCR bitmap (top-left origin)
    }

    enum MatchTarget {
        case pdfLayer(PDFPage)
        case ocr(lines: [OcrLine], image: UIImage)
    }

    struct SourcePage {
        let index: Int          // 0-based
        let text: String
        let target: MatchTarget
        // OCR quality metrics (nil for PDF text-layer pages). Drives the
        // non-blocking "hard to read" banner — thresholds chosen from a
        // degraded-input A/B (see Stage 3.5): mean Vision confidence < 0.5
        // or < 200 recognised chars ⇒ the page read badly.
        var ocrMeanConf: Double? = nil
        var ocrChars: Int? = nil
    }

    static func isWeak(_ p: SourcePage) -> Bool {
        guard let conf = p.ocrMeanConf, let chars = p.ocrChars else { return false }
        return conf < 0.5 || chars < 200
    }

    struct Candidate {
        let value: String
        let pageIndex: Int
        let order: Int          // session order
        let fromInvoicPage: Bool
        let verified: Bool
        let matchRange: NSRange?  // in page text, when matched
        // prodCo only (founder-ruled 7 September 2026): 0 = payee line, 1 = label
        // line, 2 = neither. Inside the gate a payee line outranks a label line.
        var contextRank: Int = 2
    }

    static let fieldKeys = ["title", "prodCo", "jobReference", "invoicingEmail", "ccEmail", "invoicingAddress"]
    static let invoicingKeys: Set<String> = ["jobReference", "invoicingEmail", "ccEmail", "invoicingAddress"]

    // ── Entry ───────────────────────────────────────────────────────────────

    static func run(paths: [String]) async throws -> [String: Any] {
        let urls = paths.map { URL(fileURLWithPath: $0) }
        let pages = try loadPages(urls: urls)
        guard !pages.isEmpty else { throw err("no readable pages") }

        // Page selection: page 1 + every "invoic" page; sequential fallback.
        let invoicSet = Set(pages.filter { $0.text.lowercased().contains("invoic") }.map { $0.index })
        var selected: [SourcePage]
        if invoicSet.isEmpty {
            selected = pages // sequential fallback, in order
        } else {
            selected = [pages[0]] + pages.filter { invoicSet.contains($0.index) && $0.index != 0 }
        }

        // THE MODEL, WHERE THERE IS ONE. Empty on a device without Apple
        // Intelligence, which is not a failure state - every step below is
        // written to cope with no candidates, and the pattern harvests then
        // supply the answers. Byte-identity: where the model IS available this
        // is the same loop, in the same order, producing the same candidates.
        var candidates: [String: [Candidate]] = [:]
        if #available(iOS 26.0, *), SystemLanguageModel.default.availability == .available {
            // THE BOUND (founder-ruled: 12 seconds and three pages). The plan
            // is pure and pinned; with invoicing pages present it is exactly
            // today's selection. The deadline is checked between pages.
            let plan = CallSheetHarvest.modelPagePlan(pageCharCounts: pages.map { $0.text.count }, invoicPages: invoicSet)
            let modelPages = plan.compactMap { idx in pages.first(where: { $0.index == idx }) }
            candidates = await modelCandidates(selected: modelPages, invoicSet: invoicSet, deadline: Date().addingTimeInterval(12))
        }

        // Merge per field, then build the bridge payload. Stage 2 verify-view
        // material per state: VERIFIED → highlighted crop (+ text snippet);
        // UNVERIFIED with a match range (e.g. address that failed the postcode
        // rule) → snippet only; UNVERIFIED with no match → a modest full-page
        // preview of the page the value came from. MISSING → nothing.
        var fields: [String: Any] = [:]
        var perField: [String: Any] = [:]
        for key in fieldKeys {
            let winner = pick(key: key, from: candidates[key] ?? [])
            guard let w = winner else {
                perField[key] = ["state": "missing"]
                continue
            }
            fields[key] = w.value
            var entry: [String: Any] = [
                "value": w.value,
                "state": w.verified ? "verified" : "unverified",
                "page": w.pageIndex + 1,
                "source": "model",
            ]
            let pg = pages.first(where: { $0.index == w.pageIndex })
            if let r = w.matchRange, let pg = pg {
                entry["snippet"] = snippet(of: pg.text, around: r)
                if w.verified, let crop = cropImage(for: r, on: pg) {
                    entry["crop"] = crop
                }
            } else if let pg = pg, let preview = pagePreview(of: pg) {
                entry["pagePreview"] = preview
            }
            perField[key] = entry
        }

        // EMAIL FIELDS — deterministic harvest FIRST, model only as fallback.
        // The harvest (regex every address + proximity scoring) is the primary
        // source: it provably exists in the text, so it's VERIFIED with a crop
        // from its known position. Only when nothing scores as an invoicing
        // email do we fall back to the model's email value (cleaned the same way).
        func setEmail(_ key: String, _ token: String, page: Int) {
            fields[key] = token
            var e = (perField[key] as? [String: Any]) ?? [:]
            e["value"] = token
            e["state"] = "verified"
            e["page"] = page
            e["source"] = "model-fallback"
            perField[key] = e
        }
        func setHarvested(_ key: String, _ hit: EmailHit) {
            fields[key] = hit.token
            var e: [String: Any] = ["value": hit.token, "state": "verified", "page": hit.pageIndex + 1, "source": "harvest-email"]
            if let page = pages.first(where: { $0.index == hit.pageIndex }) {
                e["snippet"] = snippet(of: page.text, around: hit.range)
                if let crop = cropImage(for: hit.range, on: page) { e["crop"] = crop }
            }
            perField[key] = e
        }
        let harvest = harvestInvoicingEmails(pages)
        if let primary = harvest.primary {
            setHarvested("invoicingEmail", primary)
            if let cc = harvest.cc {
                setHarvested("ccEmail", cc)
            } else {
                // No second invoicing email on the line/block — empty is honest;
                // never backfill CC with a low-scored crew/model address.
                fields["ccEmail"] = nil
                perField["ccEmail"] = ["state": "missing"]
            }
        } else {
            // FALLBACK — no scored invoicing email. Keep the model's value(s),
            // cleaned with token extraction (a model line may carry two addrs)
            // - but ONLY a token that exists in the text WITH invoicing context
            // (founder-ruled 4 September 2026: intent, not a valid address;
            // the same rule as the harvest). A model guess from a crew list is
            // nothing, not an invoicing email.
            let contextPT = pages.map { CallSheetHarvest.PageText(index: $0.index, text: $0.text) }
            let primaryRaw = (fields["invoicingEmail"] as? String) ?? ""
            let primaryTokens = extractEmails(primaryRaw).filter { CallSheetHarvest.emailHasInvoicingContext($0, pages: contextPT) }
            let primaryPage = ((perField["invoicingEmail"] as? [String: Any])?["page"] as? Int) ?? 1
            if primaryTokens.count >= 2, ((fields["ccEmail"] as? String) ?? "").isEmpty {
                setEmail("ccEmail", primaryTokens[1], page: primaryPage)
            }
            if let first = primaryTokens.first {
                setEmail("invoicingEmail", first, page: primaryPage)
            } else if fields["invoicingEmail"] != nil {
                fields["invoicingEmail"] = nil                          // no invoicing context → nothing, honestly
                perField["invoicingEmail"] = ["state": "missing"]
            }
            let ccRaw = (fields["ccEmail"] as? String) ?? ""
            let ccTokens = extractEmails(ccRaw).filter { CallSheetHarvest.emailHasInvoicingContext($0, pages: contextPT) }
            let ccPage = ((perField["ccEmail"] as? [String: Any])?["page"] as? Int) ?? primaryPage
            if let firstCc = ccTokens.first {
                setEmail("ccEmail", firstCc, page: ccPage)
            } else if fields["ccEmail"] != nil {
                fields["ccEmail"] = nil
                perField["ccEmail"] = ["state": "missing"]
            }
        }

        // HARD RULE — CC must never duplicate the primary invoicing email.
        if let cc = (fields["ccEmail"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           let primary = (fields["invoicingEmail"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           cc == primary {
            fields["ccEmail"] = nil
            perField["ccEmail"] = ["state": "missing"]
        }

        // TITLE — deterministic label harvest FIRST, then masthead / model
        // fallback, ALWAYS rejecting call-sheet boilerplate so a header line
        // ("CALL SHEET DAY 6 OF 7 …") never lands as the title.
        func setHarvestedTitle(_ t: (value: String, pageIndex: Int, range: NSRange), source: String) {
            fields["title"] = t.value
            var e: [String: Any] = ["value": t.value, "state": "verified", "page": t.pageIndex + 1, "source": source]
            if let page = pages.first(where: { $0.index == t.pageIndex }) {
                e["snippet"] = snippet(of: page.text, around: t.range)
                if let crop = cropImage(for: t.range, on: page) { e["crop"] = crop }
            }
            perField["title"] = e
        }
        if let labelled = harvestTitle(pages) {
            setHarvestedTitle(labelled, source: "harvest-label")          // brand/production label wins
        } else {
            let modelTitle = (fields["title"] as? String) ?? ""
            if modelTitle.isEmpty || isTitleBoilerplate(modelTitle) {
                if let masthead = mastheadTitle(pages) {
                    setHarvestedTitle(masthead, source: "harvest-masthead") // label-less masthead (music videos)
                } else {
                    fields["title"] = nil                               // boilerplate-only → honest empty
                    perField["title"] = ["state": "missing"]
                }
            }
            // else: a non-boilerplate model title (e.g. a masthead the model read) stays as
            // the SOURCE - it is still cleaned below (founder-ruled: cleaning is not sourcing)
        }

        // ── PATTERN HARVESTS (pattern-primary commit 2, founder-ruled) ──
        // prodCo / jobReference / invoicingAddress gain the measured pattern
        // harvests as a SECOND candidate source, ranked by the pure
        // CallSheetHarvest.resolveField: a model value this pipeline VERIFIED
        // is NEVER displaced (byte-identity for eligible devices — same
        // value, same crop, same page; pinned executable and mutation-
        // proven), a pattern hit fills only where today's answer is
        // unverified or missing, and it arrives verified by construction
        // (in-text by definition, shape-gated by the harvest hygiene) with
        // its crop/snippet through the SAME machinery. The email and title
        // paths above are untouched — they were pattern-primary already.
        let harvestPages = pages.map { CallSheetHarvest.PageText(index: $0.index, text: $0.text) }
        func applyPatternHit(_ key: String, _ hit: CallSheetHarvest.Hit?) {
            guard let hit = hit else { return }
            let modelState = (perField[key] as? [String: Any])?["state"] as? String
            guard CallSheetHarvest.resolveField(modelState: modelState, hasPatternHit: true) == .pattern else { return }
            fields[key] = hit.value
            var e: [String: Any] = ["value": hit.value, "state": "verified", "page": hit.pageIndex + 1, "source": "pattern:" + hit.how]
            if let page = pages.first(where: { $0.index == hit.pageIndex }) {
                e["snippet"] = snippet(of: page.text, around: hit.range)
                if let crop = cropImage(for: hit.range, on: page) { e["crop"] = crop }
            }
            perField[key] = e
        }
        applyPatternHit("prodCo", CallSheetHarvest.harvestProdCo(pages: harvestPages))
        applyPatternHit("jobReference", CallSheetHarvest.harvestJobRef(pages: harvestPages))
        if let addr = CallSheetHarvest.harvestAddress(pages: harvestPages) {
            applyPatternHit("invoicingAddress", CallSheetHarvest.Hit(value: addr.value, pageIndex: addr.pageIndex, range: addr.range, how: "address-block"))
        }

        // ── THE OCR FALLBACK (founder-ruled 2026-09-02) ──────────────────────
        // TRIGGER, precisely: the document has a text layer (so OCR never ran)
        // AND the harvests above left company or postcode MISSING. Five of the
        // twelve title/company misses in the founder's expectations were
        // sheets whose layer has nothing to find - the company is an IMAGE
        // (Forever Living, Comet, Everlast) or the layer is glyph-damaged
        // (InRehearsal). Vision reads the picture. VNRecognizeTextRequest is
        // iOS 13+, on-device, nothing leaves the phone - the same call
        // getPageRuns makes, which is why manual selection already worked.
        //
        // PAGES: page 1 plus every page whose LAYER mentions invoicing - the
        // pipeline's own selection - and only pages that were read from the
        // layer (an .ocr page already IS OCR text). Measured on the corpus:
        // 1-3 pages per triggering sheet, ~210 ms/page on a Mac at 1600px.
        //
        // FILL ONLY WHAT IS MISSING. Company and postcode, never emails (OCR
        // added two wrong addresses on the damaged sheet), never a replace -
        // stricter than resolveField, which would also displace an unverified
        // model value. A filled value is VERIFIED by construction (in the OCR
        // text) with its crop cut from the rendered page, the same as any
        // pattern hit.
        //
        // THE CEILING IS THE LEXICON, NOT THE OCR - the finding that matters.
        // On the corpus, Vision reads "THETWO" (Comet, nine lines from its
        // PRODUCTION COMPANY label), "TILL DAWN AGENCY" (Everlast, an agency,
        // founder-ruled never the payee) and "Production Company:" over "The
        // Visuals Team" (InRehearsal). Today's rules recover the third only
        // because the labelled-cell rule (relaxed: true, OCR text ONLY) trusts
        // the label without a company suffix. The others are read and refused.
        // Anyone chasing the image sheets further should read the OCR cache,
        // not swap the OCR engine.
        //
        // THE DAMAGE DETECTOR PROPOSED IN MAINTENANCE.md DOES NOT WORK: the
        // InRehearsal page-1 OCR/layer character ratio is 1.13, the same as a
        // clean sheet. This field-based trigger replaces it.
        let companyMissing = ((perField["prodCo"] as? [String: Any])?["state"] as? String ?? "missing") == "missing"
        let postcodeMissing = ((perField["invoicingAddress"] as? [String: Any])?["state"] as? String ?? "missing") == "missing"
        let anyLayer = pages.contains { if case .pdfLayer = $0.target { return true } else { return false } }
        if anyLayer, companyMissing || postcodeMissing {
            var ocrPages: [SourcePage] = []
            for page in pages where page.index == 0 || invoicSet.contains(page.index) {
                guard case .pdfLayer(let pdfPage) = page.target else { continue }
                let image = render(page: pdfPage, maxWidth: 1600)
                guard let r = try? ocr(image), !r.text.isEmpty else { continue }
                ocrPages.append(SourcePage(index: page.index, text: r.text, target: .ocr(lines: r.lines, image: image), ocrMeanConf: r.meanConf, ocrChars: r.chars))
            }
            if !ocrPages.isEmpty {
                let ocrPT = ocrPages.map { CallSheetHarvest.PageText(index: $0.index, text: $0.text) }
                func fillFromOCR(_ key: String, _ value: String, pageIndex: Int, range: NSRange) {
                    fields[key] = value
                    var e: [String: Any] = ["value": value, "state": "verified", "page": pageIndex + 1, "source": "ocr-fallback"]
                    if let page = ocrPages.first(where: { $0.index == pageIndex }) {
                        e["snippet"] = snippet(of: page.text, around: range)
                        if let crop = cropImage(for: range, on: page) { e["crop"] = crop }
                    }
                    perField[key] = e
                }
                if companyMissing, let hit = CallSheetHarvest.harvestProdCo(pages: ocrPT, relaxed: true) {
                    fillFromOCR("prodCo", hit.value, pageIndex: hit.pageIndex, range: hit.range)
                }
                if postcodeMissing, let addr = CallSheetHarvest.harvestAddress(pages: ocrPT) {
                    fillFromOCR("invoicingAddress", addr.value, pageIndex: addr.pageIndex, range: addr.range)
                }
            }
        }

        // ── CLEANING (founder-ruled 2026-09-01) — applied to WHATEVER WON,
        //    model or pattern. Sourcing above is untouched (a verified model
        //    value is still never displaced); this strips a leading label and
        //    edge day-numbering from the title and a leading ref label from
        //    the reference. On a 15 Pro the model's verbatim "GYMSHARK WINTER
        //    WOMENSWEAR - DAY 1" stood because it is not boilerplate and the
        //    stripper only ran on the pattern path. Pure and pinned. ──
        // THE COMPANY CLEANER (founder-ruled 8 September 2026): a leading label is
        // never part of the company, whatever won - the first live sheet outside
        // the corpus shipped "COMPANY NAME DADBOD LTD". Runs BEFORE the address
        // dedupe below, which compares the address against the settled company.
        if let c = fields["prodCo"] as? String {
            if let cleaned = CallSheetHarvest.cleanCompany(c) {
                if cleaned != c {
                    fields["prodCo"] = cleaned
                    var e = (perField["prodCo"] as? [String: Any]) ?? [:]
                    e["value"] = cleaned
                    perField["prodCo"] = e
                }
            } else {
                fields["prodCo"] = nil                                  // a label alone is not a company
                perField["prodCo"] = ["state": "missing"]
            }
        }
        // The payee name is the "Bill to" line already; drop it from the front of the address (ruled).
        if let addr = fields["invoicingAddress"] as? String {
            let deduped = CallSheetHarvest.addressWithoutCompany(addr, company: fields["prodCo"] as? String)
            if deduped != addr {
                fields["invoicingAddress"] = deduped
                var e = (perField["invoicingAddress"] as? [String: Any]) ?? [:]
                e["value"] = deduped
                perField["invoicingAddress"] = e
            }
        }
        if let t = fields["title"] as? String {
            if let cleaned = CallSheetTitle.cleanTitle(t) {
                if cleaned != t {
                    fields["title"] = cleaned
                    var e = (perField["title"] as? [String: Any]) ?? [:]
                    e["value"] = cleaned
                    perField["title"] = e
                }
            } else {
                fields["title"] = nil
                perField["title"] = ["state": "missing"]
            }
        }
        if let r = fields["jobReference"] as? String {
            let cleaned = CallSheetHarvest.cleanRef(r)
            if CallSheetHarvest.isDayNumberingRef(cleaned) {
                // Whole-value day numbering is not a reference (founder-ruled
                // 7 September 2026): a reject, never a strip, whatever won.
                fields["jobReference"] = nil
                perField["jobReference"] = ["state": "missing"]
            } else if cleaned != r {
                fields["jobReference"] = cleaned
                var e = (perField["jobReference"] as? [String: Any]) ?? [:]
                e["value"] = cleaned
                perField["jobReference"] = e
            }
        }

        // THE READER'S OWN LINES (founder-ruled 8 September 2026): one always-on
        // ring line per field naming the winning source and how it was found.
        // The value travels for the company and the reference only - never an
        // email, never an address. The first live sheet outside the corpus took
        // a round of reasoning to attribute; this settles the next in one export.
        for key in fieldKeys {
            let e = (perField[key] as? [String: Any]) ?? [:]
            let state = (e["state"] as? String) ?? "missing"
            let source = (e["source"] as? String) ?? "-"
            let page = (e["page"] as? Int).map(String.init) ?? "-"
            let value = (key == "prodCo" || key == "jobReference") ? " value=\((fields[key] as? String) ?? "-")" : ""
            TMLiveActivity.dbg("reader.field", "key=\(key) state=\(state) source=\(source) page=\(page)" + value, always: true)
        }

        return [
            "fields": fields,
            "perField": perField,
            "pages": [
                "count": pages.count,
                "selected": selected.map { $0.index + 1 },
                "invoicPages": invoicSet.sorted().map { $0 + 1 },
            ],
            // Image-sourced pages whose OCR read weakly (mean Vision confidence
            // < 0.5 or < 200 recognised chars) — drives the review sheet's
            // non-blocking "hard to read" banner. Always [] for text-layer PDFs.
            "quality": [
                "weakPages": pages.filter { isWeak($0) }.map { $0.index + 1 },
            ],
        ]
    }

    // ── 1. Page text (PDF layer, OCR fallback; images straight to OCR).
    //       Multiple paths (photo multi-select / multi-page scans) act as the
    //       pages of ONE document, in selection/scan order — so a masthead
    //       screenshot + an invoicing-page screenshot behave exactly like a
    //       two-page PDF through page selection and merge. ─────────────────────

    static func loadPages(urls: [URL]) throws -> [SourcePage] {
        if urls.count == 1, let pdf = PDFDocument(url: urls[0]) {
            var out: [SourcePage] = []
            for i in 0..<pdf.pageCount {
                guard let page = pdf.page(at: i) else { continue }
                let layer = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if layer.count > 40 {
                    out.append(SourcePage(index: i, text: page.string ?? "", target: .pdfLayer(page)))
                } else {
                    let image = render(page: page, maxWidth: 1600)
                    let r = (try? ocr(image)) ?? OcrResult(lines: [], text: "", meanConf: 0, chars: 0)
                    out.append(SourcePage(index: i, text: r.text, target: .ocr(lines: r.lines, image: image),
                                          ocrMeanConf: r.meanConf, ocrChars: r.chars))
                }
            }
            return out
        }
        var out: [SourcePage] = []
        for (i, url) in urls.enumerated() {
            guard let raw = UIImage(contentsOfFile: url.path) else { continue }
            let image = upscaleIfSmall(raw) // 2× bicubic for small screenshots — see upscaleIfSmall
            guard let r = try? ocr(image) else { continue }
            out.append(SourcePage(index: i, text: r.text, target: .ocr(lines: r.lines, image: image),
                                  ocrMeanConf: r.meanConf, ocrChars: r.chars))
        }
        if out.isEmpty { throw err("unreadable file") }
        return out
    }

    static func render(page: PDFPage, maxWidth: CGFloat) -> UIImage {
        let bounds = page.bounds(for: .mediaBox)
        let scale = min(maxWidth / max(bounds.width, 1), 3)
        let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        return page.thumbnail(of: size, for: .mediaBox)
    }

    struct OcrResult {
        let lines: [OcrLine]
        let text: String
        let meanConf: Double
        let chars: Int
    }

    /// 2× bicubic upscale for small image inputs before OCR. Measured on
    /// degraded synthetic call-sheet pages (hard downscale + JPEG):
    /// 616px-wide input went 45%→97% char accuracy, 504px went 0%→78%,
    /// 784px 90%→99%, with NO regression on clean/large inputs — so this is
    /// kept, gated to images narrower than 1200px (where the win shows).
    /// PDF page renders are already 1600px wide and skip this naturally.
    static func upscaleIfSmall(_ image: UIImage) -> UIImage {
        guard let cg = image.cgImage, cg.width > 0, cg.width < 1200 else { return image }
        let size = CGSize(width: cg.width * 2, height: cg.height * 2)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            ctx.cgContext.interpolationQuality = .high
            UIImage(cgImage: cg).draw(in: CGRect(origin: .zero, size: size))
        }
    }

    static func ocr(_ image: UIImage) throws -> OcrResult {
        guard let cg = image.cgImage else { throw err("no bitmap") }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        try handler.perform([request])
        let observations = request.results ?? []
        // Reading order: top-to-bottom (Vision boxes are normalised, origin
        // bottom-left), then left-to-right within a ~1.2%-height band.
        let sorted = observations.sorted { a, b in
            if abs(a.boundingBox.midY - b.boundingBox.midY) > 0.012 { return a.boundingBox.midY > b.boundingBox.midY }
            return a.boundingBox.minX < b.boundingBox.minX
        }
        let W = CGFloat(cg.width), H = CGFloat(cg.height)
        var text = ""
        var lines: [OcrLine] = []
        var confSum = 0.0
        for obs in sorted {
            guard let cand = obs.topCandidates(1).first else { continue }
            let start = (text as NSString).length
            text += cand.string + "\n"
            confSum += Double(cand.confidence)
            let bb = obs.boundingBox
            let rect = CGRect(x: bb.minX * W, y: (1 - bb.maxY) * H, width: bb.width * W, height: bb.height * H)
            lines.append(OcrLine(text: cand.string,
                                 range: NSRange(location: start, length: (cand.string as NSString).length),
                                 rectPx: rect))
        }
        let meanConf = lines.isEmpty ? 0 : confSum / Double(lines.count)
        return OcrResult(lines: lines, text: text, meanConf: meanConf,
                         chars: text.filter { !$0.isWhitespace }.count)
    }

    // ── 2/3. Guided generation (greedy, no-guess rule, chunk-safe) ─────────

    // Guided generation per selected page (chunk-safe), collect candidates.
    // Lifted verbatim out of run() so the namespace could be ungated - the
    // body is unchanged, which is what keeps the commit-2 byte-identity pins
    // meaningful after the move.
    @available(iOS 26.0, *)
    static func modelCandidates(selected: [SourcePage], invoicSet: Set<Int>, deadline: Date) async -> [String: [Candidate]] {
        var order = 0
        var candidates: [String: [Candidate]] = [:]
        for page in selected {
            // Wall-clock bound, checked between pages (a generation in flight
            // is never cut). Past it, the remaining pages go to the patterns
            // only - which for a sheet with no invoicing content is where the
            // answers were coming from anyway.
            if Date() > deadline { break }
            let fromInvoic = invoicSet.contains(page.index)
            for chunk in chunks(of: page.text, budget: 10_000) {
                guard let fields = await generate(on: chunk) else { continue }
                order += 1
                for (key, value) in fieldValues(fields) {
                    guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { continue }
                    let match = matchBack(value: raw, in: page.text)
                    let verified = verify(key: key, value: raw, match: match, pageText: page.text)
                    // A model reference without label context does not count
                    // at all (founder-ruled 7 September 2026) - absent, not
                    // "unverified" - so a pattern hit fills, and no hit is
                    // honestly missing rather than a guess with a page preview.
                    let rank = CallSheetHarvest.companyContextRank(key: key, match: match, text: page.text)
                    if key == "jobReference", !verified { continue }
                    if key == "prodCo", !verified { continue }   // the company gate: absent, not "unverified"
                    candidates[key, default: []].append(Candidate(
                        value: raw, pageIndex: page.index, order: order,
                        fromInvoicPage: fromInvoic, verified: verified, matchRange: match, contextRank: rank
                    ))
                }
            }
        }
        return candidates
    }

    @available(iOS 26.0, *)
    static func generate(on text: String) async -> CallSheetFields? {
        let instructions = """
        You extract invoicing fields from a film/TV call sheet. Only return values \
        that appear in the supplied text. If a field is not present, return nil. \
        Never guess or invent.
        """
        do {
            let session = LanguageModelSession(instructions: instructions)
            let response = try await session.respond(
                to: "Call sheet text:\n\(text)",
                generating: CallSheetFields.self,
                options: GenerationOptions(sampling: .greedy)
            )
            return response.content
        } catch let e as LanguageModelSession.GenerationError {
            if case .exceededContextWindowSize = e {
                // Halve on a line boundary and merge the halves (first non-nil).
                let parts = chunks(of: text, budget: max(text.count / 2, 1_000))
                guard parts.count > 1 else { return nil }
                var merged: CallSheetFields?
                for part in parts {
                    guard let f = await generate(on: part) else { continue }
                    merged = mergeFirstNonNil(merged, f)
                }
                return merged
            }
            return nil // guardrail / other generation errors → this session yields nothing
        } catch {
            return nil
        }
    }

    /// Upfront budget split on line boundaries (~10k chars ≈ well inside the
    /// 4,096-token window with instructions + output reserve). The 26.4-only
    /// contextSize / tokenCount(for:) runtime APIs are deliberately not used —
    /// overflow is also caught at runtime via exceededContextWindowSize above.
    static func chunks(of text: String, budget: Int) -> [String] {
        guard text.count > budget else { return [text] }
        var out: [String] = []
        var current = ""
        for line in text.components(separatedBy: "\n") {
            if current.count + line.count + 1 > budget, !current.isEmpty {
                out.append(current)
                current = ""
            }
            current += (current.isEmpty ? "" : "\n") + line
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    @available(iOS 26.0, *)
    static func mergeFirstNonNil(_ a: CallSheetFields?, _ b: CallSheetFields) -> CallSheetFields {
        guard var m = a else { return b }
        m.title = m.title ?? b.title
        m.prodCo = m.prodCo ?? b.prodCo
        m.jobReference = m.jobReference ?? b.jobReference
        m.invoicingEmail = m.invoicingEmail ?? b.invoicingEmail
        m.ccEmail = m.ccEmail ?? b.ccEmail
        m.invoicingAddress = m.invoicingAddress ?? b.invoicingAddress
        return m
    }

    @available(iOS 26.0, *)
    static func fieldValues(_ f: CallSheetFields) -> [(String, String?)] {
        [("title", f.title), ("prodCo", f.prodCo), ("jobReference", f.jobReference),
         ("invoicingEmail", f.invoicingEmail), ("ccEmail", f.ccEmail), ("invoicingAddress", f.invoicingAddress)]
    }

    // ── 4. Merge rules ──────────────────────────────────────────────────────

    /// Invoicing fields: "invoic"-page candidates outrank page-1 ones, then
    /// verified beats unverified, then session order. title/prodCo: verified
    /// first, then session order (page 1 runs first, so the masthead wins ties).
    static func pick(key: String, from cands: [Candidate]) -> Candidate? {
        guard !cands.isEmpty else { return nil }
        let sorted = cands.sorted { a, b in
            if invoicingKeys.contains(key), a.fromInvoicPage != b.fromInvoicPage { return a.fromInvoicPage }
            if a.verified != b.verified { return a.verified }
            if key == "prodCo", a.contextRank != b.contextRank { return a.contextRank < b.contextRank }
            return a.order < b.order
        }
        return sorted.first
    }

    // ── 5. Match-back + field-specific verification ─────────────────────────

    static func matchBack(value: String, in text: String) -> NSRange? {
        let ns = text as NSString
        // (a) exact, then case-insensitive
        var r = ns.range(of: value)
        if r.location == NSNotFound { r = ns.range(of: value, options: .caseInsensitive) }
        if r.location != NSNotFound { return r }
        // (b) whitespace-normalised: any whitespace run in the value matches any in the text
        let tokens = value.split(whereSeparator: { $0.isWhitespace }).map { NSRegularExpression.escapedPattern(for: String($0)) }
        if !tokens.isEmpty, let re = try? NSRegularExpression(pattern: tokens.joined(separator: "\\s+"), options: [.caseInsensitive]) {
            if let m = re.firstMatch(in: text, options: [], range: NSRange(location: 0, length: ns.length)) {
                return m.range
            }
        }
        // (c) token-subset: ≥70% of the value's significant tokens found → span them
        let sig = significantTokens(value)
        guard sig.count >= 2 else { return nil }
        var found: [NSRange] = []
        for t in sig {
            let tr = ns.range(of: t, options: .caseInsensitive)
            if tr.location != NSNotFound { found.append(tr) }
        }
        guard found.count * 10 >= sig.count * 7 else { return nil }
        let lo = found.map { $0.location }.min()!
        let hi = found.map { $0.location + $0.length }.max()!
        return NSRange(location: lo, length: hi - lo)
    }

    static func significantTokens(_ value: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        for ch in value {
            if ch.isLetter || ch.isNumber { current.append(ch) }
            else { if current.count >= 3 { tokens.append(current) }; current = "" }
        }
        if current.count >= 3 { tokens.append(current) }
        var seen = Set<String>()
        return tokens.filter { seen.insert($0.lowercased()).inserted }
    }

    /// Field rules on top of the raw match:
    /// - invoicingEmail must LOOK like an email (single @, no whitespace,
    ///   dotted domain) regardless of match result — implausible ⇒ unverified.
    /// - invoicingAddress is verified ONLY if the matched span contains a UK
    ///   postcode (out-of-order address lines must surface as unverified).
    /// - jobReference is verified ONLY where a reference belongs: the matched
    ///   span's line carries a ref label, or the span sits inside an anchored
    ///   invoicing block (founder-ruled 7 September 2026; the Gymshark "DAY 1").
    /// - prodCo is verified ONLY where a company belongs: the matched span's
    ///   line carries a payee phrase or a production-company label, and the
    ///   value passes the harvest's shape hygiene (founder-ruled 7 September
    ///   2026; measured 14 of 20 wrong unguarded on the Mac's model).
    static func verify(key: String, value: String, match: NSRange?, pageText: String) -> Bool {
        switch key {
        case "invoicingEmail", "ccEmail":
            guard isPlausibleEmail(value) else { return false }
            return match != nil
        case "invoicingAddress":
            guard let r = match else { return false }
            let span = (pageText as NSString).substring(with: r)
            return containsUKPostcode(span) || containsUKPostcode(value)
        case "jobReference":
            // THE REFERENCE GATE (founder-ruled 7 September 2026): a matched
            // span is presence, not meaning - the Gymshark masthead's "DAY 1"
            // matched back and shipped as the reference. The span must sit on
            // a line with a ref label or inside an anchored invoicing block.
            guard let r = match else { return false }
            return CallSheetHarvest.refHasLabelContext(at: r, in: pageText)
        case "prodCo":
            // THE COMPANY GATE (founder-ruled 7 September 2026): the page-1
            // brand verified by presence on 14 of 20 corpus sheets. The span
            // must sit on a payee or production-company label line and the
            // value must pass the harvest's shape hygiene; the pure rule is
            // CallSheetHarvest.modelCompanyCounts.
            guard let r = match else { return false }
            return CallSheetHarvest.modelCompanyCounts(value, at: r, in: pageText)
        default:
            return match != nil
        }
    }

    static func isPlausibleEmail(_ s: String) -> Bool {
        CallSheetHarvest.isPlausibleEmail(s)
    }

    /// Pull every valid email TOKEN out of a string, in order, case-insensitively
    /// de-duplicated. An invoicing email is often printed on a shared line — e.g.
    /// "EMAIL INVOICES TO: a@x.com & b@y.com" — so the right operation is to
    /// EXTRACT the address(es) from the value, not validate the whole line as one.
    static func extractEmails(_ s: String) -> [String] {
        CallSheetHarvest.extractEmails(s)
    }

    // ── Invoicing-email harvest + proximity scoring (deterministic, no model) ──
    // Email fields are unreliable when the 3B model leads, so we regex EVERY
    // address across all page text and score each by PROXIMITY to invoicing
    // intent rather than model opinion. Only an email with explicit invoicing
    // intent near it is a candidate — so a crew/agent address is never promoted.

    // RELOCATED VERBATIM to CallSheetHarvest.swift (2026-08-31, pattern-
    // primary commit 1 - pure Foundation, executable by the harvest
    // harness). These are thin forwarders/adapters: same names, same
    // signatures, byte-equivalent behaviour on every input. The scoring
    // body (crew-safe positive gate included) lives in
    // CallSheetHarvest.harvestInvoicingEmailsCore.
    typealias EmailHit = CallSheetHarvest.EmailHit

    static let invoiceIntentKeywords = CallSheetHarvest.invoiceIntentKeywords
    static let crewContextKeywords = CallSheetHarvest.crewContextKeywords

    static func harvestInvoicingEmails(_ pages: [SourcePage]) -> (primary: EmailHit?, cc: EmailHit?) {
        CallSheetHarvest.harvestInvoicingEmailsCore(pages: pages.map { CallSheetHarvest.PageText(index: $0.index, text: $0.text) })
    }

    // ── Title harvest (deterministic, no model) ──────────────────────────────
    // The 3B model often grabs the page header ("CALL SHEET DAY 6 OF 7 …")
    // instead of the production title. So: prefer a value next to a title LABEL
    // (production/brand labels rank above campaign/project — the PRODUCTION name
    // is how the user recognises the job), reject call-sheet boilerplate, and
    // keep the model / masthead top line only as fallback.

    // titleLabels / titleTrimSet / isTitleBoilerplate RELOCATED VERBATIM to
    // CallSheetTitleLogic.swift (pure Foundation, the TimeMachineTimesParser
    // precedent) so the audit suite's swiftc harness can execute them - the
    // 2026-08-31 masthead fix shipped with a pin family, and pins need the
    // logic reachable off-device. Behaviour unchanged; these forwarders keep
    // every call site reading as before.
    static let titleLabels = CallSheetTitle.titleLabels
    static let titleTrimSet = CallSheetTitle.titleTrimSet

    static func isTitleBoilerplate(_ s: String) -> Bool {
        CallSheetTitle.isTitleBoilerplate(s)
    }

    static func leadingWhitespace(_ s: String) -> Int { s.prefix(while: { $0 == " " || $0 == "\t" }).count }

    /// Value next to the highest-priority title label present (same line, else
    /// the following non-empty line), rejecting boilerplate.
    static func harvestTitle(_ pages: [SourcePage]) -> (value: String, pageIndex: Int, range: NSRange)? {
        for label in titleLabels {
            for page in pages {
                let ns = page.text as NSString
                var idx = 0
                while idx < ns.length {
                    let lr = ns.lineRange(for: NSRange(location: idx, length: 0))
                    idx = lr.location + lr.length
                    let lineNS = ns.substring(with: lr) as NSString
                    let lbl = lineNS.range(of: label, options: .caseInsensitive)
                    if lbl.location == NSNotFound { continue }
                    let after = lbl.location + lbl.length
                    var value = lineNS.substring(from: after).trimmingCharacters(in: titleTrimSet)
                    var valRange = NSRange(location: lr.location + after, length: (value as NSString).length)
                    if value.isEmpty, idx < ns.length {
                        // label alone → take the next non-empty line as the value
                        let nlr = ns.lineRange(for: NSRange(location: idx, length: 0))
                        let nRaw = ns.substring(with: nlr)
                        value = nRaw.trimmingCharacters(in: .whitespacesAndNewlines)
                        valRange = NSRange(location: nlr.location + leadingWhitespace(nRaw), length: (value as NSString).length)
                    } else if !value.isEmpty {
                        let afterNS = lineNS.substring(from: after) as NSString
                        let vr = afterNS.range(of: value)
                        if vr.location != NSNotFound { valRange = NSRange(location: lr.location + after + vr.location, length: vr.length) }
                    }
                    // GUARD C: a list of quoted strings is not a title - skip it
                    // and let the next label win (M&S: PRODUCTION: MARKS & SPENCER).
                    if !value.isEmpty, !isTitleBoilerplate(value), !CallSheetTitle.isQuotedList(value) {
                        return (value, page.index, valRange)
                    }
                }
            }
        }
        return nil
    }

    /// Masthead fallback — the 2026-08-31 fix (founder-approved, measured on
    /// 20 real sheets): the old rule REJECTED any line containing boilerplate,
    /// discarding mastheads whose title lives INSIDE the line ("CALL SHEET |
    /// UMBERTO GIANNINI - KNOW YOUR CURLS") and letting one-word "CALLSHEET"
    /// through whole as a title. CallSheetTitle.mastheadCandidate now STRIPS
    /// the boilerplate and keeps the remainder (pure logic, pinned by the
    /// audit harness). The returned range targets the surviving text within
    /// its line when it is contiguous there, else the whole line (crop is a
    /// display aid; the value is what matters).
    static func mastheadTitle(_ pages: [SourcePage]) -> (value: String, pageIndex: Int, range: NSRange)? {
        guard let page = pages.first else { return nil }
        let ns = page.text as NSString
        var lines: [String] = []
        var lineRanges: [NSRange] = []
        var idx = 0
        while idx < ns.length {
            let lr = ns.lineRange(for: NSRange(location: idx, length: 0))
            idx = lr.location + lr.length
            lines.append(ns.substring(with: lr))
            lineRanges.append(lr)
        }
        guard let cand = CallSheetTitle.mastheadCandidate(lines: lines) else { return nil }
        let lineRaw = lines[cand.lineIndex]
        let lr = lineRanges[cand.lineIndex]
        let lineNS = lineRaw as NSString
        let vr = lineNS.range(of: cand.value, options: .caseInsensitive)
        let range = vr.location != NSNotFound
            ? NSRange(location: lr.location + vr.location, length: vr.length)
            : NSRange(location: lr.location + leadingWhitespace(lineRaw),
                      length: (lineRaw.trimmingCharacters(in: .whitespacesAndNewlines) as NSString).length)
        return (cand.value, page.index, range)
    }

    static func containsUKPostcode(_ s: String) -> Bool {
        CallSheetHarvest.containsUKPostcode(s)
    }

    // ── 6. Crops (verified fields — matched value visibly highlighted),
    //       snippets and page previews (verify-view material) ────────────────

    /// Highlight stroke colour — tm sky (#0EA5E9), matching the app accent.
    static var highlightColor: UIColor { UIColor(red: 0x0E/255, green: 0xA5/255, blue: 0xE9/255, alpha: 0.9) }

    static func cropImage(for range: NSRange, on page: SourcePage) -> String? {
        switch page.target {
        case .pdfLayer(let pdfPage):
            return pdfCrop(pdfPage: pdfPage, range: range)
        case .ocr(let lines, let image):
            let hit = lines.filter { NSIntersectionRange($0.range, range).length > 0 }
            guard !hit.isEmpty else { return nil }
            var union = hit[0].rectPx
            for l in hit.dropFirst() { union = union.union(l.rectPx) }
            return bitmapCrop(image: image, rectPx: union, highlightPx: union)
        }
    }

    static func pdfCrop(pdfPage: PDFPage, range: NSRange) -> String? {
        // Union of per-character bounds (page space, origin bottom-left).
        var rect = CGRect.null
        let upper = min(range.length, 600)
        for i in 0..<upper {
            let b = pdfPage.characterBounds(at: range.location + i)
            if !b.isEmpty { rect = rect.union(b) }
        }
        guard !rect.isNull, rect.width > 1, rect.height > 1 else { return nil }
        let pageBounds = pdfPage.bounds(for: .mediaBox)
        let padded = pad(rect, by: 0.15, min: 16).intersection(pageBounds)
        guard !padded.isEmpty else { return nil }
        let scale = min(3, 800 / max(padded.width, padded.height))
        let outSize = CGSize(width: padded.width * scale, height: padded.height * scale)
        let renderer = UIGraphicsImageRenderer(size: outSize)
        let img = renderer.image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: outSize))
            let c = ctx.cgContext
            c.translateBy(x: 0, y: outSize.height)
            c.scaleBy(x: scale, y: -scale)
            c.translateBy(x: -padded.minX, y: -padded.minY)
            pdfPage.draw(with: .mediaBox, to: c)
            // Highlight the matched value inside the crop.
            c.setStrokeColor(highlightColor.cgColor)
            c.setLineWidth(2 / scale)
            c.stroke(rect.insetBy(dx: -3, dy: -3))
        }
        return img.pngData()?.base64EncodedString()
    }

    static func bitmapCrop(image: UIImage, rectPx: CGRect, highlightPx: CGRect?) -> String? {
        guard let cg = image.cgImage else { return nil }
        let bounds = CGRect(x: 0, y: 0, width: cg.width, height: cg.height)
        let padded = pad(rectPx, by: 0.15, min: 24).intersection(bounds)
        guard !padded.isEmpty, let cut = cg.cropping(to: padded) else { return nil }
        let cutImage = UIImage(cgImage: cut)
        let maxDim = max(cutImage.size.width, cutImage.size.height)
        let s = maxDim > 800 ? 800 / maxDim : 1
        let size = CGSize(width: cutImage.size.width * s, height: cutImage.size.height * s)
        let out = UIGraphicsImageRenderer(size: size).image { ctx in
            cutImage.draw(in: CGRect(origin: .zero, size: size))
            if let h = highlightPx {
                // Convert from full-bitmap space → crop space → output scale.
                let local = CGRect(x: (h.minX - padded.minX) * s, y: (h.minY - padded.minY) * s,
                                   width: h.width * s, height: h.height * s).insetBy(dx: -3, dy: -3)
                let c = ctx.cgContext
                c.setStrokeColor(highlightColor.cgColor)
                c.setLineWidth(2)
                c.stroke(local)
            }
        }
        return out.pngData()?.base64EncodedString()
    }

    /// ±120 chars of page text around a match, whitespace-collapsed — the
    /// verify-view context for fields with a match but no (or failed) crop.
    static func snippet(of text: String, around range: NSRange) -> String {
        let ns = text as NSString
        let lo = max(0, range.location - 120)
        let hi = min(ns.length, range.location + range.length + 120)
        let raw = ns.substring(with: NSRange(location: lo, length: hi - lo))
        let collapsed = raw.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (lo > 0 ? "…" : "") + collapsed + (hi < ns.length ? "…" : "")
    }

    /// Modest full-page preview (~500px wide JPEG) for unverified fields with
    /// no match location — enough to eyeball the page without a big payload.
    static func pagePreview(of page: SourcePage) -> String? {
        let image: UIImage
        switch page.target {
        case .pdfLayer(let pdfPage):
            image = render(page: pdfPage, maxWidth: 500)
        case .ocr(_, let bitmap):
            let maxDim = max(bitmap.size.width, 1)
            let s = min(500 / maxDim, 1)
            let size = CGSize(width: bitmap.size.width * s, height: bitmap.size.height * s)
            image = UIGraphicsImageRenderer(size: size).image { _ in
                bitmap.draw(in: CGRect(origin: .zero, size: size))
            }
        }
        return image.jpegData(compressionQuality: 0.7)?.base64EncodedString()
    }

    static func pad(_ r: CGRect, by fraction: CGFloat, min minPad: CGFloat) -> CGRect {
        let dx = Swift.max(r.width * fraction, minPad)
        let dy = Swift.max(r.height * fraction, minPad)
        return r.insetBy(dx: -dx, dy: -dy)
    }

    // ── 7. Select-on-sheet (Stage 3.5, READ-ONLY) ───────────────────────────
    // One uniform path for every source: render the requested page to a
    // display image, then OCR that image for line runs — exact pixel
    // alignment between what the user sees and the tappable rects, with no
    // PDF-coordinate flipping. (Deviation from the spec's "PDFKit selections
    // per line": Vision-on-the-render keeps a single code path and pixel-true
    // overlays; the UX is identical.)

    static func downscale(_ image: UIImage, maxWidth: CGFloat) -> UIImage {
        guard let cg = image.cgImage, CGFloat(cg.width) > maxWidth else { return image }
        let s = maxWidth / CGFloat(cg.width)
        let size = CGSize(width: CGFloat(cg.width) * s, height: CGFloat(cg.height) * s)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            ctx.cgContext.interpolationQuality = .high
            UIImage(cgImage: cg).draw(in: CGRect(origin: .zero, size: size))
        }
    }

    static func pageRuns(paths: [String], page: Int) throws -> [String: Any] {
        let urls = paths.map { URL(fileURLWithPath: $0) }
        let display: UIImage
        if urls.count == 1, let pdf = PDFDocument(url: urls[0]) {
            guard page >= 1, page <= pdf.pageCount, let p = pdf.page(at: page - 1) else { throw err("page out of range") }
            display = render(page: p, maxWidth: 1200)
        } else {
            guard page >= 1, page <= urls.count else { throw err("page out of range") }
            guard let raw = UIImage(contentsOfFile: urls[page - 1].path) else { throw err("unreadable image") }
            display = downscale(upscaleIfSmall(raw), maxWidth: 1600)
        }
        let r = try ocr(display)
        guard let data = display.jpegData(compressionQuality: 0.8) else { throw err("encode failed") }
        let dest = FileManager.default.temporaryDirectory
            .appendingPathComponent("callsheet-page-\(UUID().uuidString).jpg")
        try data.write(to: dest)
        let W = display.cgImage.map { Double($0.width) } ?? Double(display.size.width)
        let H = display.cgImage.map { Double($0.height) } ?? Double(display.size.height)
        let runs: [[String: Any]] = r.lines.map {
            ["text": $0.text,
             "x": Double($0.rectPx.minX), "y": Double($0.rectPx.minY),
             "w": Double($0.rectPx.width), "h": Double($0.rectPx.height)]
        }
        return ["imagePath": dest.path, "width": W, "height": H, "runs": runs]
    }

    static func err(_ message: String) -> NSError {
        NSError(domain: "CallSheet", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
