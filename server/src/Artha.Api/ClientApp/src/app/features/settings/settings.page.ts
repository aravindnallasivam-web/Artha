import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { GoogleAuthService } from '../../core/auth/google-auth.service';
import { SessionService } from '../../core/auth/session.service';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { SUPPORTED_CURRENCIES } from '../../core/models/settings.model';
import { SettingsStore } from './settings.store';

@Component({
  selector: 'artha-settings',
  standalone: true,
  imports: [
    IonButton,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonListHeader,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Settings</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (store.loading()) {
        <ion-spinner></ion-spinner>
      } @else {
        <ion-list inset="true">
          <ion-list-header><ion-label>Preferences</ion-label></ion-list-header>
          <ion-item>
            <ion-select
              label="Currency"
              labelPlacement="floating"
              [value]="store.currency()"
              interface="popover"
              (ionChange)="onCurrencyChange($event)"
            >
              @for (c of currencies; track c.code) {
                <ion-select-option [value]="c.code">{{ c.label }}</ion-select-option>
              }
            </ion-select>
          </ion-item>
        </ion-list>

        <ion-list inset="true">
          <ion-list-header><ion-label>Account</ion-label></ion-list-header>
          @if (session.currentUser(); as user) {
            <ion-item>
              <ion-label>
                <h2>{{ user.name }}</h2>
                <p>{{ user.email }}</p>
              </ion-label>
            </ion-item>
          }
          <ion-item>
            <ion-button slot="end" fill="clear" color="danger" (click)="signOut()">
              <ion-icon name="log-out-outline" slot="start"></ion-icon>
              Sign out
            </ion-button>
          </ion-item>
        </ion-list>
      }
    </ion-content>
  `,
})
export class SettingsPage implements OnInit {
  protected readonly store = inject(SettingsStore);
  protected readonly session = inject(SessionService);
  private readonly googleAuth = inject(GoogleAuthService);
  private readonly router = inject(Router);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly currencies = SUPPORTED_CURRENCIES;

  ngOnInit(): void {
    void this.store.load();
  }

  async onCurrencyChange(event: Event): Promise<void> {
    const value = (event as CustomEvent<{ value: string }>).detail?.value;
    if (!value || value === this.store.currency()) {
      return;
    }
    try {
      await this.store.update({ currency: value });
      await this.notifier.notifyInfo(`Currency changed to ${value}.`);
    } catch (err) {
      await this.notifier.notifyError('Could not update currency.');
    }
  }

  async signOut(): Promise<void> {
    await this.googleAuth.logout();
    await this.router.navigate(['/login']);
  }
}
