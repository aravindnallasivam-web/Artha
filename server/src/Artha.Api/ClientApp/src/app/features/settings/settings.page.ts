import { Component, OnInit, inject, signal } from '@angular/core';
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
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { GoogleAuthService } from '../../core/auth/google-auth.service';
import { SessionService } from '../../core/auth/session.service';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { SUPPORTED_CURRENCIES } from '../../core/models/settings.model';
import { SmsCaptureService } from '../sms/sms-capture.service';
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
    IonNote,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTitle,
    IonToggle,
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

        @if (sms.isSupported()) {
          <ion-list inset="true">
            <ion-list-header><ion-label>Automation</ion-label></ion-list-header>
            <ion-item>
              <ion-toggle
                [checked]="smsEnabled()"
                [disabled]="smsBusy()"
                (ionChange)="onSmsToggle($event)"
              >
                <ion-label>
                  <h2>Capture expenses from SMS</h2>
                  <p>Detect bank debit messages and confirm them as expenses.</p>
                </ion-label>
              </ion-toggle>
            </ion-item>
            <ion-item button [disabled]="smsBusy()" (click)="scanSms()">
              <ion-icon name="search-outline" slot="start"></ion-icon>
              <ion-label>Scan recent messages</ion-label>
              @if (smsBusy()) { <ion-spinner slot="end"></ion-spinner> }
            </ion-item>
            <ion-item lines="none">
              <ion-note>
                Reads bank SMS on this device only — messages are never uploaded.
              </ion-note>
            </ion-item>
          </ion-list>
        }

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
  protected readonly sms = inject(SmsCaptureService);
  private readonly googleAuth = inject(GoogleAuthService);
  private readonly router = inject(Router);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly currencies = SUPPORTED_CURRENCIES;
  protected readonly smsEnabled = signal(false);
  protected readonly smsBusy = signal(false);

  ngOnInit(): void {
    void this.store.load();
    this.smsEnabled.set(this.sms.isEnabled());
  }

  async onSmsToggle(event: Event): Promise<void> {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail?.checked;
    if (checked === this.smsEnabled()) {
      return;
    }
    this.smsBusy.set(true);
    try {
      if (checked) {
        const granted = await this.sms.enable();
        this.smsEnabled.set(granted);
        await (granted
          ? this.notifier.notifyInfo('SMS capture on. New bank messages will prompt to log.')
          : this.notifier.notifyError('SMS permission denied — capture stays off.'));
      } else {
        await this.sms.disable();
        this.smsEnabled.set(false);
        await this.notifier.notifyInfo('SMS capture turned off.');
      }
    } finally {
      this.smsBusy.set(false);
    }
  }

  async scanSms(): Promise<void> {
    this.smsBusy.set(true);
    try {
      const count = await this.sms.scanInbox();
      if (count === 0) {
        await this.notifier.notifyInfo('No recent bank expense messages found.');
      }
    } catch {
      await this.notifier.notifyError('Could not scan messages.');
    } finally {
      this.smsBusy.set(false);
    }
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
