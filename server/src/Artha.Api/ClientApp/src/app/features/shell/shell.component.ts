import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  IonApp,
  IonIcon,
  IonMenu,
  IonSplitPane,
  IonTabBar,
  IonTabButton,
  IonTabs,
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

// Side-nav (desktop) groups destinations so the list reads as a small
// table of contents instead of a flat run of icons.
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

// Bottom-tab (mobile) keeps the 5 most-used destinations so the bar
// doesn't crowd on small phones. Categories management is infrequent —
// reachable via Settings on mobile.
const TAB_ITEMS: NavItem[] = NAV_GROUPS
  .flatMap((g) => g.items)
  .filter((n) => n.path !== '/categories');

@Component({
  selector: 'artha-shell',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    IonApp,
    IonIcon,
    IonMenu,
    IonSplitPane,
    IonTabBar,
    IonTabButton,
    IonTabs,
  ],
  template: `
    <ion-app>
      <ion-split-pane contentId="main-content" when="md">
        <!-- ion-split-pane locates its side pane by tag name (ion-menu).
             Plain elements get rendered as content and the side pane
             disappears. So we keep ion-menu as the wrapper and put our
             custom layout inside it. -->
        <ion-menu contentId="main-content" type="overlay" class="artha-menu">
          <aside class="side-nav">
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
          </aside>
        </ion-menu>

        <ion-tabs id="main-content">
          <ion-tab-bar slot="bottom" class="mobile-tabs">
            @for (item of tabs; track item.path) {
              <ion-tab-button [tab]="item.path.slice(1)" [href]="item.path">
                <ion-icon [name]="item.icon" aria-hidden="true"></ion-icon>
                <span>{{ item.label }}</span>
              </ion-tab-button>
            }
          </ion-tab-bar>
        </ion-tabs>
      </ion-split-pane>
    </ion-app>
  `,
  styles: [`
    :host { display: contents; }

    /* ====== ion-menu host ======
       Strip the default Ionic menu chrome (background, border) so the
       custom aside inside controls every pixel. The split-pane keeps
       managing show/hide based on the when="md" breakpoint. */
    .artha-menu {
      --width: 260px;
      --min-width: 260px;
      --max-width: 260px;
      --background: var(--artha-surface);
      --border: 0;
    }
    .artha-menu::part(container) {
      background: var(--artha-surface);
      border-right: 1px solid var(--artha-border);
      box-shadow: none;
    }

    /* ====== Side nav (inside ion-menu) ====== */
    .side-nav {
      display: flex;
      flex-direction: column;
      padding: 20px 14px 14px;
      box-sizing: border-box;
      height: 100%;
      width: 100%;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 8px 20px;
      margin-bottom: 8px;
      border-bottom: 1px solid var(--artha-border);
    }
    .brand-mark {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--artha-accent) 0%, var(--artha-accent-hover) 100%);
      color: white;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--artha-shadow-sm);
    }
    .brand-mark ion-icon { font-size: 18px; }
    .brand-name {
      font-size: 17px;
      font-weight: 700;
      color: var(--artha-text);
      letter-spacing: -0.015em;
    }

    .nav {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 18px;
      padding-top: 8px;
    }
    .nav-group { display: flex; flex-direction: column; gap: 2px; }
    .nav-group-label {
      margin: 0 0 4px;
      padding: 0 12px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--artha-text-subtle);
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 9px 12px;
      border-radius: var(--artha-radius-sm);
      color: var(--artha-text-muted);
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: background 120ms ease, color 120ms ease;
      position: relative;
    }
    .nav-link ion-icon {
      font-size: 19px;
      flex-shrink: 0;
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

    /* ====== User card (footer of side nav) ====== */
    .user-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      margin-top: 12px;
      border-radius: var(--artha-radius);
      background: var(--artha-surface-2);
      border: 1px solid var(--artha-border);
    }
    .avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      flex-shrink: 0;
      object-fit: cover;
    }
    .avatar--initial {
      background: linear-gradient(135deg, var(--artha-accent) 0%, var(--artha-accent-hover) 100%);
      color: white;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 600;
    }
    .user-text { flex: 1; min-width: 0; }
    .user-name {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--artha-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .user-email {
      margin: 0;
      font-size: 11px;
      color: var(--artha-text-subtle);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .logout-btn {
      background: transparent;
      border: 0;
      padding: 6px;
      border-radius: 8px;
      color: var(--artha-text-subtle);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 120ms ease, color 120ms ease;
    }
    .logout-btn:hover {
      background: var(--artha-border);
      color: var(--artha-negative);
    }
    .logout-btn ion-icon { font-size: 18px; }

    /* ====== Mobile bottom tabs ====== */
    .mobile-tabs {
      --background: var(--artha-surface);
      --border: 1px solid var(--artha-border);
    }
    .mobile-tabs ion-tab-button {
      --color: var(--artha-text-subtle);
      --color-selected: var(--artha-accent);
      font-size: 11px;
    }
    .mobile-tabs ion-tab-button span {
      font-size: 11px;
      margin-top: 2px;
    }

    /* Desktop layout: hide the mobile bottom-tab bar above md (≥768px). */
    @media (min-width: 768px) {
      .mobile-tabs { display: none !important; }
    }

    /* Mobile: ion-split-pane already collapses the menu off-canvas below
       the breakpoint, but hide it outright too so swipe-from-edge
       doesn't reveal a sidebar we never advertise. */
    @media (max-width: 767.98px) {
      .artha-menu { display: none; }
    }
  `],
})
export class ShellComponent {
  private readonly session = inject(SessionService);
  private readonly googleAuth = inject(GoogleAuthService);
  private readonly router = inject(Router);

  protected readonly nav = NAV_GROUPS;
  protected readonly tabs = TAB_ITEMS;
  protected readonly user = this.session.currentUser;

  protected initial(name: string): string {
    return name?.trim().charAt(0).toUpperCase() ?? 'A';
  }

  protected async logout(): Promise<void> {
    await this.googleAuth.logout();
    await this.router.navigate(['/login']);
  }
}
