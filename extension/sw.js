// Hermes Battlestation — MV3 service worker.
//
// Auth model (mirrors the iOS WebView + /connect token path, cookielessly):
// the box's middleware accepts `Authorization: Bearer <token>`. We inject that
// header on every request to the configured box host via declarativeNetRequest.
// Because the side panel frames the box on a *different* origin, its SameSite=Lax
// auth cookies would be dropped in that third-party context — the bearer header
// sidesteps cookies entirely. Token lives in chrome.storage.sync, never the bundle.

const RULE_ID = 1;
const KEYS = { url: "boxUrl", token: "boxToken" };

function hostFromUrl(raw) {
  try {
    return new URL(raw).host; // host = hostname[:port]
  } catch {
    return null;
  }
}

// Rebuild the single dynamic DNR rule from current storage. No token or no URL →
// remove the rule (panel will show the setup prompt instead).
async function syncRule() {
  const cfg = await chrome.storage.sync.get([KEYS.url, KEYS.token]);
  const url = (cfg[KEYS.url] || "").trim();
  const token = (cfg[KEYS.token] || "").trim();
  const host = url && hostFromUrl(url);

  const removeRuleIds = [RULE_ID];
  const addRules =
    host && token
      ? [
          {
            id: RULE_ID,
            priority: 1,
            action: {
              type: "modifyHeaders",
              requestHeaders: [
                { header: "Authorization", operation: "set", value: `Bearer ${token}` },
              ],
            },
            condition: {
              requestDomains: [host.split(":")[0]],
              resourceTypes: [
                "main_frame",
                "sub_frame",
                "xmlhttprequest",
                "websocket",
                "other",
              ],
            },
          },
        ]
      : [];

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

chrome.runtime.onInstalled.addListener(syncRule);
chrome.runtime.onStartup.addListener(syncRule);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes[KEYS.url] || changes[KEYS.token])) syncRule();
});

// Toolbar click → open the side panel for the current window.
chrome.action.onClicked.addListener(async () => {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
  } catch (e) {
    // Fallback: full-tab panel if side panel is unavailable.
    chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });
  }
});

// Let the side panel / options request an immediate rule resync.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "resync") {
    syncRule().then(() => sendResponse({ ok: true }));
    return true; // async response
  }
  return false;
});
