import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.hermes.agent',
  appName: 'Hermes Agent',
  webDir: '.next',
  server: {
    url: 'https://demi-pc-wsl.tailfce42a.ts.net',
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
      launchShowDuration: 0,
    },
  },
};

export default config;