import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.garconnexpress.garcom',
  appName: 'GarcomExpress',
  webDir: 'garcom-app-nativo/www',
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    StatusBar: {
      overlaysWebView: false
    }
  }
};

export default config;
