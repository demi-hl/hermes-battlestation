// Side panel controller. Reads the configured box URL, probes /api/health to
// fail loudly (instead of a blank frame), then loads the box in the iframe.
// All auth rides on the Authorization header injected by sw.js DNR — no token
// ever touches this page's DOM or the frame URL.

const KEYS = { url: "boxUrl", token: "boxToken" };
const DEFAULT_URL = "https://battlestation.demi.la";

const $frame = document.getElementById("frame");
const $setup = document.getElementById("setup");
const $msg = document.getElementById("msg");
const $openOptions = document.getElementById("open-options");

$openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function normalizeUrl(raw) {
  let u = (raw || "").trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

function showSetup(text, isErr) {
  $msg.textContent = text;
  $msg.className = isErr ? "err" : "";
  $setup.classList.add("show");
  $frame.classList.remove("show");
}

function showFrame(url) {
  $frame.src = url;
  $frame.classList.add("show");
  $setup.classList.remove("show");
}

async function boot() {
  const cfg = await chrome.storage.sync.get([KEYS.url, KEYS.token]);
  const url = normalizeUrl(cfg[KEYS.url] || "");
  const token = (cfg[KEYS.token] || "").trim();

  if (!url) {
    showSetup(
      `No box configured. Open settings and set your URL (default ${DEFAULT_URL}) and access token.`,
      false,
    );
    return;
  }

  // Probe health first. The DNR rule already injects the bearer header, so this
  // request authenticates exactly like the framed app will.
  try {
    const res = await fetch(`${url}/api/health`, { cache: "no-store" });
    if (!res.ok && res.status !== 401) throw new Error(String(res.status));
    if (res.status === 401) {
      showSetup(
        token
          ? "Box reached but the token was rejected (401). Re-check the token in settings."
          : "This box requires an access token. Add it in settings.",
        true,
      );
      return;
    }
  } catch {
    showSetup(`Couldn't reach ${url}. Check the URL and that the box is online.`, true);
    return;
  }

  showFrame(url);
}

// Re-boot whenever config changes (e.g. after editing options).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes[KEYS.url] || changes[KEYS.token])) boot();
});

boot();
