//
//  PendingEventsStore.swift
//  App
//
//  The App Group event queue's HAND-OVER LOGIC - pure Foundation, no UIKit,
//  no Capacitor, no ActivityKit, so scripts/native-audit/pending-events-store.js
//  compiles it with swiftc and EXECUTES the pins (the BuildKind pattern).
//
//  AT-LEAST-ONCE (founder-ruled 2026-09-04, after the lost 32-minute curtail):
//  the old drain read-and-deleted, so a death between the hand-over and the
//  record's persist ate the press with the queue already empty. Now a drain
//  MOVES pending events into an in-flight set and hands everything unconfirmed;
//  only confirmEvents - called by JS after its persist chain has flushed -
//  removes an event. A re-hand carries `targetDate` once JS has claimed it, so
//  a next-day re-hand never re-resolves ownership and is never lost a second
//  way. Presses older than the cap leave as `expired`, never silently: JS
//  ledgers them for the mismatch sheet.
//
//  The JS consumers are idempotent (absolute-value writes, IA7), which is what
//  makes at-least-once safe.
//

import Foundation

enum PendingEventsStore {
    /// Seven days, measured from the PRESS (`ts`), not from the first hand.
    static let ageCapMs = 7 * 24 * 3600 * 1000

    struct Drain {
        let hand: [[String: Any]]       // everything unconfirmed, oldest press first
        let inflight: [[String: Any]]   // what to store as the new in-flight set
        let expired: [[String: Any]]    // dropped from in-flight; JS ledgers them
    }

    static func id(_ e: [String: Any]) -> String { e["id"] as? String ?? "" }
    static func ts(_ e: [String: Any]) -> Int {
        if let i = e["ts"] as? Int { return i }
        if let d = e["ts"] as? Double { return Int(d) }
        return 0
    }

    static func drain(pending: [[String: Any]], inflight: [[String: Any]], nowMs: Int, capMs: Int = ageCapMs) -> Drain {
        var byId: [String: [String: Any]] = [:]
        var order: [String] = []
        for e in inflight {
            let k = id(e)
            guard !k.isEmpty, byId[k] == nil else { continue }
            byId[k] = e
            order.append(k)
        }
        for e in pending {
            let k = id(e)
            guard !k.isEmpty, byId[k] == nil else { continue }   // dedupe: an id already in flight is not re-added
            var n = e
            n["handedAt"] = nowMs
            n["hands"] = 0
            byId[k] = n
            order.append(k)
        }
        var expired: [[String: Any]] = []
        var live: [[String: Any]] = []
        for k in order {
            var e = byId[k]!
            if nowMs - ts(e) > capMs { expired.append(e); continue }
            e["hands"] = ((e["hands"] as? Int) ?? 0) + 1
            live.append(e)
        }
        live.sort { ts($0) < ts($1) }
        return Drain(hand: live, inflight: live, expired: expired)
    }

    /// Stores the target date JS resolved for each id - so a re-hand carries it.
    static func claim(inflight: [[String: Any]], targets: [String: String]) -> [[String: Any]] {
        inflight.map { e in
            var n = e
            if let t = targets[id(e)], !t.isEmpty { n["targetDate"] = t }
            return n
        }
    }

    /// The ONLY remover.
    static func confirm(inflight: [[String: Any]], ids: [String]) -> [[String: Any]] {
        let set = Set(ids)
        return inflight.filter { !set.contains(id($0)) }
    }
}
