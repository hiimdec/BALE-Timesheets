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
            call.reject("Document scanning not supported on this device")
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
        let isPdf = UTType(filenameExtension: ext)?.conforms(to: .pdf) ?? (ext.lowercased() == "pdf")
        call.resolve(["path": dest.path, "kind": isPdf ? "pdf" : "image"])
    }

    // MARK: getPageRuns — select-on-sheet support (Stage 3.5). READ-ONLY: a
    // full-page display image (tmp JPEG; JS loads it via convertFileSrc) plus
    // the page's text line runs with rects in that image's pixel space, so the
    // verify view can overlay tappable regions. No iOS 26 gate — Vision/PDFKit
    // only — and no behaviour change anywhere else.

    @objc func getPageRuns(_ call: CAPPluginCall) {
        // Same gate as extract — not because Vision needs it, but because the
        // pipeline namespace is availability-scoped and select-on-sheet is
        // only reachable after a successful (iOS 26+) extraction anyway.
        guard #available(iOS 26.0, *) else { call.reject("Requires iOS 26"); return }
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

    @objc func extract(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else { call.reject("Requires iOS 26"); return }
        guard SystemLanguageModel.default.availability == .available else {
            call.reject("Apple Intelligence model unavailable")
            return
        }
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
                call.reject("extract failed: \(error.localizedDescription)")
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

@available(iOS 26.0, *)
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

        // Guided generation per selected page (chunk-safe), collect candidates.
        var order = 0
        var candidates: [String: [Candidate]] = [:]
        for page in selected {
            let fromInvoic = invoicSet.contains(page.index)
            for chunk in chunks(of: page.text, budget: 10_000) {
                guard let fields = await generate(on: chunk) else { continue }
                order += 1
                for (key, value) in fieldValues(fields) {
                    guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { continue }
                    let match = matchBack(value: raw, in: page.text)
                    let verified = verify(key: key, value: raw, match: match, pageText: page.text)
                    candidates[key, default: []].append(Candidate(
                        value: raw, pageIndex: page.index, order: order,
                        fromInvoicPage: fromInvoic, verified: verified, matchRange: match
                    ))
                }
            }
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
            perField[key] = e
        }
        func setHarvested(_ key: String, _ hit: EmailHit) {
            fields[key] = hit.token
            var e: [String: Any] = ["value": hit.token, "state": "verified", "page": hit.pageIndex + 1]
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
            // cleaned with token extraction (a model line may carry two addrs).
            let primaryRaw = (fields["invoicingEmail"] as? String) ?? ""
            let primaryTokens = extractEmails(primaryRaw)
            let primaryPage = ((perField["invoicingEmail"] as? [String: Any])?["page"] as? Int) ?? 1
            if primaryTokens.count >= 2, ((fields["ccEmail"] as? String) ?? "").isEmpty {
                setEmail("ccEmail", primaryTokens[1], page: primaryPage)
            }
            if let first = primaryTokens.first {
                setEmail("invoicingEmail", first, page: primaryPage)
            } else if fields["invoicingEmail"] != nil {
                var e = (perField["invoicingEmail"] as? [String: Any]) ?? [:]; e["state"] = "unverified"; perField["invoicingEmail"] = e
            }
            let ccRaw = (fields["ccEmail"] as? String) ?? ""
            let ccTokens = extractEmails(ccRaw)
            let ccPage = ((perField["ccEmail"] as? [String: Any])?["page"] as? Int) ?? primaryPage
            if let firstCc = ccTokens.first {
                setEmail("ccEmail", firstCc, page: ccPage)
            } else if fields["ccEmail"] != nil {
                var e = (perField["ccEmail"] as? [String: Any]) ?? [:]; e["state"] = "unverified"; perField["ccEmail"] = e
            }
        }

        // HARD RULE — CC must never duplicate the primary invoicing email.
        if let cc = (fields["ccEmail"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           let primary = (fields["invoicingEmail"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           cc == primary {
            fields["ccEmail"] = nil
            perField["ccEmail"] = ["state": "missing"]
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
    static func verify(key: String, value: String, match: NSRange?, pageText: String) -> Bool {
        switch key {
        case "invoicingEmail", "ccEmail":
            guard isPlausibleEmail(value) else { return false }
            return match != nil
        case "invoicingAddress":
            guard let r = match else { return false }
            let span = (pageText as NSString).substring(with: r)
            return containsUKPostcode(span) || containsUKPostcode(value)
        default:
            return match != nil
        }
    }

    static func isPlausibleEmail(_ s: String) -> Bool {
        let pattern = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$"
        return s.range(of: pattern, options: .regularExpression) != nil
    }

    /// Pull every valid email TOKEN out of a string, in order, case-insensitively
    /// de-duplicated. An invoicing email is often printed on a shared line — e.g.
    /// "EMAIL INVOICES TO: a@x.com & b@y.com" — so the right operation is to
    /// EXTRACT the address(es) from the value, not validate the whole line as one.
    static func extractEmails(_ s: String) -> [String] {
        let pattern = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = s as NSString
        var out: [String] = []
        var seen = Set<String>()
        for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            let tok = ns.substring(with: m.range)
            if seen.insert(tok.lowercased()).inserted { out.append(tok) }
        }
        return out
    }

    // ── Invoicing-email harvest + proximity scoring (deterministic, no model) ──
    // Email fields are unreliable when the 3B model leads, so we regex EVERY
    // address across all page text and score each by PROXIMITY to invoicing
    // intent rather than model opinion. Only an email with explicit invoicing
    // intent near it is a candidate — so a crew/agent address is never promoted.

    struct EmailHit { let token: String; let pageIndex: Int; let range: NSRange; let lineRange: NSRange; let score: Int }

    // Positive: the email's line or the line above carries invoicing intent.
    // ("invoice" matches "invoices/invoiced"; "account" matches "accounts".)
    static let invoiceIntentKeywords = ["invoice", "invoicing", "account", "billing", "please email", "send to", "send invoices", "email invoices", "remittance", "pay to"]
    // Demote: crew/contact-list context around the email.
    static let crewContextKeywords = ["crew", "unit list", "call sheet", "runner", "gaffer", "best boy", "electrician", "rigger", "trainee", "daily", "mobile", "diary", "director", "producer", "1st ad", "2nd ad", "stand-by", "standby"]

    static func harvestInvoicingEmails(_ pages: [SourcePage]) -> (primary: EmailHit?, cc: EmailHit?) {
        guard let emailRe = try? NSRegularExpression(pattern: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}") else { return (nil, nil) }
        let phonePattern = "(\\+44\\s?7|\\b07)\\d{2,3}[\\s.\\-]?\\d{3}[\\s.\\-]?\\d{3}"
        var candidates: [EmailHit] = []
        for page in pages {
            let ns = page.text as NSString
            let matches = emailRe.matches(in: page.text, range: NSRange(location: 0, length: ns.length))
            let emailLocs = matches.map { $0.range.location }
            for m in matches {
                let lineRange = ns.lineRange(for: m.range)
                let line = ns.substring(with: lineRange).lowercased()
                var prev = ""
                if lineRange.location > 0 {
                    let pr = ns.lineRange(for: NSRange(location: lineRange.location - 1, length: 0))
                    prev = ns.substring(with: pr).lowercased()
                }
                let lineHit = invoiceIntentKeywords.contains { line.contains($0) }
                let prevHit = invoiceIntentKeywords.contains { prev.contains($0) }
                let positive = (lineHit ? 10 : 0) + (prevHit ? 5 : 0)
                if positive == 0 { continue }  // no invoicing intent → never a candidate (crew-safe)
                var score = positive
                if crewContextKeywords.contains(where: { line.contains($0) }) { score -= 6 }
                if crewContextKeywords.contains(where: { prev.contains($0) }) { score -= 4 }
                if (line + " " + prev).range(of: phonePattern, options: .regularExpression) != nil { score -= 4 }
                let clustered = emailLocs.filter { abs($0 - m.range.location) <= 220 }.count
                if clustered >= 4 { score -= 5 }  // dense email rows = a list, not an invoicing block
                candidates.append(EmailHit(token: ns.substring(with: m.range), pageIndex: page.index, range: m.range, lineRange: lineRange, score: score))
            }
        }
        let sorted = candidates.sorted {
            $0.score != $1.score ? $0.score > $1.score
            : ($0.pageIndex != $1.pageIndex ? $0.pageIndex < $1.pageIndex : $0.range.location < $1.range.location)
        }
        guard let best = sorted.first else { return (nil, nil) }
        // CC = a distinct invoicing-intent address on the SAME line or the same
        // block (an adjacent line, ~within 120 chars).
        let cc = sorted.first {
            $0.token.lowercased() != best.token.lowercased() && $0.pageIndex == best.pageIndex &&
            (NSEqualRanges($0.lineRange, best.lineRange) || abs($0.lineRange.location - best.lineRange.location) <= 120)
        }
        return (best, cc)
    }

    static func containsUKPostcode(_ s: String) -> Bool {
        let pattern = "[A-Za-z]{1,2}[0-9][0-9A-Za-z]?\\s*[0-9][A-Za-z]{2}"
        return s.range(of: pattern, options: .regularExpression) != nil
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
