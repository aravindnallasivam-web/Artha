import { CurrencyPipe } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonIcon,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { Expense } from '../../core/models/expense.model';
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

/**
 * Bulk review for the inbox scan: shows every detected expense in one list so
 * the user can tick which to add, fix the category/account inline, and save them
 * all at once. Returns the selected rows (role 'save'); the capture service
 * persists them and learns the mappings.
 */
@Component({
  selector: 'artha-sms-bulk-review',
  standalone: true,
  imports: [
    CurrencyPipe,
    IonButton,
    IonButtons,
    IonCheckbox,
    IonContent,
    IonHeader,
    IonIcon,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancel()">
            <ion-icon slot="icon-only" name="close-outline"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ queueMode ? 'Pending expenses' : 'Review SMS expenses' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" [disabled]="selectedCount() === 0" (click)="add()">
            Save ({{ selectedCount() }})
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar class="sub">
        <div class="bar">
          <span class="summary">
            {{ rows().length }} found · {{ selectedCount() }} selected ·
            <span class="num">{{ selectedTotal() | currency: currency : 'symbol' : '1.0-0' }}</span>
          </span>
          <button type="button" class="select-all" (click)="toggleAll()">
            <ion-checkbox [checked]="allSelected()" (click)="$event.preventDefault()"></ion-checkbox>
            <span>Select all</span>
          </button>
        </div>
      </ion-toolbar>
    </ion-header>

    <ion-content class="bg">
      @if (rows().length === 0) {
        <p class="empty">No bank expense messages detected.</p>
      } @else {
        <div class="list">
          @for (row of rows(); track row.parsed.raw; let i = $index) {
            <div class="row" [class.row--dup]="row.duplicate" [class.row--off]="!row.selected">
              <ion-checkbox
                class="pick"
                [checked]="row.selected"
                (ionChange)="toggle(i, $event)"
              ></ion-checkbox>

              <div class="body" (click)="editRow(i)">
                <div class="line1">
                  <span class="merchant">{{ row.note || row.parsed.sender || 'Expense' }}</span>
                  <span class="amount num">{{ row.amount | currency: currency : 'symbol' : '1.0-0' }}</span>
                </div>
                <div class="line2">
                  {{ row.date }} · {{ row.parsed.sender }}
                  @if (row.duplicate) { <span class="dup">DUPLICATE</span> }
                  @if (queueMode) {
                    <button type="button" class="dismiss" (click)="dismissRow($event, i)">Dismiss</button>
                  }
                  <button type="button" class="ignore" (click)="ignore($event, i)">Ignore sender</button>
                </div>
              </div>

              <div class="selects">
                <ion-select
                  label="Category"
                  labelPlacement="stacked"
                  interface="action-sheet"
                  [value]="row.categoryId"
                  (ionChange)="setCategory(i, $event)"
                >
                  @for (c of categories; track c.id) {
                    <ion-select-option [value]="c.id">{{ c.name }}</ion-select-option>
                  }
                </ion-select>
                <ion-select
                  label="Account"
                  labelPlacement="stacked"
                  interface="action-sheet"
                  [value]="row.accountId"
                  (ionChange)="setAccount(i, $event)"
                >
                  @for (a of accounts; track a.id) {
                    <ion-select-option [value]="a.id">{{ a.name }}</ion-select-option>
                  }
                </ion-select>
              </div>
            </div>
          }
        </div>
        <ion-note class="hint">
          Tap a row to edit its date, note or exclusion. Duplicates are unticked by default.
          @if (queueMode) { Tick the ones to log and tap Save, or Dismiss the ones you don't want. }
        </ion-note>
      }
    </ion-content>
  `,
  styles: [`
    :host { --background: var(--artha-bg); }
    .bg { --background: var(--artha-bg); }
    .sub { --min-height: 42px; }
    .bar { display: flex; align-items: center; justify-content: space-between; padding: 0 12px; }
    .summary { font-size: 12.5px; color: var(--artha-text-muted); font-weight: 600; }
    .num { font-variant-numeric: tabular-nums; }
    .select-all {
      display: inline-flex; align-items: center; gap: 8px;
      background: none; border: 0; cursor: pointer;
      font-size: 12.5px; font-weight: 600; color: var(--artha-text-muted);
    }
    .select-all ion-checkbox { pointer-events: none; }

    .empty { text-align: center; color: var(--artha-text-subtle); padding: 48px 16px; }
    .list { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
    .row {
      display: grid;
      grid-template-columns: 24px 1fr;
      grid-template-areas: "pick body" "pick selects";
      column-gap: 12px; row-gap: 6px;
      padding: 12px 14px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: 14px;
      box-shadow: var(--artha-shadow-sm);
    }
    .row--dup { border-color: var(--artha-warning, #f59e0b); }
    .row--off { opacity: 0.55; }
    .pick { grid-area: pick; align-self: start; margin-top: 2px; }
    .body { grid-area: body; cursor: pointer; min-width: 0; }
    .line1 { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
    .merchant {
      font-size: 14px; font-weight: 700; color: var(--artha-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .amount { font-size: 14px; font-weight: 700; color: var(--artha-text); flex-shrink: 0; }
    .line2 { margin-top: 2px; font-size: 11.5px; color: var(--artha-text-subtle); }
    .dup {
      margin-left: 6px; padding: 1px 7px; border-radius: 8px;
      font-size: 9px; font-weight: 700; letter-spacing: 0.03em;
      background: var(--artha-warning-tint, #fef3c7); color: #92400e;
    }
    .ignore {
      margin-left: 8px; padding: 0; border: 0; background: none; cursor: pointer;
      font-size: 11px; font-weight: 600; color: var(--artha-negative);
    }
    .dismiss {
      margin-left: 8px; padding: 0; border: 0; background: none; cursor: pointer;
      font-size: 11px; font-weight: 600; color: var(--artha-text-muted);
    }
    .selects { grid-area: selects; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .selects ion-select {
      --padding-start: 10px; --padding-end: 8px;
      border: 1px solid var(--artha-border); border-radius: 10px;
      font-size: 12.5px; max-width: 100%;
    }
    .hint { display: block; padding: 0 16px 24px; font-size: 12px; color: var(--artha-text-subtle); }
  `],
})
export class SmsBulkReviewModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly sms = inject(SmsCaptureService);

  @Input({ required: true }) candidates: SmsCandidateRow[] = [];
  @Input() categories: NamedRef[] = [];
  @Input() accounts: NamedRef[] = [];
  @Input() currency = 'INR';
  /** Queue mode: the list is the persistent pending queue, so rows carry a
      `key` and gain a per-row Dismiss action. */
  @Input() queueMode = false;

  protected readonly rows = signal<SmsCandidateRow[]>([]);
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
    this.rows.set(this.candidates.map((c) => ({ ...c })));
  }

  protected toggle(i: number, event: Event): void {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail?.checked;
    this.patch(i, { selected: !!checked });
  }

  protected toggleAll(): void {
    const next = !this.allSelected();
    this.rows.update((rs) => rs.map((r) => ({ ...r, selected: next })));
  }

  protected setCategory(i: number, event: Event): void {
    this.patch(i, { categoryId: (event as CustomEvent<{ value: string }>).detail.value });
  }

  protected setAccount(i: number, event: Event): void {
    this.patch(i, { accountId: (event as CustomEvent<{ value: string }>).detail.value });
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
      },
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<Partial<SmsCandidateRow>>();
    if (role === 'edited' && data) {
      this.patch(i, { ...data, selected: true });
    }
  }

  /** Ignore this sender from now on and drop its rows from the list. */
  protected ignore(event: Event, i: number): void {
    event.stopPropagation();
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
