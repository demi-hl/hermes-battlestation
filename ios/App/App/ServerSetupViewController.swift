import UIKit

// Native 3-step onboarding wizard. Faithful UIKit port of the web /start flow
// (Choose → Guide → Next). Theme matches web: peach (#ffe6cb) on dark teal
// (#041c1c), NO mint. Critical constraint: NOTHING leaves the app — every
// external link the web shows (docs/GitHub/signup) becomes a copy-to-clipboard
// row, and every setup command is a Copy button. The live connect (paste link /
// URL / token) is embedded in the "I already have a server" branch so pairing
// completes in-app and boots straight to the bridge.
//
// Public surface kept identical to the old screen so AppDelegate is untouched:
//   var defaultURL, var onSaved.
class ServerSetupViewController: UIViewController {

    var defaultURL: String = ""
    var onSaved: (() -> Void)?

    // ── Palette (web /start: peach accent on dark teal, no mint) ─────────────
    private let bg     = UIColor(red: 0.016, green: 0.110, blue: 0.110, alpha: 1) // #041c1c
    private let peach  = UIColor(red: 1.0,   green: 0.902, blue: 0.796, alpha: 1) // #ffe6cb
    private func peachA(_ a: CGFloat) -> UIColor { peach.withAlphaComponent(a) }
    private var textPrimary: UIColor   { peach }
    private var textSecondary: UIColor { peachA(0.80) }
    private var textTertiary: UIColor  { peachA(0.62) }
    private var border: UIColor        { peachA(0.22) }
    private var cardFill: UIColor      { UIColor(red: 0.016, green: 0.110, blue: 0.110, alpha: 0.64) }

    private enum Choice { case haveServer, haveBox, newToHermes }
    private var choice: Choice?
    private var step = 1   // 1 Choose · 2 Guide · 3 Next

    // Connect fields (live in the have-server branch)
    private let pairField  = UITextField()
    private let urlField   = UITextField()
    private let tokenField = UITextField()
    private let errorLabel = UILabel()

    // Chrome
    private let scroll       = UIScrollView()
    private let progressLeft = UILabel()
    private let progressRight = UILabel()
    private var bars: [UIView] = []
    private let cardBody     = UIStackView()   // rebuilt per step/choice
    private let backButton   = UIButton(type: .system)
    private let nextButton   = UIButton(type: .system)

    private static func nous(_ name: String, _ size: CGFloat, _ weight: UIFont.Weight = .regular) -> UIFont {
        UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: weight)
    }
    private func mondwest(_ s: CGFloat) -> UIFont { Self.nous("Mondwest-Regular", s, .bold) }
    private func body(_ s: CGFloat) -> UIFont { .monospacedSystemFont(ofSize: s, weight: .regular) }
    private func bodyBold(_ s: CGFloat) -> UIFont { .monospacedSystemFont(ofSize: s, weight: .semibold) }
    private func serif(_ s: CGFloat) -> UIFont { Self.nous("Mondwest-Regular", s, .bold) }

    // MARK: - Lifecycle
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bg
        buildChrome()
        render()
        observeKeyboard()
    }

    // MARK: - Static chrome (wordmark, progress, card shell, controls)
    private let outer = UIStackView()

    private func buildChrome() {
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .interactive
        // Onboarding sits as a fixed screen when its content fits (no idle
        // rubber-band), but must still scroll when content genuinely overflows
        // (connect step with the keyboard up, or shorter devices) so nothing is
        // ever unreachable.
        scroll.alwaysBounceVertical = false
        scroll.bounces = true
        scroll.showsVerticalScrollIndicator = false
        // Apply top+bottom safe-area insets so the wordmark clears the notch and
        // the footer never tucks under the home indicator on any device.
        scroll.contentInsetAdjustmentBehavior = .always
        view.addSubview(scroll)

        // Nous logo + BATTLESTATION wordmark (matches web /start header)
        let brandLabel = UILabel()
        brandLabel.attributedText = NSAttributedString(
            string: "BATTLESTATION",
            attributes: [.kern: 3.6, .font: mondwest(17), .foregroundColor: textPrimary])
        let brand: UIView
        if let logo = UIImage(named: "NousLogo") {
            let iv = UIImageView(image: logo)
            iv.contentMode = .scaleAspectFit
            iv.heightAnchor.constraint(equalToConstant: 22).isActive = true
            iv.widthAnchor.constraint(equalToConstant: 22 * logo.size.width / max(logo.size.height, 1)).isActive = true
            let row = UIStackView(arrangedSubviews: [iv, brandLabel])
            row.axis = .horizontal; row.spacing = 9; row.alignment = .center
            let centerWrap = UIStackView(arrangedSubviews: [UIView(), row, UIView()])
            centerWrap.axis = .horizontal; centerWrap.distribution = .equalCentering
            brand = centerWrap
        } else {
            brandLabel.textAlignment = .center
            brand = brandLabel
        }

        // Progress card
        let prog = UIStackView()
        prog.axis = .vertical
        prog.spacing = 8
        prog.isLayoutMarginsRelativeArrangement = true
        prog.directionalLayoutMargins = .init(top: 12, leading: 14, bottom: 12, trailing: 14)
        prog.backgroundColor = cardFill
        prog.layer.cornerRadius = 16
        prog.layer.borderWidth = 1
        prog.layer.borderColor = border.cgColor

        let progTop = UIStackView()
        progTop.axis = .horizontal
        progTop.distribution = .equalSpacing
        progressLeft.font = body(11);  progressLeft.textColor = textTertiary
        progressRight.font = body(11); progressRight.textColor = textTertiary
        progressRight.textAlignment = .right
        progTop.addArrangedSubview(progressLeft)
        progTop.addArrangedSubview(progressRight)

        let barRow = UIStackView()
        barRow.axis = .horizontal
        barRow.distribution = .fillEqually
        barRow.spacing = 8
        bars = (0..<3).map { _ in
            let b = UIView()
            b.heightAnchor.constraint(equalToConstant: 6).isActive = true
            b.layer.cornerRadius = 3
            return b
        }
        bars.forEach { barRow.addArrangedSubview($0) }
        prog.addArrangedSubview(progTop)
        prog.addArrangedSubview(barRow)

        // Card (welcome + body)
        let welcomeTitle = UILabel()
        welcomeTitle.text = "Welcome to Hermes Battlestation"
        welcomeTitle.font = mondwest(20)
        welcomeTitle.textColor = textPrimary
        welcomeTitle.numberOfLines = 0

        let welcomeBlurb = UILabel()
        welcomeBlurb.text = "A cockpit for your own Hermes agent. The app is a thin client. It loads from a Battlestation server on a box you control. Pick where you are and we'll take it from there."
        welcomeBlurb.font = body(12)
        welcomeBlurb.textColor = textTertiary
        welcomeBlurb.numberOfLines = 0

        cardBody.axis = .vertical
        cardBody.spacing = 12

        let card = UIStackView(arrangedSubviews: [welcomeTitle, welcomeBlurb, cardBody])
        card.axis = .vertical
        card.spacing = 12
        card.isLayoutMarginsRelativeArrangement = true
        card.directionalLayoutMargins = .init(top: 18, leading: 16, bottom: 18, trailing: 16)
        card.backgroundColor = cardFill
        card.layer.cornerRadius = 24
        card.layer.borderWidth = 1
        card.layer.borderColor = border.cgColor
        card.setCustomSpacing(18, after: welcomeBlurb)

        // Controls
        styleGhost(backButton)
        styleFilled(nextButton, title: "Continue ›")
        backButton.addTarget(self, action: #selector(tapBack), for: .touchUpInside)
        nextButton.addTarget(self, action: #selector(tapNext), for: .touchUpInside)
        let controls = UIStackView(arrangedSubviews: [backButton, UIView(), nextButton])
        controls.axis = .horizontal
        controls.alignment = .center

        // Footer reassurance
        let footer = UILabel()
        footer.text = "The access token always lives on the server. The box mints it, this app only consumes it. Nothing personal is baked into the public build."
        footer.font = body(11)
        footer.textColor = textTertiary
        footer.textAlignment = .center
        footer.numberOfLines = 0

        outer.axis = .vertical
        outer.spacing = 16
        outer.translatesAutoresizingMaskIntoConstraints = false
        outer.addArrangedSubview(brand)
        outer.addArrangedSubview(prog)
        outer.addArrangedSubview(card)
        outer.addArrangedSubview(controls)
        outer.addArrangedSubview(footer)
        outer.setCustomSpacing(22, after: brand)
        scroll.addSubview(outer)

        let c = scroll.contentLayoutGuide
        let f = scroll.frameLayoutGuide
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            outer.topAnchor.constraint(equalTo: c.topAnchor, constant: 28),
            outer.bottomAnchor.constraint(equalTo: c.bottomAnchor, constant: -28),
            outer.leadingAnchor.constraint(equalTo: f.leadingAnchor, constant: 22),
            outer.trailingAnchor.constraint(equalTo: f.trailingAnchor, constant: -22),
        ])
    }

    // MARK: - Render current step
    private func render() {
        progressLeft.text = "STEP \(step) OF 3"
        progressRight.text = ["CHOOSE", "GUIDE", "NEXT"][step - 1]
        for (i, b) in bars.enumerated() { b.backgroundColor = (i + 1 <= step) ? peach : border }

        backButton.isHidden = (step == 1)
        backButton.setTitle(step == 3 ? "Choose another path" : "‹ Back", for: .normal)
        nextButton.isHidden = (step == 3)
        nextButton.isEnabled = !(step == 1 && choice == nil)
        nextButton.alpha = nextButton.isEnabled ? 1 : 0.4

        cardBody.arrangedSubviews.forEach { $0.removeFromSuperview() }
        errorLabel.text = nil

        switch step {
        case 1: renderChoose()
        case 2: renderGuide()
        default: renderNext()
        }
        scroll.setContentOffset(.zero, animated: false)
    }

    // Step 1 — Choose
    private func renderChoose() {
        let q = UILabel()
        q.text = "Do you already have a Hermes agent / Battlestation box?"
        q.font = bodyBold(15)
        q.textColor = textPrimary
        q.numberOfLines = 0
        cardBody.addArrangedSubview(q)

        let items: [(Choice, String, String)] = [
            (.haveServer, "I already have a Battlestation server", "Connect this app to a box that's already running Battlestation."),
            (.haveBox,    "I have a box, but no Battlestation yet", "Stand up the server on a machine you control, then pair this app."),
            (.newToHermes,"I'm new to Hermes", "Install the Hermes Agent CLI and create your Nous account first."),
        ]
        for (id, title, blurb) in items {
            cardBody.addArrangedSubview(choiceCard(id: id, title: title, blurb: blurb))
        }
    }

    // Step 2 — Guide (branch)
    private func renderGuide() {
        guard let choice else { return }
        let header = branchHeader(for: choice)
        cardBody.addArrangedSubview(header)
        switch choice {
        case .haveServer: buildHaveServer()
        case .haveBox:    buildHaveBox()
        case .newToHermes:buildNewToHermes()
        }
    }

    // Step 3 — Next (recap)
    private func renderNext() {
        let h = UILabel()
        h.font = bodyBold(15); h.textColor = textPrimary; h.numberOfLines = 0
        let p = UILabel()
        p.font = body(12); p.textColor = textSecondary; p.numberOfLines = 0
        switch choice {
        case .haveServer:
            h.text = "You're ready to connect"
            p.text = "If the form accepted your token, Battlestation loads the dashboard. Need to retry? Go back and paste the URL + token from the box."
        case .haveBox:
            h.text = "Here's your next step"
            p.text = "Finish the box setup, run `cd hermes-battlestation && npm run pair` or `cd hermes-battlestation && npm run token`, then go back to “I already have a server” and connect with the URL + token the box prints."
            cardBody.addArrangedSubview(h); cardBody.addArrangedSubview(p)
            cardBody.addArrangedSubview(copyRow("cd hermes-battlestation && npm run pair"))
            cardBody.addArrangedSubview(copyRow("cd hermes-battlestation && npm run token"))
            return
        default:
            h.text = "Here's your next step"
            p.text = "Install the Hermes Agent CLI, create your Nous account, and run setup. Then come back and choose the box-setup path."
            cardBody.addArrangedSubview(h); cardBody.addArrangedSubview(p)
            cardBody.addArrangedSubview(copyRow("https://hermes-agent.nousresearch.com/docs", caption: "DOCUMENTATION"))
            cardBody.addArrangedSubview(copyRow("https://github.com/NousResearch/hermes-agent", caption: "GITHUB"))
            return
        }
        cardBody.addArrangedSubview(h)
        cardBody.addArrangedSubview(p)
    }

    // MARK: - Branch bodies
    private func buildHaveServer() {
        let blurb = UILabel()
        blurb.text = "Great, head to Connect and enter your box's URL (its Tailscale Serve / HTTPS address) and access token. Already signed in elsewhere? Use Sign in with Nous there instead."
        blurb.font = body(12); blurb.textColor = textSecondary; blurb.numberOfLines = 0
        cardBody.addArrangedSubview(blurb)

        let scanBtn = UIButton(type: .system)
        styleFilled(scanBtn, title: "⧉  Scan QR")
        scanBtn.heightAnchor.constraint(equalToConstant: 48).isActive = true
        scanBtn.addTarget(self, action: #selector(openScanner), for: .touchUpInside)
        cardBody.addArrangedSubview(scanBtn)
        let scanHelp = UILabel()
        scanHelp.text = "Opens the camera in-app. Point at the QR from `cd hermes-battlestation && npm run pair`. Connects instantly, nothing to type."
        scanHelp.font = body(11); scanHelp.textColor = textTertiary; scanHelp.numberOfLines = 0
        cardBody.addArrangedSubview(scanHelp)

        let connectTitle = UILabel()
        connectTitle.text = "Connect to your Hermes"
        connectTitle.font = serif(20)
        connectTitle.textColor = textPrimary
        connectTitle.numberOfLines = 0
        cardBody.addArrangedSubview(connectTitle)
        let connectBlurb = UILabel()
        connectBlurb.text = "Sign in with your Nous account, or use the box's access token. Same profiles and sessions, mirrored across every device."
        connectBlurb.font = body(12); connectBlurb.textColor = textTertiary; connectBlurb.numberOfLines = 0
        cardBody.addArrangedSubview(connectBlurb)

        cardBody.addArrangedSubview(sectionTag("FASTEST · PASTE YOUR PAIRING LINK"))
        pairField.placeholder = "https://your-box.ts.net/?token=…"
        configURLField(pairField); styleInput(pairField)
        cardBody.addArrangedSubview(pairField)
        let pasteBtn = UIButton(type: .system)
        styleFilled(pasteBtn, title: "Paste & connect")
        pasteBtn.heightAnchor.constraint(equalToConstant: 48).isActive = true
        pasteBtn.addTarget(self, action: #selector(pasteAndConnect), for: .touchUpInside)
        cardBody.addArrangedSubview(pasteBtn)
        let pairHelp = UILabel()
        pairHelp.text = "On your box run `cd hermes-battlestation && npm run pair` and paste the link it prints. Carries the URL and token together, no typing."
        pairHelp.font = body(11); pairHelp.textColor = textTertiary; pairHelp.numberOfLines = 0
        cardBody.addArrangedSubview(pairHelp)

        cardBody.addArrangedSubview(sectionTag("OR ENTER MANUALLY"))
        let existing = UserDefaults.standard.string(forKey: HermesBridgeViewController.serverURLKey)
        urlField.text = (existing?.isEmpty == false) ? existing : defaultURL
        urlField.placeholder = "https://your-box:9443"
        configURLField(urlField); styleInput(urlField)
        cardBody.addArrangedSubview(urlField)
        tokenField.placeholder = "Access token"
        tokenField.autocapitalizationType = .none
        tokenField.autocorrectionType = .no
        tokenField.textContentType = .password
        tokenField.isSecureTextEntry = true
        styleInput(tokenField)
        cardBody.addArrangedSubview(tokenField)
        let connectBtn = UIButton(type: .system)
        styleGhostFilled(connectBtn, title: "Connect")
        connectBtn.heightAnchor.constraint(equalToConstant: 48).isActive = true
        connectBtn.addTarget(self, action: #selector(save), for: .touchUpInside)
        cardBody.addArrangedSubview(connectBtn)

        errorLabel.font = body(13)
        errorLabel.textColor = UIColor(red: 1, green: 0.45, blue: 0.45, alpha: 1)
        errorLabel.numberOfLines = 0
        cardBody.addArrangedSubview(errorLabel)
    }

    private func buildHaveBox() {
        cardBody.addArrangedSubview(para("Run these on the box you want Battlestation to live on (a VPS, home server, Raspberry Pi, anything with Node 18+ and Tailscale)."))
        cardBody.addArrangedSubview(stepLabel(1, "Clone the repo"))
        cardBody.addArrangedSubview(copyRow("git clone https://github.com/demi-hl/hermes-battlestation && cd hermes-battlestation"))
        cardBody.addArrangedSubview(stepLabel(2, "Install & bring it up"))
        cardBody.addArrangedSubview(copyRow("npm install"))
        cardBody.addArrangedSubview(copyRow("npm run serve:vps"))
        cardBody.addArrangedSubview(para("serve:vps builds the server, mints a BATTLESTATION_TOKEN, installs a reboot-proof systemd --user service, and fronts it with Tailscale Serve.", tertiary: true))
        cardBody.addArrangedSubview(stepLabel(3, "Pair this app"))
        cardBody.addArrangedSubview(para("serve:vps prints a QR + link at the end. To reprint it, or grab the raw token to paste into Connect:", tertiary: true))
        cardBody.addArrangedSubview(copyRow("cd hermes-battlestation && npm run pair"))
        cardBody.addArrangedSubview(copyRow("cd hermes-battlestation && npm run token"))
    }

    private func buildNewToHermes() {
        cardBody.addArrangedSubview(para("Battlestation drives the Hermes Agent. Install the CLI and create a Nous account first, then come back and stand up a server (the middle option)."))
        cardBody.addArrangedSubview(stepLabel(1, "Install the Hermes Agent CLI"))
        cardBody.addArrangedSubview(copyRow("curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"))
        cardBody.addArrangedSubview(stepLabel(2, "Create your Nous account"))
        cardBody.addArrangedSubview(copyRow("https://portal.nousresearch.com", caption: "SIGN UP AT NOUS RESEARCH"))
        cardBody.addArrangedSubview(stepLabel(3, "Run setup"))
        cardBody.addArrangedSubview(copyRow("hermes setup"))
    }

    // MARK: - Reusable native components
    // 40pt bordered tile holding the choice's vector glyph (server/box/spark),
    // matching the web /start choice cards.
    private func iconBadge(for c: Choice) -> UIView {
        let kind: WizardIconView.Kind = c == .haveServer ? .server : (c == .haveBox ? .box : .spark)
        let icon = WizardIconView(kind: kind, stroke: peach)
        let box = UIView()
        box.translatesAutoresizingMaskIntoConstraints = false
        box.layer.cornerRadius = 12
        box.layer.borderWidth = 1
        box.layer.borderColor = border.cgColor
        box.addSubview(icon)
        NSLayoutConstraint.activate([
            box.widthAnchor.constraint(equalToConstant: 40),
            box.heightAnchor.constraint(equalToConstant: 40),
            icon.centerXAnchor.constraint(equalTo: box.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: box.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 22),
            icon.heightAnchor.constraint(equalToConstant: 22),
        ])
        return box
    }

    private func choiceCard(id: Choice, title: String, blurb: String) -> UIView {
        let b = UIButton(type: .custom)
        let selected = (choice == id)
        b.backgroundColor = selected ? peachA(0.12) : cardFill
        b.layer.cornerRadius = 16
        b.layer.borderWidth = 1
        b.layer.borderColor = (selected ? peach : border).cgColor
        let t = UILabel(); t.text = title; t.font = serif(17); t.textColor = textPrimary; t.numberOfLines = 0
        let s = UILabel(); s.text = blurb; s.font = body(11); s.textColor = textTertiary; s.numberOfLines = 0
        let textStack = UIStackView(arrangedSubviews: [t, s])
        textStack.axis = .vertical; textStack.spacing = 4
        let row = UIStackView(arrangedSubviews: [iconBadge(for: id), textStack])
        row.axis = .horizontal; row.spacing = 12; row.alignment = .center
        row.isLayoutMarginsRelativeArrangement = true
        row.directionalLayoutMargins = .init(top: 14, leading: 14, bottom: 14, trailing: 16)
        row.isUserInteractionEnabled = false
        row.translatesAutoresizingMaskIntoConstraints = false
        b.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: b.topAnchor),
            row.bottomAnchor.constraint(equalTo: b.bottomAnchor),
            row.leadingAnchor.constraint(equalTo: b.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: b.trailingAnchor),
        ])
        b.tag = id == .haveServer ? 0 : (id == .haveBox ? 1 : 2)
        b.addTarget(self, action: #selector(selectChoice(_:)), for: .touchUpInside)
        return b
    }

    private func branchHeader(for c: Choice) -> UIView {
        let title: String, blurb: String
        switch c {
        case .haveServer: title = "I already have a Battlestation server"; blurb = "Connect this app to a box that's already running Battlestation."
        case .haveBox:    title = "I have a box, but no Battlestation yet"; blurb = "Stand up the server on a machine you control, then pair this app."
        case .newToHermes:title = "I'm new to Hermes"; blurb = "Install the Hermes Agent CLI and create your Nous account first."
        }
        let t = UILabel(); t.text = title; t.font = serif(17); t.textColor = textPrimary; t.numberOfLines = 0
        let s = UILabel(); s.text = blurb; s.font = body(11); s.textColor = textTertiary; s.numberOfLines = 0
        let v = UIStackView(arrangedSubviews: [t, s])
        v.axis = .vertical; v.spacing = 3
        let head = UIStackView(arrangedSubviews: [iconBadge(for: c), v])
        head.axis = .horizontal; head.spacing = 12; head.alignment = .center
        let sep = UIView(); sep.backgroundColor = border
        sep.heightAnchor.constraint(equalToConstant: 1).isActive = true
        let wrap = UIStackView(arrangedSubviews: [head, sep])
        wrap.axis = .vertical; wrap.spacing = 14
        return wrap
    }

    private func sectionTag(_ text: String) -> UILabel {
        let l = UILabel()
        l.attributedText = NSAttributedString(string: text, attributes: [.kern: 1.1, .font: body(11), .foregroundColor: peach])
        return l
    }

    private func stepLabel(_ n: Int, _ text: String) -> UIView {
        let badge = UILabel()
        badge.text = "\(n)"; badge.font = body(11); badge.textColor = textSecondary
        badge.textAlignment = .center
        badge.layer.borderWidth = 1; badge.layer.borderColor = border.cgColor
        badge.layer.cornerRadius = 10
        badge.widthAnchor.constraint(equalToConstant: 20).isActive = true
        badge.heightAnchor.constraint(equalToConstant: 20).isActive = true
        let l = UILabel(); l.text = text; l.font = bodyBold(13); l.textColor = textPrimary; l.numberOfLines = 0
        let row = UIStackView(arrangedSubviews: [badge, l])
        row.axis = .horizontal; row.spacing = 8; row.alignment = .center
        return row
    }

    private func para(_ text: String, tertiary: Bool = false) -> UILabel {
        let l = UILabel()
        l.text = text; l.font = body(12)
        l.textColor = tertiary ? textTertiary : textSecondary
        l.numberOfLines = 0
        return l
    }

    // A monospace command/URL with a Copy button — replaces every external link
    // so nothing ever opens Safari.
    private func copyRow(_ value: String, caption: String? = nil) -> UIView {
        let mono = UILabel()
        mono.text = value
        mono.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        mono.textColor = textPrimary
        mono.numberOfLines = 0
        mono.lineBreakMode = .byCharWrapping

        let copy = UIButton(type: .system)
        copy.setTitle("Copy", for: .normal)
        copy.titleLabel?.font = bodyBold(12)
        copy.setTitleColor(bg, for: .normal)
        copy.backgroundColor = peach
        copy.layer.cornerRadius = 8
        copy.contentEdgeInsets = .init(top: 6, left: 12, bottom: 6, right: 12)
        copy.setContentHuggingPriority(.required, for: .horizontal)
        objc_setAssociatedObject(copy, &Self.copyKey, value, .OBJC_ASSOCIATION_RETAIN)
        copy.addTarget(self, action: #selector(copyValue(_:)), for: .touchUpInside)

        let row = UIStackView(arrangedSubviews: [mono, copy])
        row.axis = .horizontal; row.spacing = 10; row.alignment = .center
        row.isLayoutMarginsRelativeArrangement = true
        row.directionalLayoutMargins = .init(top: 10, leading: 12, bottom: 10, trailing: 8)
        row.backgroundColor = peachA(0.05)
        row.layer.cornerRadius = 10
        row.layer.borderWidth = 1
        row.layer.borderColor = border.cgColor

        guard let caption else { return row }
        let tag = UILabel()
        tag.attributedText = NSAttributedString(string: caption, attributes: [.kern: 1.0, .font: body(10), .foregroundColor: textTertiary])
        let wrap = UIStackView(arrangedSubviews: [tag, row])
        wrap.axis = .vertical; wrap.spacing = 5
        return wrap
    }
    private static var copyKey: UInt8 = 0

    // MARK: - Button styling
    private func styleFilled(_ b: UIButton, title: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = serif(16)
        b.setTitleColor(bg, for: .normal)
        b.backgroundColor = peach
        b.layer.cornerRadius = 22
        b.contentEdgeInsets = .init(top: 11, left: 18, bottom: 11, right: 18)
    }
    private func styleGhostFilled(_ b: UIButton, title: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = serif(16)
        b.setTitleColor(peach, for: .normal)
        b.layer.cornerRadius = 10
        b.layer.borderWidth = 1
        b.layer.borderColor = peach.cgColor
    }
    private func styleGhost(_ b: UIButton) {
        b.titleLabel?.font = body(13)
        b.setTitleColor(textSecondary, for: .normal)
        b.layer.cornerRadius = 18
        b.layer.borderWidth = 1
        b.layer.borderColor = border.cgColor
        b.contentEdgeInsets = .init(top: 8, left: 16, bottom: 8, right: 16)
    }
    private func configURLField(_ f: UITextField) {
        f.autocapitalizationType = .none
        f.autocorrectionType = .no
        f.spellCheckingType = .no
        f.keyboardType = .URL
    }
    private func styleInput(_ field: UITextField) {
        field.textColor = .white
        field.font = body(16)
        field.backgroundColor = UIColor(white: 1, alpha: 0.08)
        field.layer.cornerRadius = 10
        field.setLeftPaddingPoints(12)
        field.heightAnchor.constraint(equalToConstant: 48).isActive = true
    }

    // MARK: - Actions
    @objc private func selectChoice(_ sender: UIButton) {
        choice = [Choice.haveServer, .haveBox, .newToHermes][sender.tag]
        render()
    }
    @objc private func tapBack() {
        if step == 3, choice != nil, choice != .haveServer { /* keep choice */ }
        if step == 3 { choice = nil; step = 1 } else if step == 2 { step = 1 } 
        render()
    }
    @objc private func tapNext() {
        if step == 1, choice != nil { step = 2 } else if step == 2 { step = 3 }
        render()
    }
    @objc private func copyValue(_ sender: UIButton) {
        if let v = objc_getAssociatedObject(sender, &Self.copyKey) as? String {
            UIPasteboard.general.string = v
        }
        let old = sender.title(for: .normal)
        sender.setTitle("Copied", for: .normal)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { sender.setTitle(old, for: .normal) }
    }

    // MARK: - Connect logic
    private func normalizedURL(_ raw: String) -> String? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return nil }
        if !value.contains("://") { value = "https://" + value }
        while value.hasSuffix("/") { value.removeLast() }
        guard let url = URL(string: value), let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme), url.host != nil else { return nil }
        return value
    }
    private func parsePairingLink(_ raw: String) -> (url: String, token: String)? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        // battlestation://connect?url=<base>&token=<token> — what the QR encodes.
        if let comps = URLComponents(string: s), comps.scheme?.lowercased() == "battlestation",
           comps.host?.lowercased() == "connect" {
            let rawURL = comps.queryItems?.first(where: { $0.name == "url" })?.value ?? ""
            let token = (comps.queryItems?.first(where: { $0.name == "token" })?.value ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if let base = normalizedURL(rawURL) { return (base, token) }
        }
        if let comps = URLComponents(string: s), let scheme = comps.scheme?.lowercased(),
           ["http", "https"].contains(scheme), let host = comps.host,
           let token = comps.queryItems?.first(where: { $0.name == "token" })?.value, !token.isEmpty {
            let port = comps.port.map { ":\($0)" } ?? ""
            return ("\(scheme)://\(host)\(port)", token)
        }
        if !s.contains(" "), !s.lowercased().hasPrefix("http") { return ("", s) }
        return nil
    }
    @objc private func openScanner() {
        let scanner = QRScannerViewController()
        scanner.modalPresentationStyle = .fullScreen
        scanner.onScan = { [weak self] code in self?.handleScanned(code) }
        present(scanner, animated: true)
    }

    private func handleScanned(_ code: String) {
        guard let parsed = parsePairingLink(code), !parsed.url.isEmpty else {
            errorLabel.text = "That QR isn't a Battlestation pairing code."
            return
        }
        persist(url: parsed.url, token: parsed.token)
    }

    @objc private func pasteAndConnect() {
        guard let parsed = parsePairingLink(pairField.text ?? "") else {
            errorLabel.text = "That doesn't look like a pairing link. Paste the link from `cd hermes-battlestation && npm run pair`."
            return
        }
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
    private func persist(url: String, token: String) {
        UserDefaults.standard.set(url, forKey: HermesBridgeViewController.serverURLKey)
        if !token.isEmpty { TokenStore.save(token) } else { TokenStore.delete() }
        UserDefaults.standard.removeObject(forKey: HermesBridgeViewController.pendingTokenKey)
        onSaved?()
    }

    // MARK: - Keyboard
    private func observeKeyboard() {
        NotificationCenter.default.addObserver(self, selector: #selector(kbChange(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(kbHide(_:)),
            name: UIResponder.keyboardWillHideNotification, object: nil)
    }
    @objc private func kbChange(_ note: Notification) {
        guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let overlap = max(0, scroll.bounds.maxY - scroll.convert(frame, from: nil).minY)
        scroll.contentInset.bottom = overlap
        scroll.verticalScrollIndicatorInsets.bottom = overlap
    }
    @objc private func kbHide(_ note: Notification) {
        scroll.contentInset.bottom = 0
        scroll.verticalScrollIndicatorInsets.bottom = 0
    }
    deinit { NotificationCenter.default.removeObserver(self) }
}

private extension UITextField {
    func setLeftPaddingPoints(_ amount: CGFloat) {
        let padding = UIView(frame: CGRect(x: 0, y: 0, width: amount, height: frame.size.height))
        leftView = padding; leftViewMode = .always
    }
}


// Native vector port of the web /start choice glyphs (ServerIcon/BoxIcon/
// SparkIcon). Strokes a 24x24-viewbox path in peach, scaled to the view bounds.
final class WizardIconView: UIView {
    enum Kind { case server, box, spark }
    private let kind: Kind
    private let stroke: UIColor

    init(kind: Kind, stroke: UIColor) {
        self.kind = kind; self.stroke = stroke
        super.init(frame: .zero)
        backgroundColor = .clear
        translatesAutoresizingMaskIntoConstraints = false
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) not used") }

    override func draw(_ rect: CGRect) {
        let unit = min(rect.width, rect.height) / 24.0
        let ox = (rect.width - 24 * unit) / 2, oy = (rect.height - 24 * unit) / 2
        func P(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * unit, y: oy + y * unit) }
        let path = UIBezierPath()
        switch kind {
        case .server:
            path.append(UIBezierPath(roundedRect: CGRect(x: ox + 3 * unit, y: oy + 4 * unit, width: 18 * unit, height: 7 * unit), cornerRadius: 1.5 * unit))
            path.append(UIBezierPath(roundedRect: CGRect(x: ox + 3 * unit, y: oy + 13 * unit, width: 18 * unit, height: 7 * unit), cornerRadius: 1.5 * unit))
            path.move(to: P(7, 7.5)); path.addLine(to: P(7.4, 7.5))
            path.move(to: P(7, 16.5)); path.addLine(to: P(7.4, 16.5))
        case .box:
            path.move(to: P(21, 8)); path.addLine(to: P(12, 3)); path.addLine(to: P(3, 8))
            path.addLine(to: P(12, 13)); path.addLine(to: P(21, 8)); path.close()
            path.move(to: P(3, 8)); path.addLine(to: P(3, 16)); path.addLine(to: P(12, 21))
            path.addLine(to: P(21, 16)); path.addLine(to: P(21, 8))
            path.move(to: P(12, 13)); path.addLine(to: P(12, 21))
        case .spark:
            let segs: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
                (12, 3, 12, 7), (12, 17, 12, 21), (3, 12, 7, 12), (17, 12, 21, 12),
                (5.6, 5.6, 8.4, 8.4), (15.6, 15.6, 18.4, 18.4),
                (18.4, 5.6, 15.6, 8.4), (8.4, 15.6, 5.6, 18.4),
            ]
            for (x1, y1, x2, y2) in segs { path.move(to: P(x1, y1)); path.addLine(to: P(x2, y2)) }
        }
        stroke.setStroke()
        path.lineWidth = 1.6 * unit
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        path.stroke()
    }
}
