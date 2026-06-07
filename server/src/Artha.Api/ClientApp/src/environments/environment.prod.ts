export const environment = {
  production: true,
  version: '1.0.0',
  // Prod: same-origin deployment behind DO App Platform routes
  // (SPA at /, API at /api). Empty string => relative URLs.
  apiBaseUrl: '',
  google: {
    clientId: '952436597649-j9gosps5n1ukkm1907fu8bl06toptdb6.apps.googleusercontent.com',
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
