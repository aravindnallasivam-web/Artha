import { Component } from '@angular/core';
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonTabBar,
  IonTabButton,
  IonTabs,
} from '@ionic/angular/standalone';

@Component({
  selector: 'artha-shell',
  standalone: true,
  imports: [
    IonApp,
    IonIcon,
    IonLabel,
    IonTabBar,
    IonTabButton,
    IonTabs,
  ],
  template: `
    <ion-app>
      <ion-tabs>
        <ion-tab-bar slot="bottom">
          <ion-tab-button tab="dashboard" href="/dashboard">
            <ion-icon name="home-outline" aria-hidden="true"></ion-icon>
            <ion-label>Home</ion-label>
          </ion-tab-button>
          <ion-tab-button tab="expenses" href="/expenses">
            <ion-icon name="wallet-outline" aria-hidden="true"></ion-icon>
            <ion-label>Expenses</ion-label>
          </ion-tab-button>
          <ion-tab-button tab="categories" href="/categories">
            <ion-icon name="pricetag" aria-hidden="true"></ion-icon>
            <ion-label>Categories</ion-label>
          </ion-tab-button>
          <ion-tab-button tab="settings" href="/settings">
            <ion-icon name="settings-outline" aria-hidden="true"></ion-icon>
            <ion-label>Settings</ion-label>
          </ion-tab-button>
        </ion-tab-bar>
      </ion-tabs>
    </ion-app>
  `,
})
export class ShellComponent {}
