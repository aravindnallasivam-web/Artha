import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
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
  ModalController,
} from '@ionic/angular/standalone';
import { GoogleAuthService } from '../../core/auth/google-auth.service';
import { SessionService } from '../../core/auth/session.service';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { environment } from '../../../environments/environment';
import { SUPPORTED_CURRENCIES } from '../../core/models/settings.model';
import { SmsCaptureService } from '../sms/sms-capture.service';
import { SmsIgnoredSendersModal } from '../sms/sms-ignored-senders.modal';
import { SmsMappingsModal } from '../sms/sms-mappings.modal';
import { SettingsStore } from './settings.store';

@Component({
  selector: 'artha-settings',
  standalone: true,
  imports: [
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

    <ion-content>
      @if (store.loading()) {
        <div class="loading"><ion-spinner></ion-spinner></div>
      } @else {
        <ion-list inset="true">
          <ion-list-header><ion-label>Preferences</ion-label></ion-list-header>
          <ion-item lines="none">
            <ion-select
              label="Currency"
              labelPlacement="stacked"
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
                labelPlacement="start"
                justify="space-between"
                [checked]="smsEnabled()"
                [disabled]="smsBusy()"
                (ionChange)="onSmsToggle($event)"
              >
                <ion-label class="ion-text-wrap">
                  <h2>Capture expenses from SMS</h2>
                  <p>Confirm bank debits as expenses — with a notification when Artha is closed.</p>
                </ion-label>
              </ion-toggle>
            </ion-item>
            @if (smsEnabled()) {
              <ion-item>
                <ion-toggle
                  labelPlacement="start"
                  justify="space-between"
                  [checked]="smsAutoAdd()"
                  (ionChange)="onAutoAddToggle($event)"
                >
                  <ion-label class="ion-text-wrap">
                    <h2>Auto-add known expenses</h2>
                    <p>When the vendor's category and account are already learned, log it
                      automatically and just notify you — no approval needed.</p>
                  </ion-label>
                </ion-toggle>
              </ion-item>
            }
            @if (sms.pendingCount() > 0) {
              <ion-item button detail="false" [disabled]="smsBusy()" (click)="reviewPending()">
                <ion-icon name="list-outline" slot="start" color="medium"></ion-icon>
                <ion-label>Pending expenses</ion-label>
                <ion-note slot="end" color="primary">{{ sms.pendingCount() }}</ion-note>
              </ion-item>
            }
            <ion-item button detail="false" [disabled]="smsBusy()" (click)="scanSms()">
              <ion-icon name="search-outline" slot="start" color="medium"></ion-icon>
              <ion-label>Scan recent messages</ion-label>
              @if (smsBusy()) { <ion-spinner slot="end"></ion-spinner> }
            </ion-item>
            @if (smsMappingCount() > 0) {
              <ion-item button (click)="manageMappings()">
                <ion-icon name="git-merge-outline" slot="start" color="medium"></ion-icon>
                <ion-label>Learned mappings</ion-label>
                <ion-note slot="end">{{ smsMappingCount() }}</ion-note>
              </ion-item>
            }
            @if (smsIgnoredCount() > 0) {
              <ion-item button (click)="manageIgnored()">
                <ion-icon name="close-outline" slot="start" color="medium"></ion-icon>
                <ion-label>Ignored senders</ion-label>
                <ion-note slot="end">{{ smsIgnoredCount() }}</ion-note>
              </ion-item>
            }
            <ion-item lines="none" class="footnote">
              <ion-label class="ion-text-wrap">
                <ion-note color="medium">
                  Reads bank SMS on this device only — messages are never uploaded.
                </ion-note>
              </ion-label>
            </ion-item>
          </ion-list>
        }

        <ion-list inset="true">
          <ion-list-header><ion-label>Account</ion-label></ion-list-header>
          @if (session.currentUser(); as user) {
            <ion-item lines="full">
              <ion-icon name="person-circle-outline" slot="start" color="medium" class="avatar"></ion-icon>
              <ion-label class="ion-text-wrap">
                <h2>{{ user.name }}</h2>
                <p>{{ user.email }}</p>
              </ion-label>
            </ion-item>
          }
          <ion-item button detail="false" (click)="signOut()">
            <ion-icon name="log-out-outline" slot="start" color="danger"></ion-icon>
            <ion-label color="danger">Sign out</ion-label>
          </ion-item>
        </ion-list>

        <ion-list inset="true">
          <ion-list-header><ion-label>About</ion-label></ion-list-header>
          <ion-item lines="none">
            <ion-icon name="information-circle-outline" slot="start" color="medium"></ion-icon>
            <ion-label>Version</ion-label>
            <ion-note slot="end">{{ appVersion() }}</ion-note>
          </ion-item>
        </ion-list>
      }
    </ion-content>
  `,
  styles: [`
    .loading {
      display: flex; align-items: center; justify-content: center; padding: 48px;
    }
    ion-list-header ion-label {
      font-size: 13px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.4px; color: var(--ion-color-medium);
    }
    .footnote { --min-height: 0; }
    .footnote ion-note { font-size: 12.5px; line-height: 1.45; }
    .avatar { font-size: 34px; }
    h2 { font-weight: 600; }
  `],
})
export class SettingsPage implements OnInit {
  protected readonly store = inject(SettingsStore);
  protected readonly session = inject(SessionService);
  protected readonly sms = inject(SmsCaptureService);
  private readonly googleAuth = inject(GoogleAuthService);
  private readonly router = inject(Router);
  private readonly notifier = inject(ConflictNotifierService);
  private readonly modalCtrl = inject(ModalController);

  protected readonly currencies = SUPPORTED_CURRENCIES;
  protected readonly smsEnabled = signal(false);
  protected readonly smsBusy = signal(false);
  protected readonly smsIgnoredCount = signal(0);
  protected readonly smsMappingCount = signal(0);
  protected readonly smsAutoAdd = signal(true);
  protected readonly appVersion = signal(environment.version);

  ngOnInit(): void {
    void this.store.load();
    this.smsEnabled.set(this.sms.isEnabled());
    this.smsIgnoredCount.set(this.sms.ignoredCount());
    this.smsMappingCount.set(this.sms.mappingCount());
    this.smsAutoAdd.set(this.sms.isAutoAddEnabled());
    void this.loadVersion();
  }

  /** On a device, show the real installed version + build number. */
  private async loadVersion(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      const info = await App.getInfo();
      this.appVersion.set(`${info.version} (build ${info.build})`);
    } catch {
      // Keep the web fallback from the environment.
    }
  }

  onAutoAddToggle(event: Event): void {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail.checked;
    this.sms.setAutoAdd(checked);
    this.smsAutoAdd.set(checked);
  }

  async manageMappings(): Promise<void> {
    const modal = await this.modalCtrl.create({ component: SmsMappingsModal });
    await modal.present();
    await modal.onWillDismiss();
    this.smsMappingCount.set(this.sms.mappingCount());
  }

  async manageIgnored(): Promise<void> {
    const modal = await this.modalCtrl.create({ component: SmsIgnoredSendersModal });
    await modal.present();
    await modal.onWillDismiss();
    this.smsIgnoredCount.set(this.sms.ignoredCount());
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
      this.smsIgnoredCount.set(this.sms.ignoredCount());
    }
  }

  /** Open the persistent queue of detected-but-unattended expenses. */
  async reviewPending(): Promise<void> {
    await this.sms.reviewPending();
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
