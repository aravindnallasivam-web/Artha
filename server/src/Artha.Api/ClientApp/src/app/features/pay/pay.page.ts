import { CurrencyPipe } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { Category } from '../../core/models/category.model';
import { ExpenseLocation } from '../../core/models/expense.model';
import { SmsReader } from '../../core/native/sms-reader';
import { AppLockService } from '../../core/security/app-lock.service';
import { AccountsStore } from '../accounts/accounts.store';
import { CategoriesStore } from '../categories/categories.store';
import { CategorySearchModal } from '../categories/category-search.modal';
import { ExpensesStore } from '../expenses/expenses.store';
import { SmsCaptureService } from '../sms/sms-capture.service';
import {
  UpiOutcome,
  UpiQr,
  buildPayUri,
  parseUpiQr,
  parseUpiResponse,
  payeeNames,
  placeholderName,
  savePayeeName,
} from './upi';

type Step = 'scan' | 'details' | 'paying' | 'confirm' | 'done' | 'failed';

const APP_KEY = 'artha.pay.app';
const ACCOUNT_KEY = 'artha.pay.account';

/**
 * Scan & Pay: read a shop's UPI QR, set amount + category first, pay in the
 * user's UPI app, and the expense is saved on return (with location). The
 * bank's debit SMS for it is then skipped.
 */
@Component({
  selector: 'artha-pay',
  standalone: true,
  imports: [CurrencyPipe, FormsModule, IonBackButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/dashboard" text=""></ion-back-button></ion-buttons>
        <ion-title>Scan &amp; Pay</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="wrap">
        @if (!native) {
          <p class="msg">Scan &amp; Pay opens your UPI app, so it works in the Android app.</p>
        } @else {
          @switch (step()) {
            @case ('scan') {
              <section class="gate">
                <span class="gate-ic"><ion-icon name="qr-code-outline" aria-hidden="true"></ion-icon></span>
                <h2>Scan the shop's UPI QR</h2>
                <p>Set the amount and category here, pay in your UPI app, and the expense is saved when you come back.</p>
                @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
                <button type="button" class="btn btn--primary" (click)="scan()" [disabled]="busy()">
                  <ion-icon name="scan-outline" aria-hidden="true"></ion-icon>Scan QR
                </button>
              </section>
            }

            @case ('details') {
              @if (qr(); as q) {
                <section class="payee">
                  <span class="avatar" aria-hidden="true">{{ initial(note.trim() || headerName()) }}</span>
                  <div class="payee-text">
                    <div class="payee-name">{{ headerName() }}</div>
                    <div class="payee-id">{{ q.pa }}</div>
                  </div>
                  <span class="tag">{{ q.mc ? 'Shop' : 'Person' }}</span>
                </section>
                @if (noQrName() && !note.trim()) {
                  <p class="hint">This QR doesn't carry the shop's name. Type it in <b>Note</b> once and Artha will
                    remember it for this UPI ID.</p>
                }

                <div class="amount">
                  <span class="cur">₹</span>
                  <input #amountBox class="amount-input" type="text" inputmode="decimal" placeholder="0" aria-label="Amount"
                         [style.width.ch]="amountWidth()"
                         [readOnly]="q.am !== null" [ngModel]="amountText" (ngModelChange)="amountText = $event" />
                </div>
                @if (q.am !== null) { <p class="hint center">Amount set by the shop's QR.</p> }

                <div class="section">Category</div>
                <div class="chips">
                  @for (c of quickCats(); track c.id) {
                    <button type="button" class="chip" [class.sel]="categoryId() === c.id" (click)="categoryId.set(c.id)">
                      {{ c.name }}
                    </button>
                  }
                  <button type="button" class="chip chip--more" (click)="moreCategories()">More…</button>
                </div>
                @if (subPath(); as p) { <p class="hint">Selected: <b>{{ p }}</b></p> }
                <label class="remember">
                  <input type="checkbox" [(ngModel)]="remember" />
                  <span>Remember this category for {{ note.trim() || (noQrName() ? 'this shop' : headerName()) }}</span>
                </label>

                <div class="section">Paid from</div>
                <select class="select" [(ngModel)]="accountId" aria-label="Paid from">
                  @for (a of accounts(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
                </select>

                <div class="section">Note</div>
                <input class="select" type="text" [(ngModel)]="note" [placeholder]="noQrName() ? 'Shop name' : q.pn"
                       aria-label="Note" />

                <div class="section">Pay with</div>
                @if (apps().length === 0) {
                  <p class="hint">No UPI app found. Install Google Pay, PhonePe, Paytm or BHIM.</p>
                } @else {
                  <div class="chips">
                    @for (a of apps(); track a.packageName) {
                      <button type="button" class="chip" [class.sel]="app() === a.packageName" (click)="app.set(a.packageName)">
                        {{ a.label }}
                      </button>
                    }
                    <button type="button" class="chip" [class.sel]="app() === ''" (click)="app.set('')">Ask each time</button>
                  </div>
                }

                <p class="loc">
                  <ion-icon name="location-outline" aria-hidden="true"></ion-icon>
                  {{ location() ? 'Location will be saved with it' : locating() ? 'Getting location…' : 'No location' }}
                </p>
                <button type="button" class="btn btn--ghost" (click)="reset()">Scan another QR</button>
                <div class="paybar">
                  @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
                  <button type="button" class="btn btn--primary pay" (click)="pay()" [disabled]="!canPay() || busy()">
                    Pay {{ amount() | currency: 'INR' : 'symbol' : '1.0-2' }}{{ appLabel() ? ' with ' + appLabel() : '' }}
                  </button>
                </div>
              }
            }

            @case ('paying') {
              <div class="state"><ion-spinner></ion-spinner><p>Finish the payment in your UPI app…</p></div>
            }

            @case ('confirm') {
              <section class="gate">
                <span class="gate-ic"><ion-icon name="help-circle-outline" aria-hidden="true"></ion-icon></span>
                <h2>Did the payment go through?</h2>
                <p>Your UPI app didn't say. Check it, then tell Artha.</p>
                <button type="button" class="btn btn--primary" (click)="save('confirmed')" [disabled]="busy()">
                  Yes, paid {{ amount() | currency: 'INR' : 'symbol' : '1.0-2' }}
                </button>
                <button type="button" class="btn" (click)="notPaid()">No, it didn't</button>
              </section>
            }

            @case ('done') {
              <section class="gate">
                <span class="gate-ic gate-ic--ok"><ion-icon name="checkmark-circle" aria-hidden="true"></ion-icon></span>
                <h2>{{ amount() | currency: 'INR' : 'symbol' : '1.0-2' }} to {{ qr()?.pn }}</h2>
                <p>Saved under <b>{{ categoryPath() || 'your category' }}</b>{{ ref() ? ' · UPI ref ' + ref() : '' }}.
                  The bank's SMS for it won't ask again.</p>
                <button type="button" class="btn btn--primary" (click)="reset()">
                  <ion-icon name="scan-outline" aria-hidden="true"></ion-icon>Scan another
                </button>
                <button type="button" class="btn" (click)="router.navigate(['/expenses'])">See expenses</button>
              </section>
            }

            @case ('failed') {
              <section class="gate">
                <span class="gate-ic gate-ic--bad"><ion-icon name="close-circle-outline" aria-hidden="true"></ion-icon></span>
                <h2>Payment didn't go through</h2>
                <p>Nothing was saved.</p>
                <button type="button" class="btn btn--primary" (click)="step.set('details')">Try again</button>
              </section>
            }
          }
        }
      </div>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-surface); }
    ion-toolbar { --background: var(--artha-surface); }
    .wrap { max-width: 560px; margin: 0 auto; padding: 8px 16px 32px; }
    .msg { text-align: center; color: var(--artha-text-muted); padding: 32px 8px; }
    .state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 64px 16px; color: var(--artha-text-muted); }
    .gate { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 28px 4px; text-align: center; }
    .gate h2 { margin: 4px 0 0; font-size: 20px; font-weight: 800; color: var(--artha-text); }
    .gate p { margin: 0 0 6px; max-width: 38ch; font-size: 14px; line-height: 1.5; color: var(--artha-text-muted); }
    .gate .btn { width: 100%; }
    .gate-ic {
      width: 60px; height: 60px; border-radius: 20px; display: grid; place-items: center; font-size: 30px;
      background: var(--artha-accent-tint); color: var(--artha-accent);
    }
    .gate-ic--ok { background: color-mix(in srgb, var(--artha-positive) 15%, transparent); color: var(--artha-positive); }
    .gate-ic--bad { background: var(--artha-negative-tint); color: var(--artha-negative); }

    .payee { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 18px; background: var(--artha-surface-2); }
    .avatar {
      width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; flex-shrink: 0;
      background: var(--artha-accent); color: #fff; font-weight: 800; font-size: 18px;
    }
    .payee-text { flex: 1; min-width: 0; }
    .payee-name { font-size: 16px; font-weight: 800; color: var(--artha-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .payee-id { font-size: 12.5px; color: var(--artha-text-muted); overflow-wrap: anywhere; }
    .tag { padding: 3px 10px; border-radius: 999px; background: var(--artha-surface); font-size: 11.5px; font-weight: 700; color: var(--artha-text-muted); }

    .amount { display: flex; align-items: baseline; justify-content: center; gap: 4px; padding: 18px 0 4px; }
    .cur { font-size: 30px; font-weight: 700; color: var(--artha-text-muted); }
    .amount-input {
      max-width: 66vw; border: 0; outline: 0; background: transparent; text-align: center;
      font: inherit; font-size: 48px; font-weight: 800; letter-spacing: -0.03em; color: var(--artha-text);
      font-variant-numeric: tabular-nums; caret-color: var(--artha-accent);
    }
    .section { margin: 16px 2px 8px; font-size: 12.5px; font-weight: 700; letter-spacing: 0.04em; color: var(--artha-text-subtle); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--artha-border);
      background: var(--artha-surface); color: var(--artha-text); cursor: pointer;
      font: inherit; font-size: 13.5px; font-weight: 600; max-width: 100%;
    }
    .chip.sel { background: var(--artha-accent); border-color: var(--artha-accent); color: #fff; }
    .chip--more { color: var(--artha-accent); }
    .remember { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; color: var(--artha-text-muted); }
    .remember input { width: 18px; height: 18px; }
    .select {
      width: 100%; height: 46px; padding: 0 14px; border-radius: 14px; border: 1px solid var(--artha-border);
      background: var(--artha-surface); color: var(--artha-text); font: inherit; font-size: 15px;
    }
    .hint { margin: 6px 2px 0; font-size: 12.5px; color: var(--artha-text-muted); }
    .center { text-align: center; }
    .payee + .hint { margin-top: 8px; }
    .loc { display: flex; align-items: center; gap: 6px; margin: 16px 2px 0; font-size: 12.5px; color: var(--artha-text-muted); }
    .err { margin: 10px 0 0; font-size: 13px; font-weight: 600; color: var(--artha-negative); }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      height: 50px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--artha-border);
      background: var(--artha-surface); color: var(--artha-text); cursor: pointer; font: inherit; font-size: 15px; font-weight: 700;
    }
    .btn[disabled] { opacity: 0.5; cursor: default; }
    .btn ion-icon { font-size: 20px; }
    .btn--primary { border: 0; background: var(--artha-accent); color: #fff; }
    .btn--ghost { width: 100%; border: 0; background: transparent; color: var(--artha-text-muted); margin-top: 6px; }
    .pay { width: 100%; height: 56px; font-size: 16px; }
    /* Pay stays on screen, above the floating tab bar. */
    .paybar {
      position: sticky; bottom: 0; z-index: 5; margin: 12px -16px 0; padding: 12px 16px 16px;
      background: var(--artha-surface);
    }
    .paybar::before {
      content: ''; position: absolute; left: 0; right: 0; top: -20px; height: 20px; pointer-events: none;
      background: linear-gradient(to bottom, transparent, var(--artha-surface));
    }
    .paybar .err { margin: 0 0 8px; }
    @media (max-width: 767.98px) {
      :host ion-content { --padding-bottom: 0px; }
      .paybar { padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
    }
  `],
})
export class PayPage implements OnInit {
  protected readonly router = inject(Router);
  private readonly sms = inject(SmsCaptureService);
  private readonly expensesStore = inject(ExpensesStore);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly accountsStore = inject(AccountsStore);
  private readonly modalCtrl = inject(ModalController);
  private readonly appLock = inject(AppLockService);

  protected readonly native = Capacitor.getPlatform() === 'android';
  @ViewChild('amountBox') private amountBox?: ElementRef<HTMLInputElement>;
  protected readonly step = signal<Step>('scan');
  protected readonly qr = signal<UpiQr | null>(null);
  protected readonly categoryId = signal<string>('');
  protected readonly apps = signal<{ packageName: string; label: string }[]>([]);
  protected readonly app = signal<string>(readLocal(APP_KEY) ?? '');
  protected readonly location = signal<ExpenseLocation | null>(null);
  protected readonly locating = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly ref = signal<string | null>(null);

  protected amountText = '';
  protected accountId = '';
  protected note = '';
  protected remember = true;

  protected readonly accounts = computed(() => this.accountsStore.active());
  protected readonly quickCats = computed<Category[]>(() => {
    const byId = this.categoriesStore.byId();
    const ids: string[] = [];
    const push = (id: string | null | undefined) => {
      const c = id ? byId[id] : undefined;
      if (c && !c.archived && !ids.includes(c.id)) ids.push(c.id);
    };
    push(this.categoryId());
    for (const e of [...this.expensesStore.items()].sort((a, b) => b.date.localeCompare(a.date))) {
      if (ids.length >= 7) break;
      push(e.categoryId);
    }
    for (const c of this.categoriesStore.active()) {
      if (ids.length >= 7) break;
      if (!c.parentId) push(c.id);
    }
    return ids.map((id) => byId[id]);
  });
  protected readonly categoryPath = computed(() =>
    this.categoryId() ? this.categoriesStore.pathLabel(this.categoryId()) : null,
  );
  /** "Food · Cafés" when a subcategory is picked (the chips only show its name). */
  protected readonly subPath = computed(() => {
    const c = this.categoryId() ? this.categoriesStore.byId()[this.categoryId()] : undefined;
    return c?.parentId ? this.categoryPath() : null;
  });
    /** The QR's name is a placeholder ("Default"): the shop's name has to come from you. */
  protected readonly noQrName = computed(() => placeholderName(this.qr()?.pn));
  private readonly savedName = signal<string | null>(null);
  protected readonly headerName = computed(() => {
    const q = this.qr();
    if (!q) return '';
    return this.savedName() ?? (this.noQrName() ? 'Unknown shop' : q.pn);
  });
  protected readonly appLabel = computed(() => this.apps().find((a) => a.packageName === this.app())?.label ?? null);

  async ngOnInit(): Promise<void> {
    if (!this.native) return;
    const loads: Promise<unknown>[] = [];
    if (this.categoriesStore.items().length === 0) loads.push(this.categoriesStore.load());
    if (this.accountsStore.items().length === 0) loads.push(this.accountsStore.load());
    await Promise.all(loads).catch(() => undefined);
    void SmsReader.listUpiApps()
      .then(({ apps }) => {
        this.apps.set(apps ?? []);
        if (this.app() && !apps.some((a) => a.packageName === this.app())) this.app.set('');
      })
      .catch(() => undefined);
    // Straight into the camera.
    void this.scan();
  }

  protected amount(): number {
    const q = this.qr();
    if (q?.am != null) return q.am;
    const v = Number(String(this.amountText).replace(/[^0-9.]/g, ''));
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  /** The amount box grows with the number, so "₹" sits right next to it. */
  protected amountWidth(): number {
    return Math.max(1.6, String(this.amountText || '0').length * 0.62 + 0.4);
  }

  protected canPay(): boolean {
    return this.amount() > 0 && !!this.categoryId() && !!this.accountId && this.apps().length > 0;
  }

  protected initial(name: string): string {
    return (name.trim()[0] ?? '?').toUpperCase();
  }

  protected async scan(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const r = await this.appLock.hold(() => SmsReader.scanUpiQr());
      if (!r || r.cancelled || !r.qr) return;
      const q = parseUpiQr(r.qr);
      if (!q) {
        this.error.set("That QR isn't a UPI payment code.");
        return;
      }
      this.start(q);
    } catch (e) {
      this.error.set(
        String((e as Error)?.message ?? e).includes('camera-denied')
          ? 'Camera permission is needed to scan.'
          : "Couldn't open the scanner.",
      );
    } finally {
      this.busy.set(false);
    }
  }

  private start(q: UpiQr): void {
    this.qr.set(q);
    this.amountText = q.am != null ? String(q.am) : '';
    // A name typed before for this UPI id wins; a placeholder ("Default") is never used.
    const saved = payeeNames()[q.pa.toLowerCase()] ?? null;
    this.savedName.set(saved);
    this.note = saved ?? (placeholderName(q.pn) ? '' : q.pn);
    this.ref.set(null);
    // The category learned for this shop: by its UPI id first (unique), then by name.
    const learned =
      this.sms.payeeCategory(q.pa) ??
      (saved ? this.sms.payeeCategory(saved) : null) ??
      (placeholderName(q.pn) ? null : this.sms.payeeCategory(q.pn));
    this.categoryId.set(learned ?? '');
    // Shops are remembered by default, people aren't.
    this.remember = !!learned || !!q.mc;
    const accounts = this.accounts();
    const savedAcc = readLocal(ACCOUNT_KEY);
    this.accountId =
      (savedAcc && accounts.some((a) => a.id === savedAcc) ? savedAcc : null) ??
      accounts.find((a) => a.type === 'savings' || a.type === 'checking')?.id ??
      accounts[0]?.id ??
      '';
    this.step.set('details');
    // Amount to type: open the keyboard on it.
    if (q.am == null) setTimeout(() => this.amountBox?.nativeElement.focus(), 350);
    this.locating.set(true);
    void this.sms
      .currentLocation()
      .then(async (l) => {
        this.location.set(l);
        // No name yet: the shop you paid at this spot before.
        if (l && !this.note.trim() && this.qr() === q) {
          const r = await SmsReader.recallPlace({ lat: l.lat, lng: l.lng, accuracy: l.accuracy }).catch(() => null);
          if (r?.name && !this.note.trim() && this.qr() === q) {
            this.note = r.name;
            this.savedName.set(r.name);
            if (!this.categoryId() && r.categoryId && this.categoriesStore.byId()[r.categoryId]) {
              this.categoryId.set(r.categoryId);
              this.remember = true;
            }
          }
        }
      })
      .finally(() => this.locating.set(false));
  }

  protected async moreCategories(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CategorySearchModal,
      componentProps: {
        options: this.categoriesStore.pickerOptions(),
        includeNone: false,
        allowCreate: false,
        selectedId: this.categoryId() || null,
        title: 'Category',
      },
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<string | null>();
    if (role === 'select' && data) this.categoryId.set(data);
  }

  protected async pay(): Promise<void> {
    const q = this.qr();
    if (!q || !this.canPay()) return;
    this.error.set(null);
    writeLocal(APP_KEY, this.app());
    writeLocal(ACCOUNT_KEY, this.accountId);
    this.step.set('paying');
    // From now on the bank's SMS for this payment is expected: neither the
    // full-screen alert nor the in-app listener should ask about it.
    this.sms.recordPaidHere(this.amount(), q.pa, this.note.trim() || (placeholderName(q.pn) ? '' : q.pn));
    let outcome: UpiOutcome = 'unknown';
    try {
      const res = await this.appLock.hold(() => SmsReader.upiPay({
        uri: buildPayUri(q, this.amount(), this.note),
        packageName: this.app() || null,
        amount: this.amount(),
        vpa: q.pa,
        name: q.pn,
      }));
      const parsed = parseUpiResponse(res?.response);
      outcome = parsed.status;
      this.ref.set(parsed.ref);
      this.sms.setPaidRef(this.amount(), parsed.ref);
    } catch (e) {
      this.sms.forgetPaidHere(this.amount());
      this.step.set('details');
      this.error.set(String((e as Error)?.message ?? e).includes('no-upi-app')
        ? 'That UPI app is no longer installed. Pick another.'
        : "Couldn't open the UPI app.");
      return;
    }
    if (outcome === 'success' || outcome === 'submitted') {
      await this.save('app');
    } else if (outcome === 'failure') {
      await this.notPaid(true);
    } else {
      this.step.set('confirm');
    }
  }

  protected async save(_by: 'app' | 'confirmed'): Promise<void> {
    const q = this.qr();
    if (!q) return;
    this.busy.set(true);
    try {
      const name = this.note.trim();
      const created = await this.expensesStore.add({
        date: localToday(),
        amount: this.amount(),
        categoryId: this.categoryId(),
        accountId: this.accountId,
        note: name || (placeholderName(q.pn) ? q.pa : q.pn),
        excluded: false,
        type: 'expense',
        ...(this.location() ? { location: this.location() } : {}),
      });
      // No name yet: the payee name in the bank's SMS (e.g. "To APOLLO DENTAL") fills it in later.
      this.sms.setPaidExpense(this.amount(), created.id, !name);
      // The name you typed for this UPI id is used next time you scan it.
      if (name && name !== q.pn) savePayeeName(q.pa, name);
      if (this.remember) {
        this.sms.rememberPayeeCategory(q.pa, this.categoryId());
        if (name) this.sms.rememberPayeeCategory(name, this.categoryId());
        if (!placeholderName(q.pn) && q.pn !== name) this.sms.rememberPayeeCategory(q.pn, this.categoryId());
        // "You paid here before": a later payment at this spot (even by card) gets the shop and category.
        const loc = this.location();
        if (loc && name) void this.sms.rememberPlaceAt(loc, name, this.categoryId());
      }
      this.step.set('done');
    } catch {
      this.step.set('confirm');
      this.error.set("Couldn't save the expense. Try again.");
    } finally {
      this.busy.set(false);
    }
  }

  protected async notPaid(failed = false): Promise<void> {
    this.sms.forgetPaidHere(this.amount());
    await SmsReader.upiForget({ amount: this.amount() }).catch(() => undefined);
    this.step.set(failed ? 'failed' : 'details');
  }

  protected reset(): void {
    this.qr.set(null);
    this.location.set(null);
    this.step.set('scan');
    void this.scan();
  }
}

function readLocal(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function writeLocal(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    // This session only.
  }
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
