import UIKit
import Capacitor

// Custom bridge VC: lets each install point the webview at its OWN Hermes
// backend at runtime, instead of a URL baked into the public app.
//
// Capacitor owns the URL (descriptor.serverURL) AND the navigation delegate
// (keyboard resize, haptics, push, JS bridge). We do NOT touch the delegate —
// a failed load surfaces via Capacitor's native errorPath (ios-web/error.html).
//
// AUTH PERSISTENCE (self-healing): the access token lives in the Keychain
// (TokenStore) and is re-appended to the server URL on EVERY cold launch as
// ?token=…. The server's middleware strips it from the URL and swaps it for a
// fresh httpOnly bs_token cookie. So a dropped cookie (box restart/deploy,
// Tailscale blip, WebView storage eviction) self-heals on the next launch
// instead of bouncing the user to the setup screen. UserDefaults(pendingToken)
// is honored once as a migration path from the old single-use flow, then
// promoted into the Keychain.
class HermesBridgeViewController: CAPBridgeViewController {

    static let serverURLKey = "hermes_server_url"
    static let pendingTokenKey = "hermes_pending_token"

    override open func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let stored = UserDefaults.standard.string(forKey: Self.serverURLKey),
           !stored.isEmpty,
           let storedURL = URL(string: stored) {
            descriptor.serverURL = Self.urlWithToken(stored)
            // CRITICAL: the server swaps ?token=… for an httpOnly cookie via a 307
            // redirect to the CLEAN URL. Capacitor's nav handler only keeps a redirect
            // in-webview when its host is allowed OR it prefixes serverURL — and the
            // tokenized serverURL is LONGER than the clean redirect target, so the
            // prefix test fails and Capacitor punts the load to the system browser
            // (Chrome) leaving a blank app. Whitelisting the box's host keeps the
            // whole auth round-trip inside the webview. Without this EVERY remote box
            // blanks on first load.
            if let host = storedURL.host, !host.isEmpty {
                var hosts = descriptor.allowedNavigationHostnames
                if !hosts.contains(host) {
                    hosts.append(host)
                    descriptor.allowedNavigationHostnames = hosts
                }
            }
        }
        return descriptor
    }

    // Resolve the token to ride this launch. Prefer a fresh pending token from
    // the setup screen (and promote it into the Keychain); otherwise fall back
    // to the persisted Keychain token. Returns nil when neither exists.
    private static func resolveToken() -> String? {
        if let pending = UserDefaults.standard.string(forKey: pendingTokenKey),
           !pending.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            TokenStore.save(pending)
            UserDefaults.standard.removeObject(forKey: pendingTokenKey)
            return pending
        }
        return TokenStore.load()
    }

    private static func urlWithToken(_ raw: String) -> String {
        guard let token = resolveToken(),
              !token.isEmpty,
              var components = URLComponents(string: raw) else {
            return raw
        }
        var items = components.queryItems ?? []
        items.removeAll { $0.name == "token" }
        items.append(URLQueryItem(name: "token", value: token))
        components.queryItems = items
        return components.url?.absoluteString ?? raw
    }
}
