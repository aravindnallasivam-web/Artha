import { Component, OnInit, signal } from '@angular/core';

const MOBILE_SCHEME = 'com.artha.app://auth/callback';
const ANDROID_PACKAGE = 'com.artha.app';

function buildAndroidIntentUrl(search: string): string {
  // Chrome Custom Tabs reliably honors intent:// URLs that name the target
  // package; plain custom-scheme JS redirects are blocked without a user
  // gesture. The S.browser_fallback_url keeps the page sensible if the app
  // isn't installed.
  const query = search.startsWith('?') ? search.slice(1) : search;
  const fallback = encodeURIComponent('https://arthaexpense-qrts6.ondigitalocean.app/login');
  return `intent://auth/callback?${query}#Intent;scheme=com.artha.app;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
}

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

/**
 * Bridge page used by the Capacitor mobile flow. The Google OAuth client
 * cannot redirect directly to a custom URL scheme — the redirect must be
 * an HTTPS URL registered in Google Cloud Console. Mobile login uses
 * /auth/callback/mobile as the redirect_uri; this page receives the
 * code+state from Google and immediately bounces to com.artha.app://
 * which the OS routes back to the Artha app.
 *
 * Web users never hit this page (they use /auth/callback).
 */
@Component({
  selector: 'artha-mobile-callback',
  standalone: true,
  template: `
    <main class="bridge">
      <section>
        <h2>Returning to Artha&hellip;</h2>
        @if (manualLink()) {
          <p>If Artha didn't reopen automatically, tap the button below.</p>
          <a class="btn" [href]="manualLink()!">Open Artha</a>
        } @else {
          <p>Just a moment.</p>
        }
      </section>
    </main>
  `,
  styles: [`
    .bridge {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 16px; text-align: center;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    h2 { margin: 0 0 12px; color: #0f172a; }
    p { margin: 0 0 16px; color: #475569; }
    .btn {
      display: inline-block; padding: 12px 20px; border-radius: 8px;
      background: #0f172a; color: white; text-decoration: none;
      font-weight: 500;
    }
  `],
})
export class MobileCallbackComponent implements OnInit {
  protected readonly manualLink = signal<string | null>(null);

  ngOnInit(): void {
    const search = window.location.search;
    const target = isAndroid()
      ? buildAndroidIntentUrl(search)
      : `${MOBILE_SCHEME}${search}`;
    this.manualLink.set(target);
    // Try the immediate JS redirect — it may be blocked without a user
    // gesture, in which case the visible "Open Artha" button is the
    // fallback. The intent:// form succeeds most of the time on Android.
    window.location.replace(target);
  }
}
