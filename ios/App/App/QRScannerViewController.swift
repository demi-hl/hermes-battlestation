import UIKit
import AVFoundation

// In-app QR scanner. Opens the camera INSIDE Battlestation (never leaves the app
// to Apple's Camera), decodes a battlestation://connect?... or https://box/?token=
// pairing code, and hands the raw string back via onScan. The wizard parses it
// with the same parsePairingLink path the paste field uses.
final class QRScannerViewController: UIViewController {

    var onScan: ((String) -> Void)?

    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var didScan = false

    private let bg    = UIColor(red: 0.016, green: 0.110, blue: 0.110, alpha: 1) // #041c1c
    private let peach = UIColor(red: 1.0,   green: 0.902, blue: 0.796, alpha: 1) // #ffe6cb

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bg
        addChrome()
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            DispatchQueue.main.async {
                if granted { self?.configureSession() }
                else { self?.showDenied() }
            }
        }
    }

    private func configureSession() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { showDenied(); return }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { showDenied(); return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.layer.bounds
        view.layer.insertSublayer(layer, at: 0)
        preview = layer

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.session.startRunning()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.layer.bounds
    }

    // MARK: - Chrome (reticle, hint, cancel)
    private func addChrome() {
        let reticle = UIView()
        reticle.translatesAutoresizingMaskIntoConstraints = false
        reticle.layer.borderColor = peach.cgColor
        reticle.layer.borderWidth = 2
        reticle.layer.cornerRadius = 18
        reticle.backgroundColor = .clear
        view.addSubview(reticle)

        let hint = UILabel()
        hint.text = "Point at the QR from `npm run pair`"
        hint.font = UIFont(name: "Collapse-Regular", size: 14) ?? .systemFont(ofSize: 14)
        hint.textColor = peach
        hint.textAlignment = .center
        hint.numberOfLines = 0
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)

        let cancel = UIButton(type: .system)
        cancel.setTitle("Cancel", for: .normal)
        cancel.titleLabel?.font = UIFont(name: "Collapse-Bold", size: 16) ?? .systemFont(ofSize: 16, weight: .semibold)
        cancel.setTitleColor(bg, for: .normal)
        cancel.backgroundColor = peach
        cancel.layer.cornerRadius = 22
        cancel.contentEdgeInsets = .init(top: 11, left: 26, bottom: 11, right: 26)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(cancel)

        NSLayoutConstraint.activate([
            reticle.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            reticle.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            reticle.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.66),
            reticle.heightAnchor.constraint(equalTo: reticle.widthAnchor),

            hint.bottomAnchor.constraint(equalTo: reticle.topAnchor, constant: -20),
            hint.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            hint.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),

            cancel.topAnchor.constraint(equalTo: reticle.bottomAnchor, constant: 28),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
        ])
    }

    private func showDenied() {
        let l = UILabel()
        l.text = "Camera access is off. Enable it in Settings ▸ Battlestation, or go back and paste the pairing link instead."
        l.font = UIFont(name: "Collapse-Regular", size: 15) ?? .systemFont(ofSize: 15)
        l.textColor = peach
        l.textAlignment = .center
        l.numberOfLines = 0
        l.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(l)
        NSLayoutConstraint.activate([
            l.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            l.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            l.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
        ])
    }

    @objc private func cancelTapped() {
        stop()
        dismiss(animated: true)
    }

    private func stop() {
        if session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.session.stopRunning() }
        }
    }
}

extension QRScannerViewController: AVCaptureMetadataOutputObjectsDelegate {
    func metadataOutput(_ output: AVCaptureMetadataOutput,
                        didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard !didScan,
              let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              obj.type == .qr,
              let value = obj.stringValue, !value.isEmpty else { return }
        didScan = true
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        stop()
        dismiss(animated: true) { [weak self] in self?.onScan?(value) }
    }
}
