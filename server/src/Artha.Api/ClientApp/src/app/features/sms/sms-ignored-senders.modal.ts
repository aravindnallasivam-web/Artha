import { Component, inject, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { SmsCaptureService } from './sms-capture.service';

/** Manage the SMS ignored-sender blocklist: view and un-ignore senders. */
@Component({
  selector: 'artha-sms-ignored-senders',
  standalone: true,
  imports: [
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonNote,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Ignored senders</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="done()">Done</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (senders().length === 0) {
        <p class="empty">No ignored senders.</p>
      } @else {
        <ion-list inset="true">
          @for (s of senders(); track s) {
            <ion-item>
              <ion-label>{{ s }}</ion-label>
              <ion-button slot="end" fill="clear" color="medium" (click)="remove(s)">
                <ion-icon name="trash" slot="icon-only"></ion-icon>
              </ion-button>
            </ion-item>
          }
        </ion-list>
        <ion-note class="hint">These senders are skipped from scanning and live capture.</ion-note>
      }
    </ion-content>
  `,
  styles: [`
    .empty { text-align: center; color: var(--artha-text-subtle); padding: 40px 16px; }
    .hint { display: block; padding: 8px 16px; font-size: 12px; color: var(--artha-text-subtle); }
  `],
})
export class SmsIgnoredSendersModal {
  private readonly modalCtrl = inject(ModalController);
  private readonly sms = inject(SmsCaptureService);

  protected readonly senders = signal<string[]>(this.sms.ignoredSenders());

  protected remove(sender: string): void {
    this.sms.unignoreSender(sender);
    this.senders.set(this.sms.ignoredSenders());
  }

  protected done(): void {
    void this.modalCtrl.dismiss();
  }
}
