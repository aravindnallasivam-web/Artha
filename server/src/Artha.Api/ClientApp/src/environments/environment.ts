export const environment = {
  production: false,
  version: '1.0.0',
  // Same-origin in dev too: Angular's dev server proxies /api/* to the .NET API
  // running on http://localhost:5239 (see proxy.conf.json + angular.json).
  apiBaseUrl: '',
  google: {
    clientId: '952436597649-6bpd2mli17eg30falj66bqpt8p5svvso.apps.googleusercontent.com',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    redirectPath: '/auth/callback',
    nativeRedirectUri:
      'com.googleusercontent.apps.952436597649-6bpd2mli17eg30falj66bqpt8p5svvso:/oauth2redirect',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.appdata',
      'https://www.googleapis.com/auth/drive.file',
    ],
  },
};
