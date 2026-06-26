import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const capServerUrl = process.env.CAP_SERVER_URL?.trim();
const pairingPlaceholderUrl = 'https://connect.localhost.invalid';

const config: CapacitorConfig = {
  appId: 'la.demi.battlestation',
  appName: 'Hermes Battlestation',
  webDir: 'ios-web',
  server: {
    // Public/TestFlight builds use a harmless sentinel; AppDelegate treats it
    // as no real server and shows the native Connect your Hermes screen.
    // Private builds may set CAP_SERVER_URL to skip pairing.
    url: capServerUrl || pairingPlaceholderUrl,
    cleartext: (capServerUrl || pairingPlaceholderUrl).startsWith('http://'),
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
