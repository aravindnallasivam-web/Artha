export const environment = {
  production: false,
  // Dev: API runs on a separate port, so the SPA needs the full origin.
  // CORS in appsettings.json grants http://localhost:4200 access.
  apiBaseUrl: 'https://localhost:5001',
  google: {
    clientId: 'REPLACE_WITH_GOOGLE_OAUTH_WEB_CLIENT_ID',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    // redirectUri is computed at runtime from window.location.origin + this path.
    redirectPath: '/auth/callback',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
  },
};
