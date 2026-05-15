// Mobile (Capacitor) build environment.
//
// When the app runs inside a Capacitor WebView (iOS / Android) it cannot
// use same-origin relative URLs — there is no ASP.NET host serving the
// SPA from the same scheme. All API calls must point at the deployed
// Artha backend over HTTPS.
//
// Replace the apiBaseUrl below with your deployed DigitalOcean App
// Platform URL (e.g. https://artha-abc12.ondigitalocean.app) before
// building the mobile binary.
//
// CORS for capacitor://localhost and ionic://localhost is already
// configured in server/src/Artha.Api/Program.cs.
export const environment = {
  production: true,
  apiBaseUrl: 'https://arthaexpense-qrts6.ondigitalocean.app',
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
