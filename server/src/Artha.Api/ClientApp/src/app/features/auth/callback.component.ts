import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GoogleAuthService } from '../../core/auth/google-auth.service';

@Component({
  selector: 'artha-auth-callback',
  standalone: true,
  template: `
    <main class="callback-shell">
      @if (error()) {
        <section class="callback-card">
          <h2>Sign-in failed</h2>
          <p class="error">{{ error() }}</p>
          <button type="button" (click)="retry()">Try again</button>
        </section>
      } @else {
        <section class="callback-card">
          <div class="spinner" aria-hidden="true"></div>
          <p>Finishing sign-in&hellip;</p>
        </section>
      }
    </main>
  `,
  styles: [`
    .callback-shell {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 16px;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    .callback-card { text-align: center; max-width: 360px; }
    .spinner {
      width: 32px; height: 32px; margin: 0 auto 16px;
      border: 3px solid #e2e8f0; border-top-color: #0f172a;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .error { color: #dc2626; margin: 0 0 16px; }
    button {
      padding: 8px 16px; border-radius: 6px; border: 1px solid #cbd5e1;
      background: white; cursor: pointer;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class CallbackComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly googleAuth = inject(GoogleAuthService);

  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    void this.handleCallback();
  }

  retry(): void {
    void this.router.navigate(['/login']);
  }

  private async handleCallback(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const errorParam = params.get('error');
    if (errorParam) {
      this.error.set(`Google returned an error: ${errorParam}`);
      return;
    }
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      this.error.set('Missing authorization code from Google.');
      return;
    }

    try {
      await this.googleAuth.completeLogin(code, state);
      await this.router.navigate(['/dashboard']);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  }
}
