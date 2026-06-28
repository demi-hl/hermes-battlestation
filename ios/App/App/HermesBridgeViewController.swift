import UIKit
import Capacitor

// Custom bridge VC: points the webview at this install's Hermes backend, whether
// that URL is BAKED at build time (CAP_SERVER_URL -> capacitor.config.json) or
// entered by the user at runtime (setup screen -> UserDefaults). BOTH paths must:
//   1. append the access token as ?token=… so the server can mint its cookie, and
//   2. whitelist the box host in allowedNavigationHostnames.
//
// Why (2) is critical: the server swaps ?token=… for an httpOnly bs_token cookie
// via a 307 redirect to the CLEAN url. Capacitor's nav handler only keeps a
// redirect IN the webview if its host is allowed OR it prefixes the (tokenized,
// longer) serverURL string. The clean redirect target fails that prefix test, so
// without the host whitelist Capacitor treats the box as EXTERNAL -> opens it in
// Safari/Chrome and cancels the in-app load -> the app shows errorPath
// (error.html "Reconnecting…") or a blank screen. Whitelisting the host keeps the
// whole token->cookie round-trip inside the webview.
//
// AUTH PERSISTENCE (self-healing): the token lives in the Keychain (TokenStore)
// and is re-appended on EVERY cold launch, so a dropped cookie (deploy, Tailscale
// blip, WebView eviction) self-heals on the next launch.
class HermesBridgeViewController: CAPBridgeViewController {

    static let serverURLKey = "hermes_server_url"
    static let pendingTokenKey = "hermes_pending_token"
    // Sentinel baked into the public OSS build = "no real URL". Never load or
    // whitelist it; AppDelegate routes that case to the setup screen instead.
    private static let sentinelURL = "https://connect.localhost.invalid"

    override open func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()

        // Effective backend URL: a user-entered (stored) URL wins; otherwise the
        // build-time baked one from capacitor.config.json (descriptor.serverURL).
        let stored = (UserDefaults.standard.string(forKey: Self.serverURLKey) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let baked = (descriptor.serverURL ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        var base = ""
        if !stored.isEmpty, URL(string: stored) != nil {
            base = stored
        } else if !baked.isEmpty, baked != Self.sentinelURL, URL(string: baked) != nil {
            base = baked
        }

        if !base.isEmpty, let baseURL = URL(string: base) {
            descriptor.serverURL = Self.urlWithToken(base)
            if let host = baseURL.host, !host.isEmpty {
                var hosts = descriptor.allowedNavigationHostnames
                if !hosts.contains(host) {
                    hosts.append(host)
                    descriptor.allowedNavigationHostnames = hosts
                }
            }
        }
        return descriptor
    }

    // Resolve the token to ride this launch. Order: a fresh pending token from the
    // setup screen (promoted into the Keychain), then the persisted Keychain token,
    // then any token already baked into the base URL's query (?token=… baked via
    // CAP_SERVER_URL for a zero-touch personal build) — which we also persist so
    // later launches keep it.
    private static func resolveToken(bakedInURL: String?) -> String? {
        if let pending = UserDefaults.standard.string(forKey: pendingTokenKey),
           !pending.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            TokenStore.save(pending)
            UserDefaults.standard.removeObject(forKey: pendingTokenKey)
            return pending
        }
        if let stored = TokenStore.load(), !stored.isEmpty {
            return stored
        }
        if let baked = bakedInURL,
           !baked.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            TokenStore.save(baked)
            return baked
        }
        return nil
    }

    private static func urlWithToken(_ raw: String) -> String {
        guard var components = URLComponents(string: raw) else { return raw }
        var items = components.queryItems ?? []
        let bakedToken = items.first(where: { $0.name == "token" })?.value
        let token = resolveToken(bakedInURL: bakedToken)
        items.removeAll { $0.name == "token" }
        if let token = token, !token.isEmpty {
            items.append(URLQueryItem(name: "token", value: token))
        }
        components.queryItems = items.isEmpty ? nil : items
        return components.url?.absoluteString ?? raw
    }
}
