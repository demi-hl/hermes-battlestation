import UIKit

// First-launch screen to capture the user's own Hermes backend URL.
// Shown for public/TestFlight builds when no backend URL is stored and no
// CAP_SERVER_URL was baked into capacitor.config.json. The access token is
// optional and sent once as ?token=...; it is never persisted by the native app.
class ServerSetupViewController: UIViewController {

    var defaultURL: String = ""
    var onSaved: (() -> Void)?

    private let urlField = UITextField()
    private let tokenField = UITextField()
    private let connectButton = UIButton(type: .system)
    private let errorLabel = UILabel()

    // Nous brand type with graceful fallback to system if the font failed to load.
    private static func nous(_ name: String, _ size: CGFloat, _ weight: UIFont.Weight = .regular) -> UIFont {
        UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: weight)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.016, green: 0.110, blue: 0.110, alpha: 1) // #041c1c

        let title = UILabel()
        title.text = "Connect your Hermes"
        title.font = Self.nous("Mondwest-Regular", 30, .bold)
        title.textColor = UIColor(red: 0.592, green: 0.988, blue: 0.894, alpha: 1) // #97FCE4
        title.textAlignment = .center

        let subtitle = UILabel()
        subtitle.text = "Point this app at the Battlestation server running on your own Hermes box."
        subtitle.font = Self.nous("Collapse-Regular", 15)
        subtitle.textColor = UIColor(white: 0.7, alpha: 1)
        subtitle.textAlignment = .center
        subtitle.numberOfLines = 0

        let existing = UserDefaults.standard.string(forKey: HermesBridgeViewController.serverURLKey)
        urlField.text = (existing?.isEmpty == false) ? existing : defaultURL
        urlField.placeholder = "https://your-box.ts.net"
        urlField.autocapitalizationType = .none
        urlField.autocorrectionType = .no
        urlField.keyboardType = .URL
        urlField.textContentType = .URL
        styleInput(urlField)

        tokenField.placeholder = "Access token (optional)"
        tokenField.autocapitalizationType = .none
        tokenField.autocorrectionType = .no
        tokenField.textContentType = .password
        tokenField.isSecureTextEntry = true
        styleInput(tokenField)

        connectButton.setTitle("Connect", for: .normal)
        connectButton.titleLabel?.font = Self.nous("Collapse-Bold", 18, .semibold)
        connectButton.setTitleColor(UIColor(red: 0.016, green: 0.110, blue: 0.110, alpha: 1), for: .normal)
        connectButton.backgroundColor = UIColor(red: 0.592, green: 0.988, blue: 0.894, alpha: 1) // #97FCE4
        connectButton.layer.cornerRadius = 10
        connectButton.heightAnchor.constraint(equalToConstant: 48).isActive = true
        connectButton.addTarget(self, action: #selector(save), for: .touchUpInside)

        errorLabel.font = Self.nous("Collapse-Regular", 13)
        errorLabel.textColor = UIColor(red: 1, green: 0.45, blue: 0.45, alpha: 1)
        errorLabel.textAlignment = .center
        errorLabel.numberOfLines = 0

        let help = UILabel()
        help.text = "Remote URL = the HTTPS/Tailscale Serve URL for your Hermes box. Token = BATTLESTATION_TOKEN from that box. The token is passed once and stored only as that server's cookie."
        help.font = Self.nous("Collapse-Regular", 12)
        help.textColor = UIColor(white: 0.58, alpha: 1)
        help.textAlignment = .center
        help.numberOfLines = 0

        // Escape hatch for people who don't have a box/agent yet: open the
        // public install + setup guide so they can stand up a fresh Hermes
        // agent, then come back and connect. Without this the BYO first-launch
        // screen is a dead end (it only asks for a URL+token they don't have).
        let setupButton = UIButton(type: .system)
        setupButton.setTitle("New to Hermes?  Set up your own agent →", for: .normal)
        setupButton.titleLabel?.font = Self.nous("Collapse-Regular", 14)
        setupButton.setTitleColor(UIColor(red: 0.592, green: 0.988, blue: 0.894, alpha: 1), for: .normal)
        setupButton.addTarget(self, action: #selector(openSetupGuide), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, subtitle, urlField, tokenField, connectButton, errorLabel, help, setupButton])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false

        // Scroll container so the keyboard can't bury the fields (mirrors the
        // web /connect keyboard-safe behavior). Stack is centered when it fits,
        // scrollable when the keyboard shrinks the visible area.
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

            stack.topAnchor.constraint(greaterThanOrEqualTo: content.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -24),
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
        // Public install + setup guide. Walks a newcomer through installing the
        // Hermes Agent CLI, creating a Nous account, and standing up a
        // Battlestation server (which mints the token + prints a pairing link).
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

    @objc private func save() {
        guard let url = normalizedURL(urlField.text ?? "") else {
            errorLabel.text = "Enter your Hermes server URL, e.g. https://your-box.ts.net"
            return
        }
        UserDefaults.standard.set(url, forKey: HermesBridgeViewController.serverURLKey)

        // Persist the token in the Keychain so it self-heals across launches /
        // cookie loss (TokenStore). Empty token clears any stored credential.
        let token = (tokenField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !token.isEmpty {
            TokenStore.save(token)
        } else {
            TokenStore.delete()
        }
        // Clear the legacy one-shot key so it can't shadow the Keychain token.
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
