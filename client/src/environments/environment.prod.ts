export const environment = {
  production: true,
  apiBaseUrl: 'https://api.artha.example',
  google: {
    clientId: 'REPLACE_WITH_GOOGLE_OAUTH_WEB_CLIENT_ID',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    redirectUri: 'https://app.artha.example/auth/callback',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
  },
};
