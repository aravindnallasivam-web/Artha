export const environment = {
  production: false,
  version: '1.0.0',
  // Same-origin in dev too: Angular's dev server proxies /api/* to the .NET API
  // running on http://localhost:5239 (see proxy.conf.json + angular.json).
  apiBaseUrl: '',
  // Stock prices. Browsers can't call Yahoo directly (no CORS); the Docker build
  // proxies it and other web builds fall back to statement prices.
  marketDataBase: 'https://query1.finance.yahoo.com',
  google: {
    // Web application OAuth client ("Web client 2"). Used by every non-Android
    // build: the website, the Docker image and the desktop app.
    clientId: '952436597649-5blujnv61odd0k20t13q85ovks5688l3.apps.googleusercontent.com',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    redirectPath: '/auth/callback',
    nativeRedirectUri:
      'com.googleusercontent.apps.952436597649-6bpd2mli17eg30falj66bqpt8p5svvso:/oauth2redirect',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
  },
};
