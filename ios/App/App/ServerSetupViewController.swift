import UIKit

// First-launch NATIVE onboarding. No website is ever loaded here — the webview
// (HermesBridge) is only shown AFTER pairing completes. Mirrors the web /connect
// layout/brand: Mondwest BATTLESTATION wordmark, a paste-your-pairing-link path
// (fastest), then manual URL + access token. The access token is persisted to the
// Keychain (TokenStore) so the connection is sticky across launches.
class ServerSetupViewController: UIViewController {

    var defaultURL: String = ""
    var onSaved: (() -> Void)?

    private let pairField = UITextField()
    private let urlField = UITextField()
    private let tokenField = UITextField()
    private let connectButton = UIButton(type: .system)
    private let pairButton = UIButton(type: .system)
    private let errorLabel = UILabel()

    private let teal = UIColor(red: 0.016, green: 0.110, blue: 0.110, alpha: 1)   // #041c1c
    private let mint = UIColor(red: 0.592, green: 0.988, blue: 0.894, alpha: 1)   // #97FCE4

    // Nous brand type with graceful fallback to system if the font failed to load.
    private static func nous(_ name: String, _ size: CGFloat, _ weight: UIFont.Weight = .regular) -> UIFont {
        UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: weight)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = teal

        // ── Brand header: BATTLESTATION wordmark (matches web /connect) ──────────
        let brand = UILabel()
        brand.attributedText = NSAttributedString(
            string: "BATTLESTATION",
            attributes: [.kern: 4.0,
                         .font: Self.nous("Mondwest-Regular", 18, .bold),
                         .foregroundColor: mint])
        brand.textAlignment = .center

        let title = UILabel()
        title.text = "Connect to your Hermes"
        title.font = Self.nous("Mondwest-Regular", 28, .bold)
        title.textColor = .white
        title.textAlignment = .center
        title.numberOfLines = 0

        let subtitle = UILabel()
        subtitle.text = "Same profiles and sessions, mirrored across every device."
        subtitle.font = Self.nous("Collapse-Regular", 14)
        subtitle.textColor = UIColor(white: 0.7, alpha: 1)
        subtitle.textAlignment = .center
        subtitle.numberOfLines = 0

        // ── Fastest path: paste pairing link ────────────────────────────────────
        let pairTag = sectionLabel("FASTEST · PASTE YOUR PAIRING LINK", color: mint)
        pairField.placeholder = "https://your-box.ts.net/?token=…"
        pairField.autocapitalizationType = .none
        pairField.autocorrectionType = .no
        pairField.spellCheckingType = .no
        pairField.keyboardType = .URL
        styleInput(pairField)

        pairButton.setTitle("Paste & connect", for: .normal)
        pairButton.titleLabel?.font = Self.nous("Collapse-Bold", 17, .semibold)
        pairButton.setTitleColor(teal, for: .normal)
        pairButton.backgroundColor = mint
        pairButton.layer.cornerRadius = 10
        pairButton.heightAnchor.constraint(equalToConstant: 48).isActive = true
        pairButton.addTarget(self, action: #selector(pasteAndConnect), for: .touchUpInside)

        let pairHelp = UILabel()
        pairHelp.text = "On your box run `npm run pair` and paste the link it prints — carries the URL and token together, no typing."
        pairHelp.font = Self.nous("Collapse-Regular", 12)
        pairHelp.textColor = UIColor(white: 0.55, alpha: 1)
        pairHelp.numberOfLines = 0

        // ── Manual path ─────────────────────────────────────────────────────────
        let manualTag = sectionLabel("OR ENTER MANUALLY", color: UIColor(white: 0.55, alpha: 1))

        let existing = UserDefaults.standard.string(forKey: HermesBridgeViewController.serverURLKey)
        urlField.text = (existing?.isEmpty == false) ? existing : defaultURL
        urlField.placeholder = "https://your-box:9443"
        urlField.autocapitalizationType = .none
        urlField.autocorrectionType = .no
        urlField.keyboardType = .URL
        urlField.textContentType = .URL
        styleInput(urlField)

        tokenField.placeholder = "Access token"
        tokenField.autocapitalizationType = .none
        tokenField.autocorrectionType = .no
        tokenField.textContentType = .password
        tokenField.isSecureTextEntry = true
        styleInput(tokenField)

        connectButton.setTitle("Connect", for: .normal)
        connectButton.titleLabel?.font = Self.nous("Collapse-Bold", 17, .semibold)
        connectButton.setTitleColor(mint, for: .normal)
        connectButton.layer.borderColor = mint.cgColor
        connectButton.layer.borderWidth = 1
        connectButton.layer.cornerRadius = 10
        connectButton.heightAnchor.constraint(equalToConstant: 48).isActive = true
        connectButton.addTarget(self, action: #selector(save), for: .touchUpInside)

        errorLabel.font = Self.nous("Collapse-Regular", 13)
        errorLabel.textColor = UIColor(red: 1, green: 0.45, blue: 0.45, alpha: 1)
        errorLabel.textAlignment = .center
        errorLabel.numberOfLines = 0

        let setupButton = UIButton(type: .system)
        setupButton.setTitle("New to Hermes?  Set up your own agent →", for: .normal)
        setupButton.titleLabel?.font = Self.nous("Collapse-Regular", 14)
        setupButton.setTitleColor(mint, for: .normal)
        setupButton.addTarget(self, action: #selector(openSetupGuide), for: .touchUpInside)

        let spacerA = UIView(); spacerA.heightAnchor.constraint(equalToConstant: 4).isActive = true
        let spacerB = UIView(); spacerB.heightAnchor.constraint(equalToConstant: 4).isActive = true

        let stack = UIStackView(arrangedSubviews: [
            brand, title, subtitle,
            spacerA, pairTag, pairField, pairButton, pairHelp,
            spacerB, manualTag, urlField, tokenField, connectButton,
            errorLabel, setupButton,
        ])
        stack.axis = .vertical
        stack.spacing = 12
        stack.setCustomSpacing(20, after: subtitle)
        stack.setCustomSpacing(18, after: pairHelp)
        stack.translatesAutoresizingMaskIntoConstraints = false

        // Scroll container so the keyboard can't bury the fields.
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .interactive
        scroll.alwaysBounceVertical = true
        view.addSubview(scroll)
        scroll.addSubview(stack)

        let content = scroll.contentLayoutGuide
        let frame = scroll.frameLayoutGuide
        let centerY = stack.centerYAnchor.constraint(equalTo: scroll.centerYAnchor)
        centerY.priority = .defaultLow

        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            stack.topAnchor.constraint(greaterThanOrEqualTo: content.topAnchor, constant: 28),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -28),
            stack.leadingAnchor.constraint(equalTo: frame.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: frame.trailingAnchor, constant: -28),
            stack.centerXAnchor.constraint(equalTo: scroll.centerXAnchor),
            centerY,
        ])

        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardChanged(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardHidden(_:)),
            name: UIResponder.keyboardWillHideNotification, object: nil)
        self.scrollView = scroll
    }

    private weak var scrollView: UIScrollView?

    private func sectionLabel(_ text: String, color: UIColor) -> UILabel {
        let l = UILabel()
        l.attributedText = NSAttributedString(
            string: text,
            attributes: [.kern: 1.2,
                         .font: Self.nous("Collapse-Regular", 11),
                         .foregroundColor: color])
        return l
    }

    @objc private func keyboardChanged(_ note: Notification) {
        guard let scroll = scrollView,
              let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let overlap = max(0, scroll.bounds.maxY - scroll.convert(frame, from: nil).minY)
        scroll.contentInset.bottom = overlap
        scroll.verticalScrollIndicatorInsets.bottom = overlap
    }

    @objc private func keyboardHidden(_ note: Notification) {
        scrollView?.contentInset.bottom = 0
        scrollView?.verticalScrollIndicatorInsets.bottom = 0
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func openSetupGuide() {
        guard let url = URL(string: "https://hermes-agent.nousresearch.com/docs") else { return }
        UIApplication.shared.open(url)
    }

    private func styleInput(_ field: UITextField) {
        field.textColor = .white
        field.font = Self.nous("Collapse-Regular", 16)
        field.backgroundColor = UIColor(white: 1, alpha: 0.08)
        field.layer.cornerRadius = 10
        field.setLeftPaddingPoints(12)
        field.heightAnchor.constraint(equalToConstant: 48).isActive = true
    }

    private func normalizedURL(_ raw: String) -> String? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return nil }
        if !value.contains("://") {
            value = "https://" + value
        }
        while value.hasSuffix("/") {
            value.removeLast()
        }
        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            return nil
        }
        return value
    }

    // Parse a pairing link (`https://box/?token=…`, what `npm run pair` prints /
    // its QR encodes) into a clean URL + token. Mirrors the web parsePairingLink.
    private func parsePairingLink(_ raw: String) -> (url: String, token: String)? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        if let comps = URLComponents(string: s),
           let scheme = comps.scheme?.lowercased(),
           ["http", "https"].contains(scheme),
           let host = comps.host,
           let token = comps.queryItems?.first(where: { $0.name == "token" })?.value,
           !token.isEmpty {
            let port = comps.port.map { ":\($0)" } ?? ""
            return ("\(scheme)://\(host)\(port)", token)
        }
        // Not a URL — a bare scheme-less, space-free string is treated as a token.
        if !s.contains(" "), !s.lowercased().hasPrefix("http") {
            return ("", s)
        }
        return nil
    }

    @objc private func pasteAndConnect() {
        guard let parsed = parsePairingLink(pairField.text ?? "") else {
            errorLabel.text = "That doesn't look like a pairing link — paste the link from `npm run pair`."
            return
        }
        // A bare token with no URL falls back to the manual URL field.
        let base = !parsed.url.isEmpty ? parsed.url : normalizedURL(urlField.text ?? "")
        guard let url = base, !url.isEmpty else {
            errorLabel.text = "Add your box URL above, then paste the token."
            return
        }
        persist(url: url, token: parsed.token)
    }

    @objc private func save() {
        guard let url = normalizedURL(urlField.text ?? "") else {
            errorLabel.text = "Enter your Hermes server URL, e.g. https://your-box.ts.net"
            return
        }
        persist(url: url, token: (tokenField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // Store URL (UserDefaults) + token (Keychain) and boot the bridge. An empty
    // token clears the stored credential; a non-empty one is persisted so the
    // connection self-heals (sticky) across launches.
    private func persist(url: String, token: String) {
        UserDefaults.standard.set(url, forKey: HermesBridgeViewController.serverURLKey)
        if !token.isEmpty {
            TokenStore.save(token)
        } else {
            TokenStore.delete()
        }
        UserDefaults.standard.removeObject(forKey: HermesBridgeViewController.pendingTokenKey)
        onSaved?()
    }
}

private extension UITextField {
    func setLeftPaddingPoints(_ amount: CGFloat) {
        let padding = UIView(frame: CGRect(x: 0, y: 0, width: amount, height: frame.size.height))
        leftView = padding
        leftViewMode = .always
    }
}
