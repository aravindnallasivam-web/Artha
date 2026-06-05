import { Component, OnInit, inject, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { AccountMapping, CategoryMapping, SmsCaptureService } from './sms-capture.service';

/**
 * Shows what SMS capture has learned: which messages map to which account, and
 * which merchants map to which category. Each rule can be forgotten so the next
 * matching SMS asks again.
 */
@Component({
  selector: 'artha-sms-mappings',
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
    IonListHeader,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Learned mappings</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="done()">Done</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else if (accounts().length === 0 && categories().length === 0) {
        <p class="empty">Nothing learned yet. As you confirm detected expenses, Artha
          remembers which account and category you picked and shows the rules here.</p>
      } @else {
        @if (accounts().length > 0) {
          <ion-list inset="true">
            <ion-list-header><ion-label>Accounts</ion-label></ion-list-header>
            @for (m of accounts(); track m.key) {
              <ion-item>
                <ion-label class="ion-text-wrap">
                  <h3>{{ m.label }}</h3>
                  <p>→ {{ m.accountName }}</p>
                </ion-label>
                <ion-button slot="end" fill="clear" color="medium"
                  [attr.aria-label]="'Forget ' + m.label" (click)="removeAccount(m.key)">
                  <ion-icon name="trash" slot="icon-only"></ion-icon>
                </ion-button>
              </ion-item>
            }
          </ion-list>
        }

        @if (categories().length > 0) {
          <ion-list inset="true">
            <ion-list-header><ion-label>Categories</ion-label></ion-list-header>
            @for (m of categories(); track m.key) {
              <ion-item>
                <ion-label class="ion-text-wrap">
                  <h3>{{ m.merchant }}</h3>
                  <p>→ {{ m.categoryName }}</p>
                </ion-label>
                <ion-button slot="end" fill="clear" color="medium"
                  [attr.aria-label]="'Forget ' + m.merchant" (click)="removeCategory(m.key)">
                  <ion-icon name="trash" slot="icon-only"></ion-icon>
                </ion-button>
              </ion-item>
            }
          </ion-list>
        }

        <ion-note class="hint">
          Forgetting a rule makes the next matching message ask which account or
          category to use again.
        </ion-note>
      }
    </ion-content>
  `,
  styles: [`
    .state { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; color: var(--artha-text-subtle); padding: 40px 16px; line-height: 1.5; }
    .hint { display: block; padding: 8px 16px 24px; font-size: 12px; color: var(--artha-text-subtle); }
    ion-label h3 { font-size: 15px; font-weight: 600; }
    ion-label p { color: var(--artha-text-muted); }
  `],
})
export class SmsMappingsModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly sms = inject(SmsCaptureService);

  protected readonly accounts = signal<AccountMapping[]>([]);
  protected readonly categories = signal<CategoryMapping[]>([]);
  protected readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    // Account/category names come from their stores; make sure they're loaded.
    await this.sms.loadReferenceData();
    this.refresh();
    this.loading.set(false);
  }

  protected removeAccount(key: string): void {
    this.sms.forgetAccountMapping(key);
    this.refresh();
  }

  protected removeCategory(key: string): void {
    this.sms.forgetCategoryMapping(key);
    this.refresh();
  }

  protected done(): void {
    void this.modalCtrl.dismiss();
  }

  private refresh(): void {
    this.accounts.set(this.sms.accountMappings());
    this.categories.set(this.sms.categoryMappings());
  }
}
