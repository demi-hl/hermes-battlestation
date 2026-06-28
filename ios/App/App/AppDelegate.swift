import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private let pairingPlaceholderURL = "https://connect.localhost.invalid"
    // No personal URL in public source. A private build can bake its own box via
    // CAP_SERVER_URL (capacitor.config.ts) — that boots straight to the bridge and
    // skips this screen entirely. When empty, the setup field shows a generic
    // placeholder ("https://your-box.ts.net") so each user enters THEIR own box.
    private let defaultPublicURL = ""

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        installInitialRootViewController()
        return true
    }

    private func installInitialRootViewController() {
        if window == nil {
            window = UIWindow(frame: UIScreen.main.bounds)
        }

        let stored = realStoredServerURL()
        let bundled = realBundledServerURL()

        // Public/App Store builds ship with no baked server URL. First launch must
        // ask the user for THEIR Hermes URL, otherwise every install would either
        // point at localhost or someone else's box. Private builds may still set
        // CAP_SERVER_URL at build time and skip this setup screen.
        if stored?.isEmpty == false || bundled?.isEmpty == false {
            showBridge()
        } else {
            showServerSetup(defaultURL: defaultPublicURL)
        }
    }

    private func showServerSetup(defaultURL: String) {
        let setup = ServerSetupViewController()
        setup.defaultURL = defaultURL
        setup.onSaved = { [weak self] in
            self?.showBridge()
        }
        window?.rootViewController = setup
        window?.makeKeyAndVisible()
    }

    private func showBridge() {
        window?.rootViewController = HermesBridgeViewController()
        window?.makeKeyAndVisible()
    }

    private func bundledServerURL() -> String? {
        guard let url = Bundle.main.url(forResource: "capacitor.config", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let server = object["server"] as? [String: Any],
              let serverURL = server["url"] as? String,
              !serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return serverURL
    }

    private func realBundledServerURL() -> String? {
        let url = bundledServerURL()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if url.isEmpty || url == pairingPlaceholderURL {
            return nil
        }
        return url
    }

    private func realStoredServerURL() -> String? {
        let raw = UserDefaults.standard.string(forKey: HermesBridgeViewController.serverURLKey)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !raw.isEmpty,
              let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            return nil
        }
        return raw
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    // MARK: - Remote (APNs) push registration
    // The @capacitor/push-notifications plugin calls registerForRemoteNotifications();
    // iOS hands the APNs device token back here. Forward both success and failure to
    // the Capacitor proxy so the JS `registration` / `registrationError` events fire.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        if url.scheme?.lowercased() == "battlestation" {
            switch url.host?.lowercased() {
            // battlestation://setup — bounce back to the pairing screen (used by the
            // error page's "Change URL / Retry" button).
            case "setup":
                let current = UserDefaults.standard.string(forKey: HermesBridgeViewController.serverURLKey) ?? ""
                showServerSetup(defaultURL: current)
                return true
            // battlestation://connect?url=…&token=… — the pairing link from the QR /
            // "open the app directly" CTA. Store the URL + token (same path as the
            // setup screen's Connect button) and boot straight to the bridge.
            case "connect":
                let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
                let rawURL = items.first(where: { $0.name == "url" })?.value ?? ""
                let token = (items.first(where: { $0.name == "token" })?.value ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                guard let serverURL = normalizedServerURL(rawURL) else {
                    // Malformed/empty url — drop the user on setup with whatever we got
                    // so the deep link is never a dead end.
                    showServerSetup(defaultURL: rawURL)
                    return true
                }
                UserDefaults.standard.set(serverURL, forKey: HermesBridgeViewController.serverURLKey)
                if token.isEmpty {
                    TokenStore.delete()
                } else {
                    TokenStore.save(token)
                }
                UserDefaults.standard.removeObject(forKey: HermesBridgeViewController.pendingTokenKey)
                showBridge()
                return true
            default:
                break
            }
        }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    // Normalize a pairing-link URL the same way ServerSetupViewController does:
    // add https:// when scheme-less, strip trailing slashes, require http(s) + host.
    private func normalizedServerURL(_ raw: String) -> String? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return nil }
        if !value.contains("://") { value = "https://" + value }
        while value.hasSuffix("/") { value.removeLast() }
        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            return nil
        }
        return value
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
