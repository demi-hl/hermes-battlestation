import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'la.demi.battlestation',
  appName: 'Hermes Battlestation',
  webDir: '.next',
  server: {
    url: process.env.CAP_SERVER_URL ?? 'http://localhost:9119',
    cleartext: false,
  },
  ios: {
    contentInset: 'always',
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 700,
      backgroundColor: "#041c1c",
      showSpinner: false,
    },
    Keyboard: {
      // Overlay mode: the keyboard floats over the WKWebView WITHOUT resizing
      // it, so the visual-viewport / keyboardWillShow JS in Providers.tsx is
      // the single source of truth for shrinking the shell. `native` here would
      // double-count against that manual shrink and leave a gap below the
      // composer. Overlay = composer rides up exactly to the keyboard top.
      resize: KeyboardResize.None,
    },
  },
};

export default config;