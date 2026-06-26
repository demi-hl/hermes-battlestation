import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private let pairingPlaceholderURL = "https://connect.localhost.invalid"
    // Pre-filled on the setup screen so testers can just tap Connect instead of
    // typing/pasting. Public Funnel URL — reachable off the tailnet.
    private let defaultPublicURL = "https://battlestation.demi.la"

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
        // The error page's "Change URL / Retry" button navigates to battlestation://setup
        // to bounce the user back to the pairing screen when a remote load failed.
        if url.scheme?.lowercased() == "battlestation", url.host?.lowercased() == "setup" {
            let current = UserDefaults.standard.string(forKey: HermesBridgeViewController.serverURLKey) ?? ""
            showServerSetup(defaultURL: current)
            return true
        }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
