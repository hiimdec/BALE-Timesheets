//
//  NativePdfPlugin.swift
//
//  In-app Capacitor 8 plugin that renders an HTML string to a vector A4 PDF
//  using the iOS WebKit print pipeline:
//
//    self-contained HTML  →  off-screen WKWebView  →  viewPrintFormatter()
//    →  UIPrintPageRenderer  →  UIGraphics PDF context  →  base64 → JS
//
//  Why this pipeline and not WKWebView.createPDF: createPDF is a single-shot
//  region snapshot (it does not run the document through the WebKit print
//  formatter, so CSS @page page-break rules don't drive pagination). The
//  print-formatter route is what `window.print()` uses internally, so the
//  output matches the web print PDF on a per-glyph basis.
//
//  Why paperRect == printableRect: UIPrintPageRenderer lets the host inset
//  a printable area inside the paper, and many plugins (e.g. Cap-go's
//  capacitor-pdf-generator) hard-code ~20 pt of inset. We need ZERO native
//  inset so the only margins on the output come from the source CSS
//  @page rule — which is how the web build is laid out.
//
//  The plugin is auto-discovered by Capacitor 8's bridge via the Objective-C
//  runtime because the class is `@objc(NativePdfPlugin)` and implements
//  CAPBridgedPlugin. No explicit registration is needed in AppDelegate.
//

import Foundation
import Capacitor
import WebKit
import UIKit

@objc(NativePdfPlugin)
public class NativePdfPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativePdfPlugin"
    public let jsName = "NativePdf"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "renderHtmlToPdf", returnType: CAPPluginReturnPromise)
    ]

    // Strong references to in-flight render tasks so they survive until their
    // WKWebView delegate callbacks resolve. Removed in `taskFinished(_:)`.
    private var pending: [PdfRenderTask] = []

    @objc func renderHtmlToPdf(_ call: CAPPluginCall) {
        guard let html = call.getString("html"), !html.isEmpty else {
            call.reject("'html' parameter is required and must not be empty")
            return
        }
        // Per-page margins (millimetres) supplied by the JS caller to match the
        // screen's web @page rule. UIPrintPageRenderer ignores CSS @page, so the
        // margins are applied natively as a printableRect inset. Default 0 (a
        // full-bleed page, e.g. the timesheet screens).
        let mmToPt = 72.0 / 25.4
        let margins = UIEdgeInsets(
            top: CGFloat((call.getDouble("marginTopMm") ?? 0) * mmToPt),
            left: CGFloat((call.getDouble("marginLeftMm") ?? 0) * mmToPt),
            bottom: CGFloat((call.getDouble("marginBottomMm") ?? 0) * mmToPt),
            right: CGFloat((call.getDouble("marginRightMm") ?? 0) * mmToPt)
        )
        let task = PdfRenderTask(plugin: self, call: call, html: html, margins: margins)
        pending.append(task)
        task.start()
    }

    fileprivate func taskFinished(_ task: PdfRenderTask) {
        pending.removeAll { $0 === task }
    }

    fileprivate func hostView() -> UIView? {
        return self.bridge?.viewController?.view
    }
}

private final class PdfRenderTask: NSObject, WKNavigationDelegate {
    private weak var plugin: NativePdfPlugin?
    private let call: CAPPluginCall
    private let html: String
    private let margins: UIEdgeInsets
    private var webView: WKWebView?
    private var didFinish = false

    // A4 portrait in PostScript points (1 mm = 72/25.4 points).
    private static let mmToPt: CGFloat = 72.0 / 25.4
    private static let a4PortraitPt = CGSize(width: 210.0 * mmToPt, height: 297.0 * mmToPt)

    // Printable content box = full A4 minus the per-page margins. Content is
    // both laid out (WebView frame width) and drawn (printableRect) at this
    // size, so the web content reflows to exactly the column width it gets on
    // the web build — no scale-to-fit, margins identical on every page.
    private var printableRect: CGRect {
        CGRect(x: margins.left,
               y: margins.top,
               width: Self.a4PortraitPt.width - margins.left - margins.right,
               height: Self.a4PortraitPt.height - margins.top - margins.bottom)
    }

    init(plugin: NativePdfPlugin, call: CAPPluginCall, html: String, margins: UIEdgeInsets) {
        self.plugin = plugin
        self.call = call
        self.html = html
        self.margins = margins
        super.init()
    }

    func start() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            // Size the off-screen WebView to the printable content box (A4 minus
            // margins) so the web content lays out at the same column width as
            // the web build and the print formatter draws it 1:1 (no scaling).
            let frame = CGRect(origin: .zero, size: self.printableRect.size)
            let wv = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
            wv.navigationDelegate = self
            wv.isHidden = true
            // Must be in a view hierarchy for some WebKit rendering paths to
            // produce non-empty layout. Hidden = invisible to the user.
            self.plugin?.hostView()?.addSubview(wv)
            self.webView = wv
            wv.loadHTMLString(self.html, baseURL: nil)
        }
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Brief settle window for any deferred layout / image decoding inside
        // the document (e.g. inline base64 logos in the invoice header).
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.generatePdf()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail("Failed to load HTML: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail("Failed to load HTML: \(error.localizedDescription)")
    }

    // MARK: - PDF generation

    private func generatePdf() {
        guard let wv = self.webView else {
            fail("WebView no longer available")
            return
        }

        let pageRect = CGRect(origin: .zero, size: Self.a4PortraitPt)
        let renderer = UIPrintPageRenderer()
        renderer.addPrintFormatter(wv.viewPrintFormatter(), startingAtPageAt: 0)

        // UIPrintPageRenderer ignores CSS @page margins, so margins are applied
        // here: paperRect is the full A4 sheet, printableRect is the inset
        // content box. The print formatter lays out and paginates within
        // printableRect on EVERY page → per-page margins matching web's @page.
        // (paperRect/printableRect are KVC-only on UIPrintPageRenderer.)
        renderer.setValue(pageRect, forKey: "paperRect")
        renderer.setValue(self.printableRect, forKey: "printableRect")

        let pageCount = renderer.numberOfPages
        guard pageCount > 0 else {
            fail("No printable content rendered")
            return
        }

        let pdfData = NSMutableData()
        UIGraphicsBeginPDFContextToData(pdfData, pageRect, nil)
        for i in 0..<pageCount {
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
        }
        UIGraphicsEndPDFContext()

        complete(with: pdfData as Data)
    }

    // MARK: - Resolution

    private func complete(with data: Data) {
        let base64 = data.base64EncodedString()
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.call.resolve(["base64": base64])
            self.cleanup()
        }
    }

    private func fail(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.call.reject(message)
            self.cleanup()
        }
    }

    private func cleanup() {
        guard !didFinish else { return }
        didFinish = true
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.removeFromSuperview()
        webView = nil
        plugin?.taskFinished(self)
    }
}
