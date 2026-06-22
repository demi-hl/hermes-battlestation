import UIKit

// First-launch screen to capture the user's own Hermes backend URL.
// Shown only when no URL is stored yet (or when reopened to change it).
// On save: writes UserDefaults, then swaps in the Capacitor bridge VC.
class ServerSetupViewController: UIViewController {

    // Pre-fill with the build-time default so DEMI just taps Connect.
    var defaultURL: String = "http://localhost:9119"
    var onSaved: (() -> Void)?

    private let field = UITextField()
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
        subtitle.text = "Enter your backend URL (your tailnet name or LAN IP)."
        subtitle.font = .systemFont(ofSize: 14)
        subtitle.textColor = UIColor(white: 0.7, alpha: 1)
        subtitle.textAlignment = .center
        subtitle.numberOfLines = 0

        let existing = UserDefaults.standard.string(forKey: HermesBridgeViewController.serverURLKey)
        field.text = (existing?.isEmpty == false) ? existing : defaultURL
        field.placeholder = "https://your-box.ts.net"
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.keyboardType = .URL
        field.textColor = .white
        field.backgroundColor = UIColor(white: 1, alpha: 0.08)
        field.layer.cornerRadius = 10
        field.setLeftPaddingPoints(12)
        field.heightAnchor.constraint(equalToConstant: 48).isActive = true

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

        let stack = UIStackView(arrangedSubviews: [title, subtitle, field, connectButton, errorLabel])
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

    @objc private func save() {
        let raw = (field.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: raw), let scheme = url.scheme,
              ["http", "https"].contains(scheme.lowercased()), url.host != nil else {
            errorLabel.text = "Enter a full URL including http:// or https://"
            return
        }
        UserDefaults.standard.set(raw, forKey: HermesBridgeViewController.serverURLKey)
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
