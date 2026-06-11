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
    @Guide(description: "The email address invoices should be sent to. If several are listed, the primary 'send to' address.")
    var invoicingEmail: String?
    @Guide(description: "The postal address invoices should be addressed to, including postcode")
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
        CAPPluginMethod(name: "extract", returnType: CAPPluginReturnPromise)
    ]

    private var pendingPickCall: CAPPluginCall?
    private var pickerDelegate: CallSheetPickerDelegate?

    // MARK: isAvailable — the four documented cases (+ osTooOld)

    @objc func isAvailable(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.resolve(["available": false, "reason": "osTooOld"])
            return
        }
        switch SystemLanguageModel.default.availability {
        case .available:
            call.resolve(["available": true, "reason": ""])
        case .unavailable(.deviceNotEligible):
            call.resolve(["available": false, "reason": "deviceNotEligible"])
        case .unavailable(.appleIntelligenceNotEnabled):
            call.resolve(["available": false, "reason": "appleIntelligenceNotEnabled"])
        case .unavailable(.modelNotReady):
            call.resolve(["available": false, "reason": "modelNotReady"])
        case .unavailable(_):
            call.resolve(["available": false, "reason": "unavailable"])
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

    // MARK: extract — the pipeline

    @objc func extract(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else { call.reject("Requires iOS 26"); return }
        guard SystemLanguageModel.default.availability == .available else {
            call.reject("Apple Intelligence model unavailable")
            return
        }
        guard let path = call.getString("path"), !path.isEmpty else {
            call.reject("path required")
            return
        }
        Task {
            do {
                let result = try await CallSheetPipeline.run(path: path)
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
    }

    struct Candidate {
        let value: String
        let pageIndex: Int
        let order: Int          // session order
        let fromInvoicPage: Bool
        let verified: Bool
        let matchRange: NSRange?  // in page text, when matched
    }

    static let fieldKeys = ["title", "prodCo", "jobReference", "invoicingEmail", "invoicingAddress"]
    static let invoicingKeys: Set<String> = ["jobReference", "invoicingEmail", "invoicingAddress"]

    // ── Entry ───────────────────────────────────────────────────────────────

    static func run(path: String) async throws -> [String: Any] {
        let url = URL(fileURLWithPath: path)
        let pages = try loadPages(url: url)
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

        return [
            "fields": fields,
            "perField": perField,
            "pages": [
                "count": pages.count,
                "selected": selected.map { $0.index + 1 },
                "invoicPages": invoicSet.sorted().map { $0 + 1 },
            ],
        ]
    }

    // ── 1. Page text (PDF layer, OCR fallback; images straight to OCR) ──────

    static func loadPages(url: URL) throws -> [SourcePage] {
        if let pdf = PDFDocument(url: url) {
            var out: [SourcePage] = []
            for i in 0..<pdf.pageCount {
                guard let page = pdf.page(at: i) else { continue }
                let layer = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if layer.count > 40 {
                    out.append(SourcePage(index: i, text: page.string ?? "", target: .pdfLayer(page)))
                } else {
                    let image = render(page: page, maxWidth: 1600)
                    let (lines, text) = (try? ocr(image)) ?? ([], "")
                    out.append(SourcePage(index: i, text: text, target: .ocr(lines: lines, image: image)))
                }
            }
            return out
        }
        guard let image = UIImage(contentsOfFile: url.path) else { throw err("unreadable file") }
        let (lines, text) = try ocr(image)
        return [SourcePage(index: 0, text: text, target: .ocr(lines: lines, image: image))]
    }

    static func render(page: PDFPage, maxWidth: CGFloat) -> UIImage {
        let bounds = page.bounds(for: .mediaBox)
        let scale = min(maxWidth / max(bounds.width, 1), 3)
        let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        return page.thumbnail(of: size, for: .mediaBox)
    }

    static func ocr(_ image: UIImage) throws -> ([OcrLine], String) {
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
        for obs in sorted {
            guard let cand = obs.topCandidates(1).first else { continue }
            let start = (text as NSString).length
            text += cand.string + "\n"
            let bb = obs.boundingBox
            let rect = CGRect(x: bb.minX * W, y: (1 - bb.maxY) * H, width: bb.width * W, height: bb.height * H)
            lines.append(OcrLine(text: cand.string,
                                 range: NSRange(location: start, length: (cand.string as NSString).length),
                                 rectPx: rect))
        }
        return (lines, text)
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
        m.invoicingAddress = m.invoicingAddress ?? b.invoicingAddress
        return m
    }

    static func fieldValues(_ f: CallSheetFields) -> [(String, String?)] {
        [("title", f.title), ("prodCo", f.prodCo), ("jobReference", f.jobReference),
         ("invoicingEmail", f.invoicingEmail), ("invoicingAddress", f.invoicingAddress)]
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
        case "invoicingEmail":
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

    static func err(_ message: String) -> NSError {
        NSError(domain: "CallSheet", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
