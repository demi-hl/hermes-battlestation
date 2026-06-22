import UIKit
import Capacitor

// Custom bridge VC: lets each install point the webview at its OWN Hermes
// backend at runtime, instead of the URL baked in at build time.
//
// Capacitor owns the URL (descriptor.serverURL), so the native bridge — keyboard
// resize, haptics, push registration — is still injected onto the remote origin.
// A plain JS redirect would lose that bridge; this does not.
//
// Read order: UserDefaults("hermes_server_url") -> capacitor.config server.url default.
class HermesBridgeViewController: CAPBridgeViewController {

    static let serverURLKey = "hermes_server_url"

    override open func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let stored = UserDefaults.standard.string(forKey: Self.serverURLKey),
           !stored.isEmpty,
           URL(string: stored) != nil {
            descriptor.serverURL = stored
        }
        return descriptor
    }
}
