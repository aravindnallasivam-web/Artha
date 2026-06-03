import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonIcon,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { GoogleAuthService } from '../../core/auth/google-auth.service';
import { SessionService } from '../../core/auth/session.service';

interface MoreLink {
  path: string;
  label: string;
  icon: string;
  hint: string;
}

const LINKS: MoreLink[] = [
  { path: '/planned-expenses', label: 'Planned', icon: 'calendar-outline', hint: 'Fixed monthly bills' },
  { path: '/categories', label: 'Categories', icon: 'pricetag-outline', hint: 'Organise your spending' },
  { path: '/settings', label: 'Settings', icon: 'settings-outline', hint: 'Currency, preferences' },
];

/**
 * Overflow hub for the mobile bottom tab bar. The five tabs cover the primary
 * destinations; everything else (profile, Categories, Settings, sign out)
 * lives here. On desktop the full set is in the side-nav, so this page is only
 * really reached on mobile — but it renders fine anywhere.
 */
@Component({
  selector: 'artha-more',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>More</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="page">
        @if (user(); as u) {
          <section class="profile">
            @if (u.pictureUrl) {
              <img class="avatar" [src]="u.pictureUrl" [alt]="u.name" referrerpolicy="no-referrer" />
            } @else {
              <span class="avatar avatar--initial" aria-hidden="true">{{ initial(u.name) }}</span>
            }
            <div class="profile-text">
              <p class="profile-name">{{ u.name }}</p>
              <p class="profile-email">{{ u.email }}</p>
            </div>
          </section>
        }

        <nav class="links" aria-label="More">
          @for (link of links; track link.path) {
            <a [routerLink]="link.path" class="link">
              <span class="link-icon"><ion-icon [name]="link.icon" aria-hidden="true"></ion-icon></span>
              <span class="link-text">
                <span class="link-label">{{ link.label }}</span>
                <span class="link-hint">{{ link.hint }}</span>
              </span>
              <ion-icon class="link-chevron" name="chevron-forward" aria-hidden="true"></ion-icon>
            </a>
          }

          <button type="button" class="link link--danger" (click)="logout()">
            <span class="link-icon"><ion-icon name="log-out-outline" aria-hidden="true"></ion-icon></span>
            <span class="link-text"><span class="link-label">Sign out</span></span>
          </button>
        </nav>
      </div>
    </ion-content>
  `,
  styles: [`
    :host { display: contents; }
    ion-content { --background: var(--artha-bg); }

    .page {
      padding: 16px;
      max-width: 640px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .profile {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius-lg);
      box-shadow: var(--artha-shadow-sm);
    }
    .avatar {
      width: 52px; height: 52px;
      border-radius: 50%;
      flex-shrink: 0; object-fit: cover;
    }
    .avatar--initial {
      background: linear-gradient(135deg, var(--artha-accent) 0%, var(--artha-accent-hover) 100%);
      color: white;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 700;
    }
    .profile-text { min-width: 0; }
    .profile-name {
      margin: 0;
      font-size: 16px; font-weight: 700;
      color: var(--artha-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .profile-email {
      margin: 2px 0 0;
      font-size: 13px;
      color: var(--artha-text-subtle);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .links {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .link {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      padding: 14px 16px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      box-shadow: var(--artha-shadow-sm);
      text-decoration: none;
      cursor: pointer;
      text-align: left;
      transition: background 120ms ease;
    }
    .link:hover { background: var(--artha-surface-2); }
    .link-icon {
      width: 38px; height: 38px;
      flex-shrink: 0;
      border-radius: 11px;
      background: var(--artha-accent-tint);
      color: var(--artha-accent);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .link-icon ion-icon { font-size: 20px; }
    .link-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .link-label {
      font-size: 15px; font-weight: 600;
      color: var(--artha-text);
    }
    .link-hint {
      font-size: 12px;
      color: var(--artha-text-subtle);
    }
    .link-chevron {
      font-size: 18px;
      color: var(--artha-text-subtle);
    }
    .link--danger .link-icon {
      background: var(--artha-negative-tint);
      color: var(--artha-negative);
    }
    .link--danger .link-label { color: var(--artha-negative); }
  `],
})
export class MorePage {
  private readonly session = inject(SessionService);
  private readonly googleAuth = inject(GoogleAuthService);
  private readonly router = inject(Router);

  protected readonly links = LINKS;
  protected readonly user = this.session.currentUser;

  protected initial(name: string): string {
    return name?.trim().charAt(0).toUpperCase() ?? 'A';
  }

  protected async logout(): Promise<void> {
    await this.googleAuth.logout();
    await this.router.navigate(['/login']);
  }
}
