import { CurrencyPipe } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import {
  ActionSheetController,
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonSkeletonText,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { Expense } from '../../core/models/expense.model';
import { CategoriesStore } from '../categories/categories.store';
import { CategorySearchModal } from '../categories/category-search.modal';
import { SmsCaptureService } from './sms-capture.service';
import { SmsConfirmModal } from './sms-confirm.modal';
import { ParsedExpense } from './sms-parser';

/** A detected SMS expense as shown (and edited) in the bulk review list. */
export interface SmsCandidateRow {
  parsed: ParsedExpense;
  selected: boolean;
  amount: number;
  date: string;
  categoryId: string;
  accountId: string;
  note: string | null;
  excluded: boolean;
  /** An already-logged expense this likely duplicates (auto-unselected). */
  duplicate: Expense | null;
  /** Persistent-queue key (queue mode only); lets the caller drop resolved items. */
  key?: string;
}

interface NamedRef {
  id: string;
  name: string;
}

const SWIPE_HINT_KEY = 'artha.sms.swipeHintSeen';

/**
 * Review list for detected SMS expenses (inbox scan + pending queue). Each row
 * is a swipeable card: tap the avatar to select, tap the card to edit, tap a
 * chip to change category / account, swipe left to dismiss (a full swipe
 * dismisses straight away). Returns the selected rows (role 'save') plus any
 * dismissed queue keys; the capture service persists them.
 */
@Component({
  selector: 'artha-sms-bulk-review',
  standalone: true,
  imports: [
    CurrencyPipe,
    IonButton,
    IonButtons,
    IonContent,
    IonFooter,
    IonHeader,
    IonIcon,
    IonItem,
    IonItemOption,
    IonItemOptions,
    IonItemSliding,
    IonSkeletonText,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar class="top">
        <ion-buttons slot="start">
          <ion-button (click)="cancel()" aria-label="Close">
            <ion-icon slot="icon-only" name="close-outline"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ queueMode ? 'Pending expenses' : 'Review SMS expenses' }}</ion-title>
        @if (!loading() && rows().length > 0) {
          <ion-buttons slot="end">
            <ion-button class="link" (click)="toggleAll()">
              {{ allSelected() ? 'Clear' : 'Select all' }}
            </ion-button>
          </ion-buttons>
        }
      </ion-toolbar>
    </ion-header>

    <ion-content class="bg">
      @if (loading()) {
        @if (loadingText) {
          <p class="loading-text">{{ loadingText }}</p>
        }
        <div class="hero skel-hero">
          <ion-skeleton-text [animated]="true" style="width: 40%; height: 14px"></ion-skeleton-text>
          <ion-skeleton-text [animated]="true" style="width: 55%; height: 34px; margin-top: 10px"></ion-skeleton-text>
        </div>
        <div class="list">
          @for (n of skeletonRows; track n) {
            <div class="card skel">
              <ion-skeleton-text [animated]="true" class="sk-avatar"></ion-skeleton-text>
              <div class="main">
                <div class="top-line">
                  <ion-skeleton-text [animated]="true" style="width: 45%"></ion-skeleton-text>
                  <ion-skeleton-text [animated]="true" style="width: 20%"></ion-skeleton-text>
                </div>
                <ion-skeleton-text [animated]="true" style="width: 60%; margin-top: 8px"></ion-skeleton-text>
                <div class="chips">
                  <ion-skeleton-text [animated]="true" style="width: 90px; height: 28px; border-radius: 999px"></ion-skeleton-text>
                  <ion-skeleton-text [animated]="true" style="width: 90px; height: 28px; border-radius: 999px"></ion-skeleton-text>
                </div>
              </div>
            </div>
          }
        </div>
      } @else if (rows().length === 0) {
        <div class="empty">
          <div class="empty-badge"><ion-icon name="checkmark"></ion-icon></div>
          <h2>All caught up</h2>
          <p>No bank expense messages waiting for review.</p>
        </div>
      } @else {
        <section class="hero">
          <div class="hero-label">
            {{ selectedCount() }} of {{ rows().length }} selected
          </div>
          <div class="hero-amount num">
            {{ selectedTotal() | currency: currencyCode() : 'symbol' : '1.0-0' }}
          </div>
          @if (queueMode) {
            <button type="button" class="hero-dismiss" (click)="dismissAll()">Dismiss all</button>
          }
        </section>

        @if (showSwipeHint()) {
          <div class="hint-pill">
            <ion-icon name="chevron-back"></ion-icon>
            Swipe a card left to dismiss it
          </div>
        }

        <div class="list">
          @for (row of rows(); track row.parsed.raw; let i = $index) {
            <ion-item-sliding class="slide" (ionDrag)="onDrag()">
              <ion-item lines="none" class="card-item" [class.off]="!row.selected" [class.dup]="row.duplicate">
                <div class="card">
                  <button
                    type="button"
                    class="avatar"
                    [class.on]="row.selected"
                    [style.--c]="categoryColor(row.categoryId)"
                    [attr.aria-label]="row.selected ? 'Deselect' : 'Select'"
                    (click)="toggleRow($event, i)"
                  >
                    @if (row.selected) {
                      <ion-icon name="checkmark"></ion-icon>
                    } @else {
                      <ion-icon [name]="categoryIcon(row.categoryId)"></ion-icon>
                    }
                  </button>

                  <div class="main" (click)="editRow(i)">
                    <div class="top-line">
                      <span class="merchant">{{ row.note || row.parsed.sender || (row.parsed.type === 'income' ? 'Income' : 'Expense') }}</span>
                      <span class="amount num" [class.income]="row.parsed.type === 'income'">
                        {{ row.parsed.type === 'income' ? '+' : '' }}{{ row.amount | currency: currencyCode() : 'symbol' : '1.0-0' }}
                      </span>
                    </div>
                    <div class="meta">
                      <span>{{ dayLabel(row.date) }}</span>
                      <span class="dot"></span>
                      <span class="sender">{{ row.parsed.sender }}</span>
                      @if (row.duplicate) { <span class="badge">Possible duplicate</span> }
                    </div>
                    <div class="chips">
                      <button type="button" class="chip" [class.empty]="!row.categoryId" (click)="pickCategory($event, i)">
                        <ion-icon name="pricetag-outline"></ion-icon>
                        <span>{{ categoryName(row.categoryId) || 'Category' }}</span>
                      </button>
                      <button type="button" class="chip" [class.empty]="!row.accountId" (click)="pickAccount($event, i)">
                        <ion-icon name="wallet-outline"></ion-icon>
                        <span>{{ accountName(row.accountId) || 'Account' }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </ion-item>

              <ion-item-options side="end" (ionSwipe)="dropRow(i)">
                <ion-item-option class="opt opt-ignore" (click)="ignore($event, i)">
                  <ion-icon slot="top" name="eye-off-outline"></ion-icon>
                  Ignore
                </ion-item-option>
                <ion-item-option class="opt opt-dismiss" expandable (click)="dismissRow($event, i)">
                  <ion-icon slot="top" name="trash-outline"></ion-icon>
                  Dismiss
                </ion-item-option>
              </ion-item-options>
            </ion-item-sliding>
          }
        </div>
        <p class="foot-note">Tap a card to edit date, note or amount. Duplicates start unselected.</p>
      }
    </ion-content>

    @if (!loading() && rows().length > 0) {
      <ion-footer class="ion-no-border">
        <div class="save-bar">
          <button type="button" class="save" [disabled]="selectedCount() === 0" (click)="add()">
            @if (selectedCount() === 0) {
              Select expenses to save
            } @else {
              Save {{ selectedCount() }} expense{{ selectedCount() === 1 ? '' : 's' }}
              <span class="save-amt num">· {{ selectedTotal() | currency: currencyCode() : 'symbol' : '1.0-0' }}</span>
            }
          </button>
        </div>
      </ion-footer>
    }
  `,
  styles: [`
    :host { --background: var(--artha-bg); }
    .bg { --background: var(--artha-bg); }
    .top { --background: var(--artha-bg); }
    .link { --color: var(--artha-accent); font-weight: 600; text-transform: none; }
    .num { font-variant-numeric: tabular-nums; }

    /* Summary hero */
    .hero {
      position: relative;
      margin: 4px 16px 12px;
      padding: 18px 20px;
      border-radius: 20px;
      color: #fff;
      background: var(--artha-accent-hover);
      box-shadow: 0 10px 24px -12px rgba(79, 70, 229, 0.65);
    }
    .hero-label { font-size: 13px; font-weight: 600; opacity: 0.85; }
    .hero-amount { font-size: 32px; font-weight: 800; letter-spacing: -0.02em; margin-top: 4px; }
    .hero-dismiss {
      position: absolute; top: 16px; right: 16px;
      background: rgba(255, 255, 255, 0.18); color: #fff;
      border: 0; border-radius: 999px; padding: 6px 12px;
      font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .skel-hero { background: var(--artha-surface); box-shadow: none; }
    .loading-text { margin: 4px 20px 10px; font-size: 13px; font-weight: 600; color: var(--artha-text-muted); }

    .hint-pill {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      margin: 0 16px 10px; padding: 8px 12px; border-radius: 999px;
      background: var(--artha-accent-tint); color: var(--artha-accent);
      font-size: 12.5px; font-weight: 600;
      animation: nudge 1.6s ease-in-out 2;
    }
    @keyframes nudge { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-6px); } }

    /* Cards */
    .list { display: flex; flex-direction: column; gap: 10px; padding: 0 16px 16px; }
    .slide {
      border-radius: 18px; overflow: hidden;
      box-shadow: var(--artha-shadow-sm);
    }
    .card-item {
      --background: var(--artha-surface);
      --padding-start: 0; --inner-padding-end: 0;
      --min-height: 0;
      border: 1px solid var(--artha-border);
      border-radius: 18px;
      transition: opacity 0.15s ease;
    }
    .card-item.dup { border-color: var(--artha-warning, #f59e0b); }
    .card-item.off .main { opacity: 0.6; }
    .card {
      display: flex; gap: 12px; width: 100%;
      padding: 14px 14px 12px;
    }
    .avatar {
      --c: var(--artha-accent);
      flex: 0 0 auto;
      width: 44px; height: 44px; border-radius: 14px; border: 0;
      display: grid; place-items: center; cursor: pointer;
      font-size: 20px;
      color: var(--c);
      background: color-mix(in srgb, var(--c) 14%, transparent);
      transition: transform 0.12s ease, background 0.15s ease;
    }
    .avatar:active { transform: scale(0.92); }
    .avatar.on { background: var(--artha-accent); color: #fff; }
    .main { flex: 1; min-width: 0; cursor: pointer; transition: opacity 0.15s ease; }
    .top-line { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
    .merchant {
      font-size: 15px; font-weight: 700; color: var(--artha-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .amount { font-size: 16px; font-weight: 800; color: var(--artha-text); flex-shrink: 0; letter-spacing: -0.01em; }
    .amount.income { color: var(--artha-positive); }
    .meta {
      display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
      margin-top: 3px; font-size: 12px; color: var(--artha-text-subtle);
    }
    .meta .sender { font-weight: 600; letter-spacing: 0.02em; }
    .dot { width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: 0.6; }
    .badge {
      padding: 2px 8px; border-radius: 999px;
      font-size: 10.5px; font-weight: 700;
      background: var(--artha-warning-tint, #fef3c7); color: #92400e;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
      padding: 6px 12px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--artha-border);
      background: var(--artha-surface-2); color: var(--artha-text);
      font-size: 12.5px; font-weight: 600;
    }
    .chip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
    .chip ion-icon { font-size: 14px; color: var(--artha-text-muted); flex-shrink: 0; }
    .chip.empty { border-style: dashed; color: var(--artha-text-muted); background: transparent; }

    /* Swipe actions */
    .opt { font-size: 12px; font-weight: 700; text-transform: none; min-width: 84px; }
    .opt ion-icon { font-size: 22px; margin-bottom: 4px; }
    .opt-ignore { --background: var(--artha-text-muted); --color: #fff; }
    .opt-dismiss { --background: var(--artha-negative); --color: #fff; }

    .foot-note { margin: 0; padding: 0 20px 24px; text-align: center; font-size: 12px; color: var(--artha-text-subtle); }

    /* Empty state */
    .empty { display: flex; flex-direction: column; align-items: center; padding: 72px 24px; text-align: center; }
    .empty-badge {
      width: 64px; height: 64px; border-radius: 22px; display: grid; place-items: center;
      background: color-mix(in srgb, var(--artha-positive) 15%, transparent);
      color: var(--artha-positive); font-size: 32px;
    }
    .empty h2 { margin: 16px 0 4px; font-size: 18px; font-weight: 800; color: var(--artha-text); }
    .empty p { margin: 0; color: var(--artha-text-subtle); font-size: 14px; }

    /* Sticky save bar */
    ion-footer { background: var(--artha-bg); }
    .save-bar { padding: 10px 16px calc(12px + env(safe-area-inset-bottom, 0px)); }
    .save {
      width: 100%; height: 52px; border: 0; border-radius: 16px; cursor: pointer;
      background: var(--artha-accent); color: #fff;
      font-size: 15.5px; font-weight: 700;
      box-shadow: 0 8px 20px -10px rgba(79, 70, 229, 0.8);
      transition: transform 0.1s ease, opacity 0.15s ease;
    }
    .save:active:not([disabled]) { transform: scale(0.98); }
    .save[disabled] { opacity: 0.45; box-shadow: none; cursor: default; }
    .save-amt { opacity: 0.85; font-weight: 600; }

    /* Skeleton */
    .card.skel {
      background: var(--artha-surface); border: 1px solid var(--artha-border); border-radius: 18px;
    }
    .sk-avatar { width: 44px; height: 44px; border-radius: 14px; margin: 0; flex: 0 0 auto; }
    .card.skel ion-skeleton-text { --border-radius: 6px; }
  `],
})
export class SmsBulkReviewModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly sms = inject(SmsCaptureService);

  protected readonly showSwipeHint = signal(readSwipeHint());

  @Input() candidates: SmsCandidateRow[] = [];
  @Input() categories: NamedRef[] = [];
  @Input() accounts: NamedRef[] = [];
  @Input() currency = 'INR';
  /** Queue mode: the list is the persistent pending queue, so rows carry a
      `key` and gain a per-row Dismiss action. */
  @Input() queueMode = false;
  /** Shown under the skeleton while `dataPromise` is loading. */
  @Input() loadingText = '';
  /**
   * Queue path: resolves to the rows + reference data once the (slow) duplicate
   * lookup finishes. Passing this lets the modal open instantly and show a
   * skeleton while the data loads, instead of the caller blocking first.
   */
  @Input() dataPromise?: Promise<{
    candidates: SmsCandidateRow[];
    categories: NamedRef[];
    accounts: NamedRef[];
    currency: string;
  }>;

  protected readonly rows = signal<SmsCandidateRow[]>([]);
  protected readonly categoryOptions = signal<NamedRef[]>([]);
  protected readonly accountOptions = signal<NamedRef[]>([]);
  protected readonly currencyCode = signal('INR');
  protected readonly loading = signal(false);
  protected readonly skeletonRows = [0, 1, 2, 3];
  /** Queue keys the user explicitly dismissed/ignored, returned to the caller
      so they can be dropped from the persistent queue. */
  private readonly dismissedKeys = new Set<string>();

  protected readonly selected = computed(() => this.rows().filter((r) => r.selected));
  protected readonly selectedCount = computed(() => this.selected().length);
  protected readonly selectedTotal = computed(() =>
    this.selected().reduce((sum, r) => sum + r.amount, 0),
  );
  protected readonly allSelected = computed(() =>
    this.rows().length > 0 && this.rows().every((r) => r.selected),
  );

  ngOnInit(): void {
    if (this.dataPromise) {
      this.loading.set(true);
      this.dataPromise
        .then((d) => this.applyData(d))
        .catch(() => undefined)
        .finally(() => this.loading.set(false));
    } else {
      this.applyData({
        candidates: this.candidates,
        categories: this.categories,
        accounts: this.accounts,
        currency: this.currency,
      });
    }
  }

  private applyData(d: {
    candidates: SmsCandidateRow[];
    categories: NamedRef[];
    accounts: NamedRef[];
    currency: string;
  }): void {
    this.rows.set(d.candidates.map((c) => ({ ...c })));
    this.categoryOptions.set(d.categories);
    this.accountOptions.set(d.accounts);
    this.currencyCode.set(d.currency);
  }

  protected toggleRow(event: Event, i: number): void {
    event.stopPropagation();
    this.patch(i, { selected: !this.rows()[i].selected });
  }

  protected toggleAll(): void {
    const next = !this.allSelected();
    this.rows.update((rs) => rs.map((r) => ({ ...r, selected: next })));
  }

  protected categoryName(id: string): string {
    if (!id) return '';
    return this.categoriesStore.pathLabel(id)
      || this.categoryOptions().find((c) => c.id === id)?.name
      || '';
  }

  protected categoryIcon(id: string): string {
    return (id && this.categoriesStore.byId()[id]?.icon) || 'receipt-outline';
  }

  protected categoryColor(id: string): string {
    return (id && this.categoriesStore.byId()[id]?.color) || 'var(--artha-accent)';
  }

  protected accountName(id: string): string {
    return this.accountOptions().find((a) => a.id === id)?.name ?? '';
  }

  /** "Today" / "Yesterday" / "12 Oct" for a YYYY-MM-DD date. */
  protected dayLabel(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
    });
  }

  protected async pickCategory(event: Event, i: number): Promise<void> {
    event.stopPropagation();
    const modal = await this.modalCtrl.create({
      component: CategorySearchModal,
      componentProps: {
        options: this.categoriesStore.pickerOptions(),
        includeNone: false,
        allowCreate: false,
        selectedId: this.rows()[i].categoryId || null,
        title: 'Category',
      },
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<string | null>();
    if (role === 'select' && data) {
      this.patch(i, { categoryId: data, selected: true });
    }
  }

  protected async pickAccount(event: Event, i: number): Promise<void> {
    event.stopPropagation();
    const current = this.rows()[i].accountId;
    const sheet = await this.actionSheetCtrl.create({
      header: 'Account',
      buttons: [
        ...this.accountOptions().map((a) => ({
          text: a.id === current ? `✓  ${a.name}` : a.name,
          handler: () => this.patch(i, { accountId: a.id, selected: true }),
        })),
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /** Hide the swipe hint for good once the user has swiped a card. */
  protected onDrag(): void {
    if (!this.showSwipeHint()) return;
    this.showSwipeHint.set(false);
    try {
      localStorage.setItem(SWIPE_HINT_KEY, '1');
    } catch {
      // Storage unavailable — the hint just shows again next time.
    }
  }

  protected async editRow(i: number): Promise<void> {
    const row = this.rows()[i];
    const modal = await this.modalCtrl.create({
      component: SmsConfirmModal,
      componentProps: {
        parsed: row.parsed,
        duplicate: row.duplicate,
        categoryId: row.categoryId,
        accountId: row.accountId,
        mode: 'edit',
        initialAmount: row.amount,
        initialDate: row.date,
        initialNote: row.note ?? '',
        initialExcluded: row.excluded,
        canDismiss: this.queueMode,
      },
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<Partial<SmsCandidateRow>>();
    if (role === 'edited' && data) {
      this.patch(i, { ...data, selected: true });
    } else if (role === 'dismiss') {
      this.dropRow(i);
    } else if (role === 'ignore') {
      this.ignoreSenderAt(i);
    }
  }

  /** Ignore this sender from now on and drop its rows from the list. */
  protected ignore(event: Event, i: number): void {
    event.stopPropagation();
    this.ignoreSenderAt(i);
  }

  private ignoreSenderAt(i: number): void {
    const sender = this.rows()[i]?.parsed.sender;
    if (!sender) {
      return;
    }
    this.sms.ignoreSender(sender);
    // Drop every currently-shown row from this sender (normalised match), so
    // all routing variants of the same bank disappear immediately too. Their
    // queue keys are dismissed so the backlog clears them as well.
    for (const r of this.rows()) {
      if (r.key && this.sms.isSenderIgnored(r.parsed.sender)) {
        this.dismissedKeys.add(r.key);
      }
    }
    this.rows.update((rs) => rs.filter((r) => !this.sms.isSenderIgnored(r.parsed.sender)));
  }

  /** Drop a single pending item from the queue without logging it. */
  protected dismissRow(event: Event, i: number): void {
    event.stopPropagation();
    this.dropRow(i);
  }

  /** Remove row `i` from the list and mark its queue item to be forgotten. */
  protected dropRow(i: number): void {
    const row = this.rows()[i];
    if (row?.key) {
      this.dismissedKeys.add(row.key);
    }
    this.rows.update((rs) => rs.filter((_, idx) => idx !== i));
  }

  protected cancel(): void {
    // Closing keeps un-acted rows in the queue; only explicit dismissals leave.
    void this.modalCtrl.dismiss({ rows: [], dismissedKeys: [...this.dismissedKeys] }, 'cancel');
  }

  /** Drop every pending item without logging it, so the queue is cleared and
   *  none of these resurface next time. */
  protected async dismissAll(): Promise<void> {
    const count = this.rows().length;
    const alert = await this.alertCtrl.create({
      header: 'Dismiss all?',
      message: `${count} pending expense${count === 1 ? '' : 's'} will be discarded and won't be logged or shown again.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Dismiss all',
          role: 'destructive',
          handler: () => {
            for (const r of this.rows()) {
              if (r.key) this.dismissedKeys.add(r.key);
            }
            void this.modalCtrl.dismiss(
              { rows: [], dismissedKeys: [...this.dismissedKeys] },
              'cancel',
            );
          },
        },
      ],
    });
    await alert.present();
  }

  protected add(): void {
    void this.modalCtrl.dismiss(
      { rows: this.selected(), dismissedKeys: [...this.dismissedKeys] },
      'save',
    );
  }

  private patch(i: number, change: Partial<SmsCandidateRow>): void {
    this.rows.update((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...change } : r)));
  }
}

function readSwipeHint(): boolean {
  try {
    return localStorage.getItem(SWIPE_HINT_KEY) !== '1';
  } catch {
    return true;
  }
}
