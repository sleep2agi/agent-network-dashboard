import type { CapacitorConfig } from '@capacitor/cli';

const dashboardUrl = process.env.ANET_DASHBOARD_URL || 'http://dm.vansin.top:3000';

const config: CapacitorConfig = {
  appId: 'ai.sleep2agi.agentnetwork.dashboard',
  appName: 'Agent Network',
  webDir: 'public',
  server: {
    url: dashboardUrl,
    cleartext: dashboardUrl.startsWith('http://'),
  },
  ios: {
    contentInset: 'automatic',
  },
  android: {
    allowMixedContent: dashboardUrl.startsWith('http://'),
  },
};

export default config;
