import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.garconnexpress.motoboy2',
  appName: 'Motoboy Express',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    StatusBar: {
      overlaysWebView: false
    },
    LocalNotifications: {
      smallIcon: "ic_stat_notification",
      iconColor: "#488AFF",
      sound: "notificacao.mp3"
    }
  }
};

export default config;
