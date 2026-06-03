import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { inject } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';

/**
 * Confirm/edit the balance-enquiry SMS before sending. Sending a real text can
 * incur carrier charges, so the destination + message are always shown and the
 * user must tap Send. Returns { to, message } with role 'send'.
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
    IonNote,
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
export class BalanceSyncModal {
  private readonly modalCtrl = inject(ModalController);

  @Input() bankName = 'your bank';
  @Input() to = '';
  @Input() message = '';

  protected canSend(): boolean {
    return this.to.trim().length > 0 && this.message.trim().length > 0;
  }

  protected send(): void {
    if (!this.canSend()) {
      return;
    }
    void this.modalCtrl.dismiss({ to: this.to.trim(), message: this.message.trim() }, 'send');
  }

  protected cancel(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }
}
