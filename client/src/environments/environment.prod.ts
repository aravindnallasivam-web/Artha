export const environment = {
  production: true,
  // Prod: same-origin deployment behind DO App Platform routes
  // (SPA at /, API at /api). Empty string => relative URLs.
  apiBaseUrl: '',
  google: {
    clientId: 'REPLACE_WITH_GOOGLE_OAUTH_WEB_CLIENT_ID',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    redirectPath: '/auth/callback',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
  },
};
