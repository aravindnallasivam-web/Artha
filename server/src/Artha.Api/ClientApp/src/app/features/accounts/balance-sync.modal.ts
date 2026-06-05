import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { SimCard, SmsReader } from '../../core/native/sms-reader';

/**
 * Confirm/edit the balance-enquiry SMS before sending. Sending a real text can
 * incur carrier charges, so the destination + message are always shown and the
 * user must tap Send. On dual-SIM phones the user can also choose which SIM
 * sends it. Returns { to, message, subscriptionId } with role 'send'.
 */
@Component({
  selector: 'artha-balance-sync',
  standalone: true,
  imports: [
    FormsModule,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonLabel,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancel()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>Sync balance</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" [disabled]="!canSend()" (click)="send()">Send</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <p class="lead">
        Send a balance-enquiry SMS to <strong>{{ bankName }}</strong>. The balance will update
        automatically when the bank replies.
      </p>

      <ion-item>
        <ion-input
          label="Send to (number)"
          labelPlacement="stacked"
          type="tel"
          inputmode="tel"
          placeholder="e.g. 09223766666"
          [(ngModel)]="to"
        ></ion-input>
      </ion-item>
      <ion-item>
        <ion-input
          label="Message"
          labelPlacement="stacked"
          type="text"
          placeholder="e.g. BAL"
          [(ngModel)]="message"
        ></ion-input>
      </ion-item>

      <!-- SIM picker (dual-SIM phones) -->
      @if (sims().length > 1) {
        <ion-item>
          <ion-select
            label="Send from SIM"
            labelPlacement="stacked"
            interface="action-sheet"
            [(ngModel)]="subscriptionId"
          >
            <ion-select-option [value]="null">Default SIM</ion-select-option>
            @for (s of sims(); track s.subscriptionId) {
              <ion-select-option [value]="s.subscriptionId">{{ simLabel(s) }}</ion-select-option>
            }
          </ion-select>
        </ion-item>
      } @else if (canPickSim() && !phoneGranted()) {
        <ion-item button detail="false" (click)="enableSimChoice()">
          <ion-label class="ion-text-wrap">
            <h3>Send from a specific SIM</h3>
            <p>Allow phone access to choose which SIM sends the SMS</p>
          </ion-label>
          @if (simBusy()) { <ion-spinner slot="end"></ion-spinner> }
        </ion-item>
      }

      <ion-note color="warning" class="warn">
        Verify this is your bank's balance-enquiry number — a normal SMS will be sent and
        carrier charges may apply. Many banks use missed-call or app-only balance instead.
      </ion-note>
    </ion-content>
  `,
  styles: [`
    .lead { margin: 0 0 14px; font-size: 14px; color: var(--artha-text-muted); }
    .warn { display: block; margin-top: 14px; font-size: 12.5px; line-height: 1.45; }
  `],
})
export class BalanceSyncModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  @Input() bankName = 'your bank';
  @Input() to = '';
  @Input() message = '';
  /** Remembered SIM for this account, or null for the default SIM. */
  @Input() subscriptionId: number | null = null;

  protected readonly sims = signal<SimCard[]>([]);
  protected readonly phoneGranted = signal(false);
  protected readonly simBusy = signal(false);
  protected readonly canPickSim = signal(Capacitor.getPlatform() === 'android');

  async ngOnInit(): Promise<void> {
    await this.loadSims();
  }

  protected canSend(): boolean {
    return this.to.trim().length > 0 && this.message.trim().length > 0;
  }

  protected simLabel(s: SimCard): string {
    const name = s.carrierName || s.displayName || '';
    const slot = `SIM ${s.slotIndex + 1}`;
    return name ? `${slot} — ${name}` : slot;
  }

  /** Ask for phone access, then reload the SIM list. */
  protected async enableSimChoice(): Promise<void> {
    this.simBusy.set(true);
    try {
      await SmsReader.requestPhonePermission().catch(() => undefined);
      await this.loadSims();
    } finally {
      this.simBusy.set(false);
    }
  }

  protected send(): void {
    if (!this.canSend()) {
      return;
    }
    void this.modalCtrl.dismiss(
      {
        to: this.to.trim(),
        message: this.message.trim(),
        subscriptionId: this.subscriptionId,
      },
      'send',
    );
  }

  protected cancel(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }

  private async loadSims(): Promise<void> {
    if (!this.canPickSim()) {
      return;
    }
    try {
      const { permissionGranted, sims } = await SmsReader.getSimCards();
      this.phoneGranted.set(permissionGranted);
      this.sims.set(sims ?? []);
      // Drop a remembered SIM that is no longer present (e.g. SIM removed).
      if (this.subscriptionId != null && !sims.some((s) => s.subscriptionId === this.subscriptionId)) {
        this.subscriptionId = null;
      }
    } catch {
      this.phoneGranted.set(false);
      this.sims.set([]);
    }
  }
}
