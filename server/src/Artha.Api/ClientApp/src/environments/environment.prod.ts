export const environment = {
  production: true,
  version: '1.0.0',
  // Prod: same-origin deployment behind DO App Platform routes
  // (SPA at /, API at /api). Empty string => relative URLs.
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
