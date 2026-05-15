#!/usr/bin/env bash
# Create or update the Artha app on DigitalOcean App Platform from .do/app.yaml.
#
# Reads secrets from .env (see .env.example). The rendered spec is written to
# a temp file with 0600 perms and deleted on exit so secrets never linger.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------- 1. Load .env ----------
if [[ ! -f .env ]]; then
    echo "✗ .env not found." >&2
    echo "  Copy .env.example to .env and fill in the values, then re-run." >&2
    exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a

: "${GOOGLE_CLIENT_SECRET:?GOOGLE_CLIENT_SECRET missing in .env}"
: "${JWT_SIGNING_KEY:?JWT_SIGNING_KEY missing in .env}"
DO_APP_NAME="${DO_APP_NAME:-artha}"
DO_REGION="${DO_REGION:-nyc}"

if (( ${#JWT_SIGNING_KEY} < 32 )); then
    echo "✗ JWT_SIGNING_KEY must be at least 32 characters." >&2
    echo "  Generate one with: openssl rand -base64 48" >&2
    exit 1
fi

# ---------- 2. Check doctl ----------
if ! command -v doctl >/dev/null 2>&1; then
    echo "✗ doctl not installed." >&2
    echo "  Install: https://docs.digitalocean.com/reference/doctl/how-to/install/" >&2
    echo "  Then: doctl auth init  (paste an API token from https://cloud.digitalocean.com/account/api/tokens)" >&2
    exit 1
fi
if ! doctl account get >/dev/null 2>&1; then
    echo "✗ doctl is installed but not authenticated." >&2
    echo "  Run: doctl auth init" >&2
    exit 1
fi

# ---------- 3. Render the spec with real values ----------
TMP_SPEC="$(mktemp -t artha-do-spec.XXXXXX.yaml)"
chmod 600 "$TMP_SPEC"
trap 'rm -f "$TMP_SPEC"' EXIT

# Substitute placeholders. ClientSecret and SigningKey come from .env;
# name + region overrides honor .env settings too.
awk \
    -v secret="$GOOGLE_CLIENT_SECRET" \
    -v key="$JWT_SIGNING_KEY" \
    -v appname="$DO_APP_NAME" \
    -v region="$DO_REGION" '
    /^name:/                     { print "name: " appname; next }
    /^region:/                   { print "region: " region; next }
    /value: REPLACE_IN_DO_DASHBOARD/ {
        # The next line we replace depends on which secret block we are in.
        # Distinguish via the key name we saw two lines above.
        sub(/REPLACE_IN_DO_DASHBOARD/, pending_value);
        print; next
    }
    /key: GoogleAuth__ClientSecret/ { pending_value = secret }
    /key: Jwt__SigningKey/          { pending_value = key }
    { print }
' .do/app.yaml > "$TMP_SPEC"

# Sanity check: bail if the placeholder still exists.
if grep -q REPLACE_IN_DO_DASHBOARD "$TMP_SPEC"; then
    echo "✗ Failed to render spec — placeholder still present. Spec file may have changed." >&2
    exit 1
fi

# ---------- 4. Find existing app by name ----------
echo "→ Looking for existing app named '$DO_APP_NAME'…"
APP_ID="$(doctl apps list --format ID,Spec.Name --no-header 2>/dev/null \
    | awk -v name="$DO_APP_NAME" '$2 == name { print $1; exit }')"

if [[ -n "$APP_ID" ]]; then
    echo "→ Updating existing app $APP_ID"
    doctl apps update "$APP_ID" --spec "$TMP_SPEC" --wait
else
    echo "→ Creating new app"
    doctl apps create --spec "$TMP_SPEC" --wait
    APP_ID="$(doctl apps list --format ID,Spec.Name --no-header \
        | awk -v name="$DO_APP_NAME" '$2 == name { print $1; exit }')"
fi

# ---------- 5. Print the live URL + reminders ----------
LIVE_URL="$(doctl apps get "$APP_ID" --format LiveURL --no-header || true)"
echo
echo "✓ Deploy kicked off. App ID: $APP_ID"
[[ -n "$LIVE_URL" ]] && echo "  URL:    $LIVE_URL"
echo
echo "Next:"
echo "  1. Wait for the deploy to finish (~5–8 min on first run):"
echo "       doctl apps list-deployments $APP_ID"
echo "  2. Add this redirect URI to your Google OAuth client:"
[[ -n "$LIVE_URL" ]] && echo "       ${LIVE_URL}/auth/callback"
echo "     at https://console.cloud.google.com/apis/credentials"
echo "  3. Open the URL in your browser and click 'Sign in with Google'."
