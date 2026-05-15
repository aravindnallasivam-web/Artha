export const environment = {
  production: false,
  // Same-origin in dev too: Angular's dev server proxies /api/* to the .NET API
  // running on http://localhost:5239 (see proxy.conf.json + angular.json).
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
