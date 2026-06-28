import Foundation
import Security

// Persistent, secure storage for the Battlestation access token.
//
// WHY THIS EXISTS: the old flow stashed the token in UserDefaults under
// `pendingToken` and DELETED it after a single use, then relied entirely on the
// WKWebView's `bs_token` cookie to stay logged in. Any time that cookie went
// away — a box restart/deploy, a Tailscale blip, iOS evicting WebView storage —
// the next cold launch had no token, the load failed, and the app bounced to
// the setup screen (looking like a "disconnect"). Persisting the token in the
// Keychain and re-appending it on every cold launch makes auth self-heal: the
// token rides each fresh load as `?token=…`, the server swaps it for a fresh
// httpOnly cookie via middleware, and a dropped cookie no longer logs you out.
//
// The Keychain (not UserDefaults) is the correct home for a credential: it's
// encrypted at rest and not included in unencrypted device backups
// (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly).
enum TokenStore {
    private static let service = "la.demi.battlestation"
    private static let account = "bs_token"

    @discardableResult
    static func save(_ token: String) -> Bool {
        let value = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, let data = value.data(using: .utf8) else {
            // Empty token == clear it.
            delete()
            return false
        }
        // Upsert: delete any existing item, then add fresh.
        delete()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    static func load() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.isEmpty else {
            return nil
        }
        return token
    }

    static func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
