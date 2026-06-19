//
//  ShareSheetPlugin.swift
//
//  Email an invoice via the iOS share sheet (the "Another email app" method)
//  with the email BODY's paragraph breaks PRESERVED in HTML-composing mail apps
//  (Gmail, Outlook).
//
//  WHY a custom plugin instead of @capacitor/share: that plugin vends the body
//  as a bare plain-text String activity item. Gmail's share/compose is an HTML
//  editor — it drops a plain-text body into an HTML body WITHOUT converting "\n"
//  into <br>, so CSS white-space:normal collapses the paragraph breaks to single
//  spaces (the body lands as one run-on paragraph). Apple Mail differs only
//  because its path (capacitor-email-composer → MFMailComposeViewController with
//  isHTML:false) is a true text/plain body where "\n" is a hard break.
//
//  THE FIX: vend the body as an NSAttributedString activity item. Mail composers
//  convert it to a genuine HTML body (paragraphs preserved); NON-mail targets
//  (Messages, Notes, Copy, AirDrop) automatically extract its PLAIN `.string`, so
//  they get clean "\n\n" text with NO tag leakage. It self-adapts per target with
//  NO activity-type allow-list, and its WORST case equals the prior behaviour
//  (the plain run-on body) — it can never regress to raw tags or an HTML
//  attachment. Gmail rendering the rich body is the one on-device-verifiable
//  assumption; a parse failure or a non-cooperating app simply yields the plain
//  body (today's result).
//
//  App-embedded Capacitor 8 plugin (same template as NativePdf / LiveActivity /
//  CallSheet / AppIcon: @objc CAPPlugin / CAPBridgedPlugin, registered in
//  MainViewController.capacitorDidLoad). Used ONLY by the invoice share-sheet
//  email path; the JS falls back to @capacitor/share if this plugin is absent.
//

import Foundation
import Capacitor
import UIKit

@objc(ShareSheetPlugin)
public class ShareSheetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareSheetPlugin"
    public let jsName = "ShareSheet"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareEmail", returnType: CAPPluginReturnPromise)
    ]

    // html    — the body as an escaped HTML fragment/doc (<p>/<br>); parsed once
    //           into an NSAttributedString so mail composers render real paragraphs.
    // plain   — the same body as plain text (the placeholder + the parse-failure
    //           fallback + what non-mail targets extract).
    // subject — the email subject (honoured by mail apps that read it).
    // fileUri — the PDF attachment (file:// URI from the JS Filesystem write).
    @objc func shareEmail(_ call: CAPPluginCall) {
        let html = call.getString("html") ?? ""
        let plain = call.getString("plain") ?? ""
        let subject = call.getString("subject") ?? ""
        let fileUri = call.getString("fileUri") ?? ""
        guard let fileURL = URL(string: fileUri) else {
            call.reject("A valid fileUri is required")
            return
        }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("No view controller to present from")
                return
            }
            // Parse HTML → NSAttributedString ONCE here. The parse is main-thread-
            // only and non-trivial, and UIActivityItemSource callbacks must stay
            // cheap — so we do it up front and the callbacks just return the result.
            // Parse failure → plain text (no regression).
            let rich: NSAttributedString
            if let data = html.data(using: .utf8),
               let attr = try? NSAttributedString(
                    data: data,
                    options: [.documentType: NSAttributedString.DocumentType.html,
                              .characterEncoding: String.Encoding.utf8.rawValue],
                    documentAttributes: nil) {
                rich = attr
            } else {
                rich = NSAttributedString(string: plain)
            }
            let bodyItem = EmailBodyItemSource(rich: rich, plain: plain, subject: subject)
            let av = UIActivityViewController(activityItems: [bodyItem, fileURL], applicationActivities: nil)
            av.completionWithItemsHandler = { (_, completed, _, error) in
                if let error = error {
                    call.reject("Share failed: \(error.localizedDescription)")
                } else {
                    call.resolve(["status": completed ? "shared" : "cancelled"])
                }
            }
            self.setCenteredPopover(av)   // CAPPlugin helper (iPad popover anchor) — as @capacitor/share uses
            vc.present(av, animated: true, completion: nil)
        }
    }
}

// Vends the prebuilt rich body to every target. Mail composers convert the
// NSAttributedString to an HTML body (paragraphs preserved); non-mail targets
// extract its plain `.string`. Every callback returns a prebuilt value, so none
// blocks the main thread.
final class EmailBodyItemSource: NSObject, UIActivityItemSource {
    private let rich: NSAttributedString
    private let plain: String
    private let subject: String

    init(rich: NSAttributedString, plain: String, subject: String) {
        self.rich = rich
        self.plain = plain
        self.subject = subject
    }

    func activityViewControllerPlaceholderItem(_ controller: UIActivityViewController) -> Any {
        return plain
    }

    func activityViewController(_ controller: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
        return rich
    }

    func activityViewController(_ controller: UIActivityViewController, subjectForActivityType activityType: UIActivity.ActivityType?) -> String {
        return subject
    }
}
