import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { Expense } from '../../core/models/expense.model';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { SettingsStore } from '../settings/settings.store';
import { SmsConfirmModal } from './sms-confirm.modal';
import { ParsedExpense } from './sms-parser';
import { SmsCaptureService } from './sms-capture.service';

type Step = 'enable' | 'scan' | 'train' | 'log' | 'done';

interface WizardRow {
  parsed: ParsedExpense;
  accountId: string;
  categoryId: string;
  amount: number;
  date: string;
  note: string | null;
  excluded: boolean;
  trained: boolean;
  selected: boolean;
  inLog: boolean;
  duplicate: Expense | null;
}

interface EditedResult {
  amount: number;
  date: string;
  categoryId: string;
  accountId: string;
  note: string | null;
  excluded: boolean;
}

/**
 * Guided "Train SMS" wizard: ENABLE -> SCAN -> TRAIN (tap a message to teach
 * its account+category) -> LOG (optionally add the scanned transactions) -> DONE.
 * Composes SmsCaptureService primitives and reuses SmsConfirmModal (edit mode)
 * as the per-message editor.
 */
@Component({
  selector: 'artha-sms-training-wizard',
  standalone: true,
  imports: [
    CurrencyPipe,
    IonButton,
    IonButtons,
    IonCheckbox,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonTitle,
    IonToggle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          @if (step() === 'enable' || step() === 'done') {
            <ion-button (click)="close()">{{ step() === 'done' ? '' : 'Close' }}</ion-button>
          } @else {
            <ion-button (click)="back()"><ion-icon slot="icon-only" name="chevron-back"></ion-icon></ion-button>
          }
        </ion-buttons>
        <ion-title>Train SMS</ion-title>
      </ion-toolbar>
      @if (step() !== 'done') {
        <ion-toolbar class="sub">
          <div class="bar">
            <div class="dots">
              @for (n of [1, 2, 3, 4]; track n) {
                <span class="dot" [class.active]="stepIndex() === n"></span>
              }
            </div>
            <span class="stepno">Step {{ stepIndex() }} of 4</span>
          </div>
        </ion-toolbar>
      }
    </ion-header>

    <ion-content class="bg">
      @switch (step()) {
        @case ('enable') {
          <div class="wrap center">
            <div class="big-icon"><ion-icon name="school-outline"></ion-icon></div>
            @if (!supported) {
              <h2>Android only</h2>
              <p class="muted">SMS capture works on Android devices, so training isn't available here.</p>
            } @else {
              <h2>Teach Artha your texts</h2>
              <p class="muted">We scan bank SMS on this device and let you set the right account &amp;
                category for each. Nothing ever leaves your phone.</p>
              @if (!enabled()) {
                <ion-button expand="block" [disabled]="busy()" (click)="enable()">
                  {{ busy() ? 'Enabling…' : 'Enable SMS capture' }}
                </ion-button>
              }
            }
          </div>
        }

        @case ('scan') {
          <div class="wrap">
            <p class="section-label">Scan your messages</p>
            <div class="chips">
              @for (p of presets; track p.days) {
                <button type="button" class="preset" [class.sel]="activePreset() === p.days"
                  (click)="applyPreset(p.days)">{{ p.label }}</button>
              }
            </div>
            <div class="card">
              <div class="date-row"><span>From</span>
                <input type="date" [value]="fromDate()" [max]="today" (change)="onFrom($event)" />
              </div>
              <div class="date-row last"><span>To</span>
                <input type="date" [value]="toDate()" [max]="today" (change)="onTo($event)" />
              </div>
            </div>
            <ion-button expand="block" [disabled]="busy()" (click)="scan()">
              {{ busy() ? 'Scanning…' : 'Scan inbox' }}
            </ion-button>
            @if (scanned()) {
              @if (rows().length > 0) {
                <p class="found"><ion-icon name="checkmark-circle"></ion-icon> {{ rows().length }} transaction(s) found</p>
              } @else {
                <p class="muted">No bank transactions found in this range.</p>
              }
            }
          </div>
        }

        @case ('train') {
          <div class="wrap">
            <p class="section-label">Tap a message to train it</p>
            <p class="muted small">{{ trainedCount() }} trained · {{ selectedCount() }} selected</p>
            <div class="list">
              @for (row of rows(); track row.parsed.raw; let i = $index) {
                <div class="row" [class.row--off]="!row.selected">
                  <ion-checkbox class="pick" [checked]="row.selected" (ionChange)="toggle(i, $event)"></ion-checkbox>
                  <div class="body" (click)="trainRow(i)">
                    <div class="line1">
                      <span class="merchant">{{ row.note || row.parsed.sender }}</span>
                      <span class="amount num" [class.income]="row.parsed.type === 'income'">
                        {{ row.parsed.type === 'income' ? '+' : '' }}{{ row.amount | currency: cur() : 'symbol' : '1.0-0' }}
                      </span>
                    </div>
                    <div class="line2">
                      @if (row.trained) {
                        <ion-icon name="checkmark-circle" class="ok"></ion-icon>
                        {{ accountName(row.accountId) }} · {{ categoryName(row.categoryId) }}
                      } @else {
                        <span class="notset">Not set · tap to train</span>
                      }
                      <button type="button" class="ignore" (click)="ignore($event, i)">Ignore</button>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>
        }

        @case ('log') {
          <div class="wrap">
            <p class="section-label">Add these to your books?</p>
            <p class="muted small">Optional — your mappings are already saved.</p>
            <div class="list">
              @for (row of rows(); track row.parsed.raw; let i = $index) {
                @if (row.inLog) {
                  <div class="row" [class.row--dup]="row.duplicate" [class.row--off]="!row.selected">
                    <ion-checkbox class="pick" [checked]="row.selected" (ionChange)="toggle(i, $event)"></ion-checkbox>
                    <div class="body">
                      <div class="line1">
                        <span class="merchant">{{ row.note || row.parsed.sender }}</span>
                        <span class="amount num" [class.income]="row.parsed.type === 'income'">
                          {{ row.parsed.type === 'income' ? '+' : '' }}{{ row.amount | currency: cur() : 'symbol' : '1.0-0' }}
                        </span>
                      </div>
                      <div class="line2">
                        {{ row.date }}
                        @if (row.duplicate) { <span class="dup">DUPLICATE</span> }
                      </div>
                    </div>
                  </div>
                }
              }
              @if (selectedLogTotal() === 0) {
                <p class="muted">Nothing selected to log — go back to train more, or skip.</p>
              }
            </div>
          </div>
        }

        @case ('done') {
          <div class="wrap center">
            <div class="big-icon ok-bg"><ion-icon name="checkmark-circle"></ion-icon></div>
            <h2>All set</h2>
            <ul class="summary">
              <li>{{ sms.mappingCount() }} mappings learned</li>
              <li>{{ sms.ignoredCount() }} senders ignored</li>
              <li>{{ loggedCount() }} transactions added</li>
            </ul>
            <div class="card">
              <ion-item lines="none">
                <ion-toggle [checked]="autoAdd()" (ionChange)="onAutoAdd($event)"
                  justify="space-between" labelPlacement="start">
                  <ion-label class="ion-text-wrap">
                    <h3>Turn on auto-add</h3>
                    <p>Log known senders automatically, no prompt</p>
                  </ion-label>
                </ion-toggle>
              </ion-item>
            </div>
          </div>
        }
      }
    </ion-content>

    <div class="save-bar">
      @switch (step()) {
        @case ('enable') {
          @if (!supported) {
            <ion-button expand="block" (click)="close()">Close</ion-button>
          } @else {
            <ion-button expand="block" [disabled]="!enabled()" (click)="next()">Next</ion-button>
          }
        }
        @case ('scan') {
          <div class="two">
            <ion-button fill="outline" (click)="back()">Back</ion-button>
            <ion-button [disabled]="rows().length === 0" (click)="next()">Next</ion-button>
          </div>
        }
        @case ('train') {
          <div class="two">
            <ion-button fill="outline" (click)="back()">Back</ion-button>
            <ion-button (click)="next()">Next</ion-button>
          </div>
        }
        @case ('log') {
          <div class="two">
            <ion-button fill="outline" (click)="skipLog()">Skip</ion-button>
            <ion-button [disabled]="busy()" (click)="logSelected()">
              {{ busy() ? 'Adding…' : 'Add ' + selectedLogTotal() }}
            </ion-button>
          </div>
        }
        @case ('done') {
          <ion-button expand="block" (click)="finish()">Done</ion-button>
        }
      }
    </div>
  `,
  styles: [`
    .bg { --background: var(--artha-bg); }
    .sub { --min-height: 40px; }
    .bar { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; }
    .dots { display: flex; gap: 6px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--artha-border-strong); }
    .dot.active { background: var(--artha-accent); }
    .stepno { font-size: 12px; color: var(--artha-text-subtle); font-weight: 600; }

    .wrap { max-width: 600px; margin: 0 auto; padding: 14px 16px; }
    .wrap.center { text-align: center; padding-top: 32px; }
    .center h2 { margin: 18px 0 8px; font-size: 19px; font-weight: 800; color: var(--artha-text); }
    .muted { color: var(--artha-text-muted); font-size: 14px; line-height: 1.5; }
    .muted.small { font-size: 12.5px; margin: 2px 0 10px; }
    .big-icon {
      width: 72px; height: 72px; margin: 0 auto; border-radius: 20px;
      display: flex; align-items: center; justify-content: center;
      background: var(--artha-accent-tint); color: var(--artha-accent);
    }
    .big-icon ion-icon { font-size: 38px; }
    .ok-bg { background: var(--artha-positive-tint); color: var(--artha-positive); }
    .summary { list-style: none; margin: 16px auto 4px; padding: 0; display: inline-block; text-align: left; }
    .summary li { font-size: 14px; color: var(--artha-text); margin: 6px 0; }
    .summary li::before { content: '• '; color: var(--artha-accent); }

    .section-label {
      font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
      color: var(--artha-text-subtle); margin: 4px 0 10px;
    }
    .found { color: var(--artha-positive); font-weight: 600; font-size: 13.5px; display: flex; align-items: center; gap: 6px; margin-top: 12px; }

    .chips { display: flex; gap: 8px; margin-bottom: 12px; }
    .preset {
      border: 1px solid var(--artha-border); background: var(--artha-surface);
      color: var(--artha-text-muted); font-size: 13px; font-weight: 600;
      padding: 8px 16px; border-radius: 999px; cursor: pointer;
    }
    .preset.sel { background: var(--artha-accent); border-color: var(--artha-accent); color: #fff; }

    .card {
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius); box-shadow: var(--artha-shadow-sm); overflow: hidden;
      margin-bottom: 14px;
    }
    .card ion-item { --background: transparent; }
    .card h3 { margin: 0; font-size: 14px; font-weight: 600; }
    .card p { margin: 2px 0 0; font-size: 12px; color: var(--artha-text-muted); }
    .date-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--artha-border); }
    .date-row.last { border-bottom: 0; }
    .date-row span { font-size: 13px; color: var(--artha-text-muted); }
    .date-row input { border: 0; background: transparent; color: var(--artha-text); font-size: 15px; font-family: inherit; text-align: right; }

    /* List (adapted from bulk-review) */
    .list { display: flex; flex-direction: column; gap: 8px; }
    .row {
      display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px;
      background: var(--artha-surface); border: 1px solid var(--artha-border);
      border-radius: 12px; box-shadow: var(--artha-shadow-sm);
    }
    .row--off { opacity: 0.55; }
    .row--dup { border-color: var(--artha-warning); }
    .pick { flex-shrink: 0; margin-top: 2px; }
    .body { flex: 1; min-width: 0; cursor: pointer; }
    .line1 { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    .merchant { font-size: 14px; font-weight: 700; color: var(--artha-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .amount { font-size: 14px; font-weight: 700; color: var(--artha-text); flex-shrink: 0; }
    .amount.income { color: var(--artha-positive); }
    .line2 { margin-top: 3px; font-size: 12px; color: var(--artha-text-subtle); display: flex; align-items: center; gap: 8px; }
    .line2 .ok { color: var(--artha-positive); font-size: 14px; }
    .notset { color: var(--artha-warning); font-weight: 600; }
    .dup { font-size: 10px; font-weight: 700; color: #92400e; background: var(--artha-warning-tint, #fef3c7); padding: 1px 6px; border-radius: 4px; }
    .ignore { margin-left: auto; background: none; border: 0; padding: 0; cursor: pointer; color: var(--artha-negative); font-size: 12px; font-weight: 600; }

    /* Sticky footer */
    .save-bar {
      position: sticky; bottom: 0; background: var(--artha-bg);
      box-shadow: 0 -1px 0 var(--artha-border); padding: 12px 16px 14px;
      max-width: 600px; margin: 0 auto;
    }
    .two { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; }
  `],
})
export class SmsTrainingWizardModal implements OnInit {
  protected readonly sms = inject(SmsCaptureService);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly accountsStore = inject(AccountsStore);
  private readonly settingsStore = inject(SettingsStore);
  private readonly notifier = inject(ConflictNotifierService);
  private readonly modalCtrl = inject(ModalController);

  protected readonly supported = this.sms.isSupported();
  protected readonly enabled = signal(this.sms.isEnabled());
  protected readonly autoAdd = signal(this.sms.isAutoAddEnabled());

  protected readonly step = signal<Step>('enable');
  protected readonly busy = signal(false);
  protected readonly scanned = signal(false);
  protected readonly rows = signal<WizardRow[]>([]);
  protected readonly loggedCount = signal(0);

  protected readonly presets = [
    { days: 7, label: 'Last 7d' },
    { days: 30, label: 'Last 30d' },
    { days: 90, label: 'Last 90d' },
  ];
  protected readonly activePreset = signal(30);
  protected readonly fromDate = signal('');
  protected readonly toDate = signal('');
  protected readonly today = iso(new Date());

  protected readonly stepIndex = computed(() => {
    switch (this.step()) {
      case 'enable': return 1;
      case 'scan': return 2;
      case 'train': return 3;
      default: return 4; // log
    }
  });
  protected readonly trainedCount = computed(() => this.rows().filter((r) => r.trained).length);
  protected readonly selectedCount = computed(() => this.rows().filter((r) => r.selected).length);
  protected readonly selectedLogTotal = computed(
    () => this.rows().filter((r) => r.inLog && r.selected).length,
  );

  ngOnInit(): void {
    this.applyPreset(30);
  }

  protected cur(): string {
    return this.settingsStore.currency() || 'USD';
  }

  protected accountName(id: string): string {
    return this.accountsStore.byId()[id]?.name ?? '—';
  }

  protected categoryName(id: string): string {
    return this.categoriesStore.byId()[id]?.name ?? '—';
  }

  // ── Step navigation ───────────────────────────────────────────────────────
  protected next(): void {
    const s = this.step();
    if (s === 'enable') this.step.set('scan');
    else if (s === 'scan') this.step.set('train');
    else if (s === 'train') {
      this.step.set('log');
      void this.enterLog();
    }
  }

  protected back(): void {
    const s = this.step();
    if (s === 'scan') this.step.set('enable');
    else if (s === 'train') this.step.set('scan');
    else if (s === 'log') this.step.set('train');
  }

  protected close(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }

  protected finish(): void {
    void this.modalCtrl.dismiss({ logged: this.loggedCount() }, 'done');
  }

  // ── ENABLE ────────────────────────────────────────────────────────────────
  protected async enable(): Promise<void> {
    this.busy.set(true);
    try {
      const ok = await this.sms.enable();
      if (ok) {
        this.enabled.set(true);
        this.step.set('scan');
      } else {
        await this.notifier.notifyError('SMS permission denied — training needs it.');
      }
    } finally {
      this.busy.set(false);
    }
  }

  // ── SCAN ──────────────────────────────────────────────────────────────────
  protected applyPreset(days: number): void {
    this.activePreset.set(days);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    this.fromDate.set(iso(from));
    this.toDate.set(iso(to));
  }

  protected onFrom(event: Event): void {
    this.fromDate.set((event.target as HTMLInputElement).value);
    this.activePreset.set(0);
  }

  protected onTo(event: Event): void {
    this.toDate.set((event.target as HTMLInputElement).value);
    this.activePreset.set(0);
  }

  protected async scan(): Promise<void> {
    this.busy.set(true);
    try {
      const parsed = await this.sms.scanRange(this.fromDate(), this.toDate());
      this.rows.set(parsed.map((p) => this.toRow(p)));
      this.scanned.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  private toRow(p: ParsedExpense): WizardRow {
    const d = this.sms.rowDefaults(p);
    const trained = !!(d.learnedAccountId && d.learnedCategoryId);
    return {
      parsed: p,
      accountId: d.accountId,
      categoryId: d.categoryId,
      amount: p.amount,
      date: p.date,
      note: p.merchant ?? p.sender ?? null,
      excluded: false,
      trained,
      selected: trained,
      inLog: false,
      duplicate: null,
    };
  }

  // ── TRAIN ─────────────────────────────────────────────────────────────────
  protected toggle(i: number, event: Event): void {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail.checked;
    this.update(i, { selected: checked });
  }

  protected ignore(event: Event, i: number): void {
    event.stopPropagation();
    const sender = this.rows()[i]?.parsed.sender;
    if (!sender) return;
    this.sms.ignoreSender(sender);
    this.rows.update((rs) => rs.filter((r) => !this.sms.isSenderIgnored(r.parsed.sender)));
  }

  protected async trainRow(i: number): Promise<void> {
    const r = this.rows()[i];
    const modal = await this.modalCtrl.create({
      component: SmsConfirmModal,
      componentProps: {
        parsed: r.parsed,
        duplicate: null,
        categoryId: r.categoryId,
        accountId: r.accountId,
        mode: 'edit',
        initialAmount: r.amount,
        initialDate: r.date,
        initialNote: r.note ?? '',
        initialExcluded: r.excluded,
        canDismiss: false,
      },
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<EditedResult>();
    if (role === 'edited' && data) {
      this.sms.setMapping(r.parsed, data.accountId, data.categoryId);
      this.update(i, {
        accountId: data.accountId,
        categoryId: data.categoryId,
        amount: data.amount,
        date: data.date,
        note: data.note,
        excluded: data.excluded,
        trained: true,
        selected: true,
      });
      this.recomputeUntrained();
    } else if (role === 'ignore') {
      this.sms.ignoreSender(r.parsed.sender);
      this.rows.update((rs) => rs.filter((row) => !this.sms.isSenderIgnored(row.parsed.sender)));
    }
  }

  /** After learning a mapping, reflect it on the other not-yet-trained rows. */
  private recomputeUntrained(): void {
    this.rows.update((rs) =>
      rs.map((r) => {
        if (r.trained) return r;
        const d = this.sms.rowDefaults(r.parsed);
        return {
          ...r,
          accountId: d.accountId,
          categoryId: d.categoryId,
          trained: !!(d.learnedAccountId && d.learnedCategoryId),
        };
      }),
    );
  }

  // ── LOG ───────────────────────────────────────────────────────────────────
  private async enterLog(): Promise<void> {
    // Snapshot which rows are candidates for logging (the selected ones).
    this.rows.update((rs) => rs.map((r) => ({ ...r, inLog: r.selected })));
    const candidates = this.rows().filter((r) => r.inLog && r.categoryId && r.accountId);
    if (candidates.length === 0) return;
    const dupes = await this.sms.findDuplicates(candidates.map((r) => r.parsed));
    this.rows.update((rs) =>
      rs.map((r) => {
        if (!r.inLog) return r;
        const dup = dupes.get(r.parsed) ?? null;
        return { ...r, duplicate: dup, selected: r.selected && !dup };
      }),
    );
  }

  protected skipLog(): void {
    this.loggedCount.set(0);
    this.step.set('done');
  }

  protected async logSelected(): Promise<void> {
    this.busy.set(true);
    try {
      const toLog = this.rows().filter(
        (r) => r.inLog && r.selected && r.categoryId && r.accountId && r.amount > 0,
      );
      const balanced = new Set<string>();
      let saved = 0;
      for (const r of toLog) {
        const ok = await this.sms.logTrained(
          r.parsed,
          {
            categoryId: r.categoryId,
            accountId: r.accountId,
            amount: r.amount,
            date: r.date,
            note: r.note,
            excluded: r.excluded,
          },
          { skipBalance: balanced.has(r.accountId) },
        );
        if (ok) {
          saved++;
          if (r.parsed.balance != null) balanced.add(r.accountId);
        }
      }
      this.loggedCount.set(saved);
      this.step.set('done');
    } finally {
      this.busy.set(false);
    }
  }

  // ── DONE ──────────────────────────────────────────────────────────────────
  protected onAutoAdd(event: Event): void {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail.checked;
    this.sms.setAutoAdd(checked);
    this.autoAdd.set(checked);
  }

  private update(i: number, change: Partial<WizardRow>): void {
    this.rows.update((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...change } : r)));
  }
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
