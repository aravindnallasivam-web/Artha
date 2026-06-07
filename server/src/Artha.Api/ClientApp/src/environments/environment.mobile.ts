// Mobile (Capacitor) build environment — SERVERLESS.
//
// The app talks to Google Drive directly; there is no Artha backend. apiBaseUrl
// is retained only for legacy references and is unused.
//
// IMPORTANT — Google Cloud Console setup for the serverless build:
//   1. Create an *Android* OAuth client (package com.artha.app + your signing
//      SHA-1). Android clients use PKCE with NO client secret, which is what
//      lets the code->token exchange run on-device.
//   2. Put that client's ID in `clientId` below.
//   3. Register `nativeRedirectUri` as an allowed redirect for the app; it must
//      match the custom-scheme intent filter in AndroidManifest.xml.
export const environment = {
  production: true,
  version: '1.0.0',
  apiBaseUrl: '',
  google: {
    clientId: '952436597649-6bpd2mli17eg30falj66bqpt8p5svvso.apps.googleusercontent.com',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    redirectPath: '/auth/callback',
    // Native deep-link the OAuth response returns to (no server bridge).
    nativeRedirectUri: 'com.artha.app://auth/callback',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
  },
};
