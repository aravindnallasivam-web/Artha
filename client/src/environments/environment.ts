export const environment = {
  production: false,
  apiBaseUrl: 'https://localhost:5001',
  google: {
    clientId: 'REPLACE_WITH_GOOGLE_OAUTH_WEB_CLIENT_ID',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    redirectUri: 'http://localhost:4200/auth/callback',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
  },
};
