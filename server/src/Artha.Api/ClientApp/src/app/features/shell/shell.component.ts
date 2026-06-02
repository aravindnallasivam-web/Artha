import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  IonApp,
  IonContent,
  IonIcon,
  IonMenu,
  IonMenuButton,
  IonRouterOutlet,
  IonSplitPane,
  MenuController,
} from '@ionic/angular/standalone';
import { GoogleAuthService } from '../../core/auth/google-auth.service';
import { SessionService } from '../../core/auth/session.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  iconActive?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { path: '/dashboard', label: 'Home', icon: 'home-outline', iconActive: 'home' },
      { path: '/reports', label: 'Reports', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
    ],
  },
  {
    label: 'Money',
    items: [
      { path: '/expenses', label: 'Expenses', icon: 'wallet-outline', iconActive: 'wallet' },
      { path: '/accounts', label: 'Accounts', icon: 'card-outline', iconActive: 'card' },
      { path: '/investments', label: 'Investments', icon: 'trending-up-outline', iconActive: 'trending-up' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { path: '/categories', label: 'Categories', icon: 'pricetag-outline', iconActive: 'pricetag' },
      { path: '/settings', label: 'Settings', icon: 'settings-outline', iconActive: 'settings' },
    ],
  },
];

@Component({
  selector: 'artha-shell',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    IonApp,
    IonContent,
    IonIcon,
    IonMenu,
    IonMenuButton,
    IonRouterOutlet,
    IonSplitPane,
  ],
  template: `
    <ion-app>
      <!--
        Canonical Ionic split-pane shell.
        - when="md" (>=768px): the menu renders as a fixed side pane.
        - below md: the menu becomes a swipe/tap slide-over, opened via the
          floating menu button (hidden on desktop by CSS).
        The routed pages live in <ion-router-outlet id="main-content"> — the
        split-pane's content target.
      -->
      <ion-split-pane contentId="main-content" when="md" class="artha-split">
        <ion-menu contentId="main-content" menuId="main" class="artha-menu">
          <ion-content class="artha-menu-content">
            <div class="brand">
              <span class="brand-mark" aria-hidden="true">
                <ion-icon name="layers"></ion-icon>
              </span>
              <span class="brand-name">Artha</span>
            </div>

            <nav class="nav" aria-label="Main">
              @for (group of nav; track group.label) {
                <div class="nav-group">
                  <p class="nav-group-label">{{ group.label }}</p>
                  @for (item of group.items; track item.path) {
                    <a
                      [routerLink]="item.path"
                      routerLinkActive="active"
                      #rla="routerLinkActive"
                      class="nav-link"
                      (click)="closeMenu()"
                    >
                      <ion-icon
                        [name]="rla.isActive ? (item.iconActive ?? item.icon) : item.icon"
                        aria-hidden="true"
                      ></ion-icon>
                      <span>{{ item.label }}</span>
                    </a>
                  }
                </div>
              }
            </nav>

            @if (user(); as u) {
              <div class="user-card">
                @if (u.pictureUrl) {
                  <img class="avatar" [src]="u.pictureUrl" [alt]="u.name" referrerpolicy="no-referrer" />
                } @else {
                  <span class="avatar avatar--initial" aria-hidden="true">{{ initial(u.name) }}</span>
                }
                <div class="user-text">
                  <p class="user-name">{{ u.name }}</p>
                  <p class="user-email">{{ u.email }}</p>
                </div>
                <button class="logout-btn" type="button" (click)="logout()" aria-label="Sign out">
                  <ion-icon name="log-out-outline"></ion-icon>
                </button>
              </div>
            }
          </ion-content>
        </ion-menu>

        <ion-router-outlet id="main-content"></ion-router-outlet>
      </ion-split-pane>

      <!-- Mobile-only: opens the slide-over menu. Hidden once the side pane
           is visible (>=768px). -->
      <div class="menu-fab">
        <ion-menu-button menu="main" aria-label="Open menu"></ion-menu-button>
      </div>
    </ion-app>
  `,
  styles: [`
    .artha-split {
      /* Sidebar width — Ionic reads --side-* on ion-split-pane in split mode. */
      --side-min-width: 264px;
      --side-max-width: 264px;
      --side-width: 264px;
    }

    .artha-menu {
      --background: var(--artha-surface);
      --border: 1px solid var(--artha-border-strong);
    }
    .artha-menu::part(container) {
      background: var(--artha-surface);
      box-shadow: var(--artha-shadow-sm);
    }
    .artha-menu-content {
      --background: var(--artha-surface);
      --padding-top: 20px;
      --padding-bottom: 14px;
      --padding-start: 14px;
      --padding-end: 14px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 8px 18px;
      margin-bottom: 8px;
      border-bottom: 1px solid var(--artha-border);
    }
    .brand-mark {
      width: 32px; height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--artha-accent) 0%, var(--artha-accent-hover) 100%);
      color: white;
      display: inline-flex; align-items: center; justify-content: center;
      box-shadow: var(--artha-shadow-sm);
    }
    .brand-mark ion-icon { font-size: 18px; }
    .brand-name {
      font-size: 17px; font-weight: 700;
      color: var(--artha-text);
      letter-spacing: -0.015em;
    }

    .nav {
      display: flex; flex-direction: column;
      gap: 18px; padding-top: 4px;
    }
    .nav-group { display: flex; flex-direction: column; gap: 2px; }
    .nav-group-label {
      margin: 0 0 4px;
      padding: 0 12px;
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--artha-text-subtle);
    }

    .nav-link {
      display: flex; align-items: center; gap: 12px;
      padding: 9px 12px;
      border-radius: var(--artha-radius-sm);
      color: var(--artha-text-muted);
      font-size: 14px; font-weight: 500;
      text-decoration: none;
      transition: background 120ms ease, color 120ms ease;
      cursor: pointer;
    }
    .nav-link ion-icon {
      font-size: 19px; flex-shrink: 0;
      color: var(--artha-text-subtle);
      transition: color 120ms ease;
    }
    .nav-link:hover {
      background: var(--artha-surface-2);
      color: var(--artha-text);
    }
    .nav-link:hover ion-icon { color: var(--artha-text-muted); }
    .nav-link.active {
      background: var(--artha-accent-tint);
      color: var(--artha-accent);
      font-weight: 600;
    }
    .nav-link.active ion-icon { color: var(--artha-accent); }
    .nav-link:focus-visible {
      outline: 2px solid var(--artha-accent);
      outline-offset: 2px;
    }

    .user-card {
      display: flex; align-items: center; gap: 10px;
      padding: 10px;
      margin-top: 18px;
      border-radius: var(--artha-radius);
      background: var(--artha-surface-2);
      border: 1px solid var(--artha-border);
    }
    .avatar {
      width: 34px; height: 34px;
      border-radius: 50%;
      flex-shrink: 0; object-fit: cover;
    }
    .avatar--initial {
      background: linear-gradient(135deg, var(--artha-accent) 0%, var(--artha-accent-hover) 100%);
      color: white;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 600;
    }
    .user-text { flex: 1; min-width: 0; }
    .user-name {
      margin: 0;
      font-size: 13px; font-weight: 600;
      color: var(--artha-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .user-email {
      margin: 0;
      font-size: 11px;
      color: var(--artha-text-subtle);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .logout-btn {
      background: transparent; border: 0;
      padding: 6px; border-radius: 8px;
      color: var(--artha-text-subtle);
      cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 120ms ease, color 120ms ease;
    }
    .logout-btn:hover {
      background: var(--artha-border);
      color: var(--artha-negative);
    }
    .logout-btn ion-icon { font-size: 18px; }

    /* Floating menu toggle — mobile only. */
    .menu-fab {
      position: fixed;
      top: max(8px, env(safe-area-inset-top));
      left: 8px;
      z-index: 20;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: 10px;
      box-shadow: var(--artha-shadow-sm);
    }
    .menu-fab ion-menu-button {
      --color: var(--artha-text);
    }
    @media (min-width: 768px) {
      .menu-fab { display: none; }
    }
  `],
})
export class ShellComponent {
  private readonly session = inject(SessionService);
  private readonly googleAuth = inject(GoogleAuthService);
  private readonly router = inject(Router);
  private readonly menuCtrl = inject(MenuController);

  protected readonly nav = NAV_GROUPS;
  protected readonly user = this.session.currentUser;

  protected initial(name: string): string {
    return name?.trim().charAt(0).toUpperCase() ?? 'A';
  }

  /** Close the slide-over after navigating on mobile. No-op when the menu is
      a fixed side pane (desktop), so it's safe to call unconditionally. */
  protected closeMenu(): void {
    void this.menuCtrl.close('main');
  }

  protected async logout(): Promise<void> {
    this.closeMenu();
    await this.googleAuth.logout();
    await this.router.navigate(['/login']);
  }
}
