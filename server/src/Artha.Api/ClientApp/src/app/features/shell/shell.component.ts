import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  IonApp,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenu,
  IonNote,
  IonSplitPane,
  IonTabBar,
  IonTabButton,
  IonTabs,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  iconActive?: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { path: '/expenses', label: 'Expenses', icon: 'wallet-outline', iconActive: 'wallet' },
  { path: '/reports', label: 'Reports', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
  { path: '/categories', label: 'Categories', icon: 'pricetag-outline', iconActive: 'pricetag' },
  { path: '/settings', label: 'Settings', icon: 'settings-outline', iconActive: 'settings' },
];

@Component({
  selector: 'artha-shell',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    IonApp,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonMenu,
    IonNote,
    IonSplitPane,
    IonTabBar,
    IonTabButton,
    IonTabs,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-app>
      <ion-split-pane contentId="main-content" when="md">
        <ion-menu contentId="main-content" type="overlay" class="side-nav">
          <ion-header>
            <ion-toolbar>
              <ion-title>Artha</ion-title>
            </ion-toolbar>
          </ion-header>
          <ion-content>
            <ion-list lines="none" class="nav-list">
              @for (item of nav; track item.path) {
                <ion-item
                  [routerLink]="item.path"
                  routerLinkActive="active"
                  #rla="routerLinkActive"
                  detail="false"
                  button
                  class="nav-item"
                >
                  <ion-icon
                    slot="start"
                    [name]="rla.isActive ? (item.iconActive ?? item.icon) : item.icon"
                    aria-hidden="true"
                  ></ion-icon>
                  <ion-label>{{ item.label }}</ion-label>
                </ion-item>
              }
            </ion-list>
            <ion-note class="nav-footer">
              Your data lives in your Google Drive.
            </ion-note>
          </ion-content>
        </ion-menu>

        <ion-tabs id="main-content">
          <ion-tab-bar slot="bottom" class="mobile-tabs">
            @for (item of nav; track item.path) {
              <ion-tab-button [tab]="item.path.slice(1)" [href]="item.path">
                <ion-icon [name]="item.icon" aria-hidden="true"></ion-icon>
                <ion-label>{{ item.label }}</ion-label>
              </ion-tab-button>
            }
          </ion-tab-bar>
        </ion-tabs>
      </ion-split-pane>
    </ion-app>
  `,
  styles: [`
    /* Side nav (desktop ≥ md) — Ionic's split-pane shows the menu inline. */
    .side-nav {
      --side-width: 248px;
      --side-min-width: 248px;
      --side-max-width: 248px;
    }
    .nav-list {
      padding: 8px;
      background: transparent;
    }
    .nav-item {
      --padding-start: 12px;
      --padding-end: 12px;
      --inner-padding-end: 0;
      --background: transparent;
      --background-hover: var(--ion-color-step-100, #f1f5f9);
      --background-activated: var(--ion-color-step-150, #e2e8f0);
      --color: var(--ion-color-step-700, #334155);
      border-radius: 10px;
      margin: 2px 0;
      font-weight: 500;
    }
    .nav-item ion-icon {
      color: var(--ion-color-step-600, #475569);
      font-size: 22px;
      margin-inline-end: 4px;
    }
    .nav-item.active {
      --background: var(--ion-color-primary-tint);
      --color: var(--ion-color-primary);
      font-weight: 600;
    }
    .nav-item.active ion-icon {
      color: var(--ion-color-primary);
    }
    .nav-footer {
      display: block;
      padding: 16px 20px;
      font-size: 12px;
      color: var(--ion-color-medium);
      line-height: 1.4;
    }

    /* Desktop layout: hide the mobile bottom-tab bar above md (≥768px). */
    @media (min-width: 768px) {
      .mobile-tabs {
        display: none !important;
      }
    }
  `],
})
export class ShellComponent {
  protected readonly nav = NAV_ITEMS;
}
