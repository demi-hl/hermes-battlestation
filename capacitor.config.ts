import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

// The backend URL is build-time only — set CAP_SERVER_URL to bake a default box
// into YOUR build (it boots straight to that box's web /connect). The public OSS
// source ships NO real URL: the sentinel below tells the native AppDelegate
// "no baked URL" so a fresh install shows the pairing screen and asks the user
// for THEIR own Hermes box. Never hardcode a personal URL here.
const capServerUrl = process.env.CAP_SERVER_URL?.trim();
const NO_BAKED_URL = 'https://connect.localhost.invalid';
const serverUrl = capServerUrl || NO_BAKED_URL;

const config: CapacitorConfig = {
  appId: 'la.demi.battlestation',
  appName: 'Hermes Battlestation',
  webDir: 'ios-web',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
    // On a failed remote load show a branded error page instead of black.
    errorPath: 'error.html',
  },
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
    Keyboard: {
      resize: KeyboardResize.None,
    },
  },
};

export default config;
