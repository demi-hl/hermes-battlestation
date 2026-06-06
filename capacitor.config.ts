import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.nousresearch.battlestation',
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
      launchShowDuration: 0,
    },
  },
};

export default config;