import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { GoogleAuthService } from '../../core/auth/google-auth.service';
import { SessionService } from '../../core/auth/session.service';

@Component({
  selector: 'artha-dashboard',
  standalone: true,
  template: `
    <header class="topbar">
      <div class="brand">Artha</div>
      @if (currentUser(); as user) {
        <div class="user">
          @if (user.pictureUrl) {
            <img [src]="user.pictureUrl" [alt]="user.name" referrerpolicy="no-referrer" />
          }
          <span>{{ user.name }}</span>
          <button type="button" (click)="signOut()">Sign out</button>
        </div>
      }
    </header>
    <main class="content">
      <h1>Welcome to Artha</h1>
      @if (currentUser(); as user) {
        <p>Signed in as <strong>{{ user.email }}</strong>.</p>
      }
      <p class="placeholder">Expense tracking features land in milestone M2.</p>
    </main>
  `,
  styles: [`
    :host { display: block; font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #0f172a; }
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 24px; border-bottom: 1px solid #e2e8f0; background: #fff;
    }
    .brand { font-weight: 600; font-size: 18px; letter-spacing: -0.01em; }
    .user { display: flex; align-items: center; gap: 12px; font-size: 14px; }
    .user img { width: 32px; height: 32px; border-radius: 50%; }
    .user button {
      padding: 6px 12px; border-radius: 6px; border: 1px solid #cbd5e1;
      background: white; cursor: pointer; font-size: 13px;
    }
    .content { padding: 32px 24px; max-width: 720px; margin: 0 auto; }
    h1 { margin: 0 0 12px; font-size: 28px; letter-spacing: -0.02em; }
    .placeholder { margin-top: 32px; color: #64748b; font-style: italic; }
  `],
})
export class DashboardComponent {
  private readonly session = inject(SessionService);
  private readonly googleAuth = inject(GoogleAuthService);
  private readonly router = inject(Router);

  protected readonly currentUser = this.session.currentUser;

  async signOut(): Promise<void> {
    await this.googleAuth.logout();
    await this.router.navigate(['/login']);
  }
}
