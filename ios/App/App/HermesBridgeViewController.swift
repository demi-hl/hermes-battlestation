import UIKit
import Capacitor

// Custom bridge VC: lets each install point the webview at its OWN Hermes
// backend at runtime, instead of a URL baked into the public app.
//
// Capacitor owns the URL (descriptor.serverURL) AND the navigation delegate
// (keyboard resize, haptics, push, JS bridge). We do NOT touch the delegate —
// a failed load surfaces via Capacitor's native errorPath (ios-web/error.html).
//
// Read order: UserDefaults("hermes_server_url") -> capacitor.config server.url.
// If the setup screen captured a token, it is appended once as ?token=... and
// immediately removed from native storage; the server swaps it for an httpOnly
// cookie via middleware.
class HermesBridgeViewController: CAPBridgeViewController {

    static let serverURLKey = "hermes_server_url"
    static let pendingTokenKey = "hermes_pending_token"

    override open func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let stored = UserDefaults.standard.string(forKey: Self.serverURLKey),
           !stored.isEmpty,
           URL(string: stored) != nil {
            descriptor.serverURL = Self.urlWithPendingToken(stored)
        }
        return descriptor
    }

    private static func urlWithPendingToken(_ raw: String) -> String {
        guard let token = UserDefaults.standard.string(forKey: pendingTokenKey),
              !token.isEmpty,
              var components = URLComponents(string: raw) else {
            return raw
        }
        var items = components.queryItems ?? []
        items.removeAll { $0.name == "token" }
        items.append(URLQueryItem(name: "token", value: token))
        components.queryItems = items
        UserDefaults.standard.removeObject(forKey: pendingTokenKey)
        return components.url?.absoluteString ?? raw
    }
}
