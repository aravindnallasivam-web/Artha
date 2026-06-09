import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.artha.app',
  appName: 'Artha',
  webDir: 'dist/client/browser',
  server: {
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'always',
  },
  plugins: {
    SplashScreen: {
      // launchAutoHide is off so NativeUiService.initialize() controls the
      // exact moment the splash fades — only after the SPA's first paint,
      // which avoids a white flash between splash and app.
      launchAutoHide: false,
      launchShowDuration: 3000, // hard ceiling; code hides it well before this
      fadeOutDuration: 300,
      backgroundColor: '#ffffff',
      showSpinner: false,
      // The splash drawable is a full-bleed vector (theme-aware background +
      // centred logo); CENTER_CROP makes it fill the screen on any aspect.
      androidScaleType: 'CENTER_CROP',
      androidSplashResourceName: 'splash_screen',
    },
    StatusBar: {
      // Don't draw the web view under the status bar on Android; the bar gets a
      // solid background that NativeUiService keeps in sync with light/dark.
      overlaysWebView: false,
      style: 'DEFAULT',
      backgroundColor: '#f8fafc',
    },
  },
};

export default config;
