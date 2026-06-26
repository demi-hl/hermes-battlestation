// Options page: persist box URL + token to chrome.storage.sync, force a DNR
// resync in the service worker, then probe the box so the user gets immediate
// pass/fail feedback instead of discovering it in the panel.

const KEYS = { url: "boxUrl", token: "boxToken" };
const DEFAULT_URL = "https://battlestation.demi.la";

const $url = document.getElementById("url");
const $token = document.getElementById("token");
const $save = document.getElementById("save");
const $status = document.getElementById("status");

function normalizeUrl(raw) {
  let u = (raw || "").trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

function setStatus(text, cls) {
  $status.textContent = text;
  $status.className = cls || "";
}

async function load() {
  const cfg = await chrome.storage.sync.get([KEYS.url, KEYS.token]);
  $url.value = cfg[KEYS.url] || "";
  $token.value = cfg[KEYS.token] || "";
  if (!$url.value) $url.placeholder = DEFAULT_URL;
}

async function save() {
  const url = normalizeUrl($url.value) || DEFAULT_URL;
  const token = $token.value.trim();
  if (!token) {
    setStatus("Access token is required.", "err");
    return;
  }

  await chrome.storage.sync.set({ [KEYS.url]: url, [KEYS.token]: token });
  // Make sure the bearer-header DNR rule is live before we probe.
  await chrome.runtime.sendMessage({ type: "resync" }).catch(() => {});
  setStatus("Saved. Testing…", "");

  try {
    const res = await fetch(`${url}/api/health`, { cache: "no-store" });
    if (res.ok) {
      setStatus(`Connected to ${url} ✓`, "ok");
    } else if (res.status === 401) {
      setStatus("Reached the box, but the token was rejected (401).", "err");
    } else {
      setStatus(`Box responded ${res.status}.`, "err");
    }
  } catch {
    setStatus(`Saved, but couldn't reach ${url}. Check the URL / that the box is online.`, "err");
  }
}

$save.addEventListener("click", save);
load();
