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
  IonNote,
  IonSegment,
  IonSegmentButton,
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
import { AppLockService } from '../../core/security/app-lock.service';
import { ThemeService, ThemePreference } from '../../core/theme/theme.service';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { environment } from '../../../environments/environment';
import { SUPPORTED_CURRENCIES } from '../../core/models/settings.model';
import { SmsCaptureService } from '../sms/sms-capture.service';
import { SmsIgnoredSendersModal } from '../sms/sms-ignored-senders.modal';
import { SmsMappingsModal } from '../sms/sms-mappings.modal';
import { SmsTrainingWizardModal } from '../sms/sms-training.wizard.modal';
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
    IonNote,
    IonSegment,
    IonSegmentButton,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTitle,
    IonToggle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>Settings</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (store.loading()) {
        <div class="loading"><ion-spinner></ion-spinner></div>
      } @else {
        @if (session.currentUser(); as user) {
          <section class="profile">
            <div class="avatar">{{ initials(user.name) }}</div>
            <div class="who">
              <h2>{{ user.name }}</h2>
              <p>{{ user.email }}</p>
            </div>
          </section>
        }

        <p class="section-title">Preferences</p>
        <ion-list inset="true" class="card">
          <ion-item lines="none">
            <span class="icon-chip chip-accent" slot="start">
              <ion-icon name="cash-outline"></ion-icon>
            </span>
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

        <p class="section-title">Appearance</p>
        <ion-list inset="true" class="card">
          <ion-item lines="none">
            <span class="icon-chip chip-accent" slot="start">
              <ion-icon name="contrast-outline"></ion-icon>
            </span>
            <ion-label>Theme</ion-label>
          </ion-item>
          <div class="seg-wrap">
            <ion-segment [value]="theme.preference()" (ionChange)="onThemeChange($event)">
              <ion-segment-button value="system">
                <ion-label>System</ion-label>
              </ion-segment-button>
              <ion-segment-button value="light">
                <ion-label>Light</ion-label>
              </ion-segment-button>
              <ion-segment-button value="dark">
                <ion-label>Dark</ion-label>
              </ion-segment-button>
            </ion-segment>
          </div>
        </ion-list>

        @if (appLock.isSupported()) {
          <p class="section-title">Security</p>
          <ion-list inset="true" class="card">
            <ion-item lines="none">
              <span class="icon-chip chip-accent" slot="start">
                <ion-icon name="lock-closed"></ion-icon>
              </span>
              <ion-toggle
                labelPlacement="start"
                justify="space-between"
                [checked]="appLockEnabled()"
                [disabled]="!appLockAvailable()"
                (ionChange)="onAppLockToggle($event)"
              >
                <ion-label class="ion-text-wrap">
                  <h2>App lock</h2>
                  <p>
                    @if (appLockAvailable()) {
                      Require fingerprint, face, or device PIN to open Artha.
                    } @else {
                      Set up a fingerprint, face or screen lock on your device to use this.
                    }
                  </p>
                </ion-label>
              </ion-toggle>
            </ion-item>
          </ion-list>
        }

        @if (sms.isSupported()) {
          <p class="section-title">Automation</p>
          <ion-list inset="true" class="card">
            <ion-item [lines]="smsEnabled() ? 'inset' : 'none'">
              <span class="icon-chip chip-accent" slot="start">
                <ion-icon name="chatbubble-ellipses-outline"></ion-icon>
              </span>
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
              <ion-item lines="none">
                <span class="icon-chip chip-positive" slot="start">
                  <ion-icon name="flash-outline"></ion-icon>
                </span>
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
          </ion-list>

          <ion-list inset="true" class="card">
            @if (sms.pendingCount() > 0) {
              <ion-item button detail="true" [disabled]="smsBusy()" (click)="reviewPending()">
                <span class="icon-chip chip-warning" slot="start">
                  <ion-icon name="hourglass-outline"></ion-icon>
                </span>
                <ion-label>Pending expenses</ion-label>
                <ion-note slot="end" class="pill">{{ sms.pendingCount() }}</ion-note>
              </ion-item>
            }
            <ion-item button detail="true" (click)="trainSms()">
              <span class="icon-chip chip-accent" slot="start">
                <ion-icon name="school-outline"></ion-icon>
              </span>
              <ion-label class="ion-text-wrap">
                <h2>Train SMS recognition</h2>
                <p>Teach it your banks &amp; categories</p>
              </ion-label>
            </ion-item>
            <ion-item button detail="false" [disabled]="smsBusy()" (click)="scanSms()">
              <span class="icon-chip chip-accent" slot="start">
                <ion-icon name="search-outline"></ion-icon>
              </span>
              <ion-label>Scan recent messages</ion-label>
              @if (smsBusy()) { <ion-spinner slot="end"></ion-spinner> }
            </ion-item>
            @if (smsMappingCount() > 0) {
              <ion-item button detail="true" (click)="manageMappings()">
                <span class="icon-chip chip-muted" slot="start">
                  <ion-icon name="git-merge-outline"></ion-icon>
                </span>
                <ion-label>Learned mappings</ion-label>
                <ion-note slot="end">{{ smsMappingCount() }}</ion-note>
              </ion-item>
            }
            @if (smsIgnoredCount() > 0) {
              <ion-item button detail="true" lines="none" (click)="manageIgnored()">
                <span class="icon-chip chip-muted" slot="start">
                  <ion-icon name="close-circle-outline"></ion-icon>
                </span>
                <ion-label>Ignored senders</ion-label>
                <ion-note slot="end">{{ smsIgnoredCount() }}</ion-note>
              </ion-item>
            }
          </ion-list>
          <p class="hint">
            <ion-icon name="lock-closed-outline"></ion-icon>
            Reads bank SMS on this device only — messages are never uploaded.
          </p>
        }

        <p class="section-title">Account</p>
        <ion-list inset="true" class="card">
          <ion-item button detail="false" lines="none" (click)="signOut()">
            <span class="icon-chip chip-danger" slot="start">
              <ion-icon name="log-out-outline"></ion-icon>
            </span>
            <ion-label color="danger">Sign out</ion-label>
          </ion-item>
        </ion-list>

        <p class="version">Artha · {{ appVersion() }}</p>
      }
    </ion-content>
  `,
  styles: [`
    .loading {
      display: flex; align-items: center; justify-content: center; padding: 48px;
    }

    /* Profile hero */
    .profile {
      display: flex; align-items: center; gap: 14px;
      margin: 12px 16px 4px;
      padding: 18px 16px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius-lg);
      box-shadow: var(--artha-shadow-sm);
    }
    .avatar {
      width: 52px; height: 52px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 700; color: #fff; flex-shrink: 0;
      background: linear-gradient(135deg, var(--artha-accent), var(--artha-accent-hover));
    }
    .who { min-width: 0; }
    .who h2 { margin: 0; font-size: 17px; font-weight: 700; color: var(--artha-text); }
    .who p {
      margin: 2px 0 0; font-size: 13px; color: var(--artha-text-muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    /* Section labels */
    .section-title {
      margin: 22px 20px 8px;
      font-size: 12px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--artha-text-subtle);
    }

    /* Cards */
    ion-list.card {
      margin: 0 16px;
      padding: 4px 0;
      border-radius: var(--artha-radius-lg);
      border: 1px solid var(--artha-border);
      box-shadow: var(--artha-shadow-sm);
      overflow: hidden;
      background: var(--artha-surface);
    }
    ion-list.card + ion-list.card { margin-top: 12px; }
    .seg-wrap { padding: 0 14px 12px; }
    .seg-wrap ion-segment { --background: var(--artha-surface-2); }
    ion-list.card ion-item {
      --background: transparent;
      --padding-start: 14px;
      --inner-padding-end: 12px;
      --min-height: 58px;
    }
    ion-item h2 { font-size: 15px; font-weight: 600; margin: 0; }
    ion-item p { margin: 3px 0 0; font-size: 12.5px; line-height: 1.4; color: var(--artha-text-muted); }

    /* Leading icon chips */
    .icon-chip {
      width: 32px; height: 32px; border-radius: 9px;
      display: flex; align-items: center; justify-content: center;
      margin: 0 12px 0 0; flex-shrink: 0;
    }
    .icon-chip ion-icon { font-size: 18px; }
    .chip-accent   { background: var(--artha-accent-tint);   color: var(--artha-accent); }
    .chip-positive { background: var(--artha-positive-tint); color: var(--artha-positive); }
    .chip-danger   { background: var(--artha-negative-tint); color: var(--artha-negative); }
    .chip-warning  { background: rgba(245, 158, 11, 0.15);   color: var(--artha-warning); }
    .chip-muted    { background: var(--artha-surface-2);     color: var(--artha-text-muted); }

    /* Trailing counts */
    ion-note[slot="end"] { font-weight: 600; align-self: center; }
    ion-note.pill {
      background: var(--artha-accent); color: #fff;
      min-width: 22px; height: 22px; padding: 0 7px;
      border-radius: 11px; display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px;
    }

    /* Privacy hint */
    .hint {
      display: flex; align-items: flex-start; gap: 7px;
      margin: 10px 22px 0; font-size: 12.5px; line-height: 1.5;
      color: var(--artha-text-subtle);
    }
    .hint ion-icon { font-size: 14px; margin-top: 2px; flex-shrink: 0; }

    .version {
      margin: 28px 0 10px; text-align: center;
      font-size: 12px; color: var(--artha-text-subtle);
    }
  `],
})
export class SettingsPage implements OnInit {
  protected readonly store = inject(SettingsStore);
  protected readonly session = inject(SessionService);
  protected readonly sms = inject(SmsCaptureService);
  protected readonly appLock = inject(AppLockService);
  protected readonly theme = inject(ThemeService);
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
  protected readonly appLockEnabled = signal(false);
  protected readonly appLockAvailable = signal(false);
  protected readonly appVersion = signal(environment.version);

  /** Up to two uppercased initials for the profile avatar. */
  protected initials(name: string): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0]).join('');
    return letters.toUpperCase() || '?';
  }

  ngOnInit(): void {
    void this.store.load();
    this.smsEnabled.set(this.sms.isEnabled());
    this.smsIgnoredCount.set(this.sms.ignoredCount());
    this.smsMappingCount.set(this.sms.mappingCount());
    this.smsAutoAdd.set(this.sms.isAutoAddEnabled());
    this.appLockEnabled.set(this.appLock.isEnabled());
    void this.appLock.isAvailable().then((a) => this.appLockAvailable.set(a));
    void this.loadVersion();
  }

  /** Toggle the biometric app lock; reflects the real state if auth is cancelled. */
  async onAppLockToggle(event: Event): Promise<void> {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail?.checked ?? false;
    const ok = await this.appLock.setEnabled(checked);
    this.appLockEnabled.set(this.appLock.isEnabled());
    if (checked && !ok) {
      await this.notifier.notifyError('Could not enable app lock — authentication was cancelled.');
    }
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

  async trainSms(): Promise<void> {
    const modal = await this.modalCtrl.create({ component: SmsTrainingWizardModal });
    await modal.present();
    await modal.onWillDismiss();
    // The wizard may enable capture, learn mappings (even without logging),
    // ignore senders, and toggle auto-add — refresh everything it touches.
    this.smsEnabled.set(this.sms.isEnabled());
    this.smsAutoAdd.set(this.sms.isAutoAddEnabled());
    this.smsMappingCount.set(this.sms.mappingCount());
    this.smsIgnoredCount.set(this.sms.ignoredCount());
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

  onThemeChange(event: Event): void {
    const value = (event as CustomEvent<{ value: ThemePreference }>).detail?.value;
    if (value) {
      this.theme.setPreference(value);
    }
  }

  async signOut(): Promise<void> {
    await this.googleAuth.logout();
    await this.router.navigate(['/login']);
  }
}
