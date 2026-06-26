import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const capServerUrl = process.env.CAP_SERVER_URL?.trim();
// Public/TestFlight builds boot straight to the branded web /connect page
// (Nous-coded URL + token entry). No redundant native pairing screen.
const defaultServerUrl = 'https://battlestation.demi.la';

const config: CapacitorConfig = {
  appId: 'la.demi.battlestation',
  appName: 'Hermes Battlestation',
  webDir: 'ios-web',
  server: {
    url: capServerUrl || defaultServerUrl,
    cleartext: (capServerUrl || defaultServerUrl).startsWith('http://'),
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
