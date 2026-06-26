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

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.016, green: 0.110, blue: 0.110, alpha: 1) // #041c1c

        let title = UILabel()
        title.text = "Connect your Hermes"
        title.font = .systemFont(ofSize: 24, weight: .bold)
        title.textColor = .white
        title.textAlignment = .center

        let subtitle = UILabel()
        subtitle.text = "Point this app at the Battlestation server running on your own Hermes box."
        subtitle.font = .systemFont(ofSize: 14)
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
        connectButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        connectButton.setTitleColor(UIColor(red: 0.016, green: 0.110, blue: 0.110, alpha: 1), for: .normal)
        connectButton.backgroundColor = UIColor(red: 0.592, green: 0.988, blue: 0.894, alpha: 1) // #97FCE4
        connectButton.layer.cornerRadius = 10
        connectButton.heightAnchor.constraint(equalToConstant: 48).isActive = true
        connectButton.addTarget(self, action: #selector(save), for: .touchUpInside)

        errorLabel.font = .systemFont(ofSize: 13)
        errorLabel.textColor = UIColor(red: 1, green: 0.45, blue: 0.45, alpha: 1)
        errorLabel.textAlignment = .center
        errorLabel.numberOfLines = 0

        let help = UILabel()
        help.text = "Remote URL = the HTTPS/Tailscale Serve URL for your Hermes box. Token = BATTLESTATION_TOKEN from that box. The token is passed once and stored only as that server's cookie."
        help.font = .systemFont(ofSize: 12)
        help.textColor = UIColor(white: 0.58, alpha: 1)
        help.textAlignment = .center
        help.numberOfLines = 0

        let stack = UIStackView(arrangedSubviews: [title, subtitle, urlField, tokenField, connectButton, errorLabel, help])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
        ])
    }

    private func styleInput(_ field: UITextField) {
        field.textColor = .white
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

        let token = (tokenField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !token.isEmpty {
            UserDefaults.standard.set(token, forKey: HermesBridgeViewController.pendingTokenKey)
        } else {
            UserDefaults.standard.removeObject(forKey: HermesBridgeViewController.pendingTokenKey)
        }
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
