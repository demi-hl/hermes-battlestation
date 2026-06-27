// Shared onboarding constants. Single source of truth for the install/setup
// commands surfaced in BOTH the gated /api/onboarding route (→ OnboardingPane,
// POST-auth) and the public pre-auth /start fork. Keeping them here avoids the
// two screens drifting apart and lets /start render the install path with zero
// network round-trips (the box-introspection bits — installed/loggedIn — stay
// behind the gate; only these static, public-docs strings live here).

export const HERMES_BIN = process.env.HERMES_BIN ?? "hermes";

/** Static install/links block. Mirrors the public Hermes Agent docs. Safe to
 *  ship to an unauthenticated client — no secrets, no box state. */
export type OnboardingInstall = {
  unix: string;
  skipBrowser: string;
  setup: string;
  docs: string;
  repo: string;
  signup: string;
};

export const INSTALL_INFO: OnboardingInstall = {
  unix: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
  skipBrowser:
    "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-browser",
  setup: `${HERMES_BIN} setup`,
  docs: "https://hermes-agent.nousresearch.com/docs",
  repo: "https://github.com/NousResearch/hermes-agent",
  signup: "https://portal.nousresearch.com",
};

/** Commands to stand up a Battlestation server on a box you already control.
 *  Mirrors README "Fastest path" + package.json scripts (serve:vps, pair,
 *  token). The repo URL is the Battlestation app itself, not Hermes Agent. */
export const BATTLESTATION_REPO =
  "https://github.com/demi-hl/hermes-battlestation";

export const SERVER_SETUP = {
  // 1. Clone the Battlestation app onto the box.
  clone: `git clone ${BATTLESTATION_REPO} && cd hermes-battlestation`,
  // 2. Install deps, then one command that builds, mints a token, installs a
  //    reboot-proof systemd --user service, and fronts it with tailscale serve.
  install: "npm install",
  serve: "npm run serve:vps",
  // 3a. Pair a device with a scannable QR (preferred on mobile).
  pair: "npm run pair",
  // 3b. Or just print the access token to paste into Connect.
  token: "npm run token",
};
