import { Component, effect, inject, signal } from '@angular/core';
import { GoogleAuthService } from '../../core/auth/google-auth.service';

@Component({
  selector: 'artha-login',
  standalone: true,
  template: `
    <main class="login-shell">
      <section class="login-card">
        <h1>Artha</h1>
        <p class="subtitle">Track expenses. Own your data.</p>
        <p class="description">
          Your expense data lives in your own Google Drive — Artha never stores it on our servers.
        </p>
        <button type="button" class="google-btn" (click)="signIn()" [disabled]="loading()">
          @if (loading()) {
            <span>Redirecting&hellip;</span>
          } @else {
            <span>Sign in with Google</span>
          }
        </button>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
      </section>
    </main>
  `,
  styles: [`
    .login-shell {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 16px;
      background: linear-gradient(135deg, #f4f7fb, #e0e8f4);
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    .login-card {
      background: white;
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 380px;
      width: 100%;
      box-shadow: 0 8px 32px rgba(15, 23, 42, 0.08);
      text-align: center;
    }
    h1 { margin: 0 0 8px; font-size: 32px; color: #0f172a; letter-spacing: -0.02em; }
    .subtitle { margin: 0 0 16px; color: #475569; font-weight: 500; }
    .description { margin: 0 0 24px; color: #64748b; font-size: 14px; line-height: 1.5; }
    .google-btn {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid #cbd5e1;
      background: white;
      color: #0f172a;
      font-size: 16px;
      font-weight: 500;
      border-radius: 8px;
      cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .google-btn:hover:not(:disabled) { border-color: #94a3b8; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06); }
    .google-btn:disabled { cursor: wait; opacity: 0.7; }
    .error { color: #dc2626; margin: 16px 0 0; font-size: 14px; }
  `],
})
export class LoginComponent {
  private readonly googleAuth = inject(GoogleAuthService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // The native OAuth deep link completes inside GoogleAuthService, outside
    // this component. Mirror any failure it publishes into the local state so
    // the user sees the cause and the button leaves its "Redirecting…" state
    // instead of hanging silently.
    effect(() => {
      const err = this.googleAuth.authError();
      if (err) {
        this.error.set(err);
        this.loading.set(false);
      }
    });
  }

  async signIn(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.googleAuth.beginLogin();
      // The browser navigates away; we won't reach the next line.
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Sign-in failed.');
      this.loading.set(false);
    }
  }
}
