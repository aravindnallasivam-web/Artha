// Same-origin token endpoint for the web build. Google requires the OAuth
// client secret for a "Web application" client, and the secret must never ship
// in browser code, so the app posts here and this adds GOOGLE_CLIENT_SECRET
// (an environment variable of the container) before forwarding to Google.
const qs = require('querystring');

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ALLOWED_GRANTS = ['authorization_code', 'refresh_token'];

function reply(r, status, body) {
  r.headersOut['Content-Type'] = 'application/json';
  r.headersOut['Cache-Control'] = 'no-store';
  r.return(status, body);
}

function fail(r, status, error, description) {
  reply(r, status, JSON.stringify({ error: error, error_description: description }));
}

async function token(r) {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) {
    fail(r, 500, 'server_misconfigured', 'GOOGLE_CLIENT_SECRET is not set on the Artha server.');
    return;
  }
  const params = qs.parse(r.requestText || '');
  if (ALLOWED_GRANTS.indexOf(params.grant_type) === -1) {
    fail(r, 400, 'unsupported_grant_type', 'Only sign-in and session refresh requests are accepted.');
    return;
  }
  params.client_secret = secret;
  try {
    const res = await ngx.fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: qs.stringify(params),
    });
    const text = await res.text();
    reply(r, res.status, text);
  } catch (e) {
    fail(r, 502, 'upstream_unreachable', 'Could not reach Google: ' + e.message);
  }
}

export default { token };
