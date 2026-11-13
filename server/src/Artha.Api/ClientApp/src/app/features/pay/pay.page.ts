import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  IonButton,
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

/** One question per screen: amount → shop → category → pay with. */
type Step = 'scan' | 'amount' | 'shop' | 'category' | 'app' | 'paying' | 'confirm' | 'done' | 'failed';
const FLOW: Step[] = ['amount', 'shop', 'category', 'app'];

const APP_KEY = 'artha.pay.app';
const ACCOUNT_KEY = 'artha.pay.account';
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

/**
 * Scan & Pay as a short guided flow: scan the shop's UPI QR, then one
 * question per screen - amount (keypad), which shop (nearby places, or what
 * Artha already knows), category (one tap), and the UPI app to pay with
 * (one tap opens it). The expense is saved when you come back, with the
 * location, and the bank's SMS for it is skipped.
 */
@Component({
  selector: 'artha-pay',
  standalone: true,
  imports: [CurrencyPipe, FormsModule, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="back()" aria-label="Back"><ion-icon name="arrow-back" slot="icon-only"></ion-icon></ion-button>
        </ion-buttons>
        <ion-title>Scan &amp; Pay</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="wrap">
        @if (!native) {
          <p class="msg">Scan &amp; Pay opens your UPI app, so it works in the Android app.</p>
        } @else {
          <!-- Who + how much, on every step after the scan -->
          @if (qr(); as q) {
            @if (inFlow()) {
              <section class="who">
                <span class="avatar" aria-hidden="true">{{ initial(shopName() || '?') }}</span>
                <div class="who-text">
                  <div class="who-name">{{ shopName() || 'Unknown shop' }}</div>
                  <div class="who-id">{{ q.pa }}</div>
                </div>
                @if (amount() > 0 && step() !== 'amount') {
                  <button type="button" class="who-amt num" (click)="go('amount')" [disabled]="q.am !== null">
                    {{ amount() | currency: 'INR' : 'symbol' : '1.0-2' }}
                  </button>
                }
              </section>
              <div class="dots" aria-hidden="true">
                @for (s of flow(); track s) { <span [class.on]="flow().indexOf(s) <= flow().indexOf(step())"></span> }
              </div>
            }
          }

          @switch (step()) {
            @case ('scan') {
              <section class="center-block">
                <span class="big-ic"><ion-icon name="qr-code-outline" aria-hidden="true"></ion-icon></span>
                <h2>Scan the shop's UPI QR</h2>
                <p>Then: amount, shop, category — and your UPI app opens to pay.</p>
                @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
                <button type="button" class="btn btn--primary btn--wide" (click)="scan()" [disabled]="busy()">
                  <ion-icon name="scan-outline" aria-hidden="true"></ion-icon>Scan QR
                </button>
              </section>
            }

            <!-- 1 · Amount -->
            @case ('amount') {
              <h2 class="q">How much?</h2>
              <div class="amount num" [class.amount--empty]="!amountText">₹{{ amountText || '0' }}</div>
              <div class="keypad">
                @for (k of keys; track k) {
                  <button type="button" class="key" (click)="press(k)" [attr.aria-label]="k === '⌫' ? 'Delete' : k">{{ k }}</button>
                }
              </div>
              <div class="bar">
                <button type="button" class="btn btn--primary btn--wide" (click)="next()" [disabled]="amount() <= 0">Next</button>
              </div>
            }

            <!-- 2 · Shop -->
            @case ('shop') {
              <h2 class="q">Which shop?</h2>
              @if (knownName(); as k) {
                <button type="button" class="row row--sel" (click)="pickShop(k)">
                  <ion-icon name="checkmark-circle" aria-hidden="true"></ion-icon>
                  <span class="row-main">{{ k }}</span><span class="row-sub">{{ knownWhy() }}</span>
                </button>
              }
              @if (shops() === null) {
                <p class="hint center">
                  <ion-spinner name="dots"></ion-spinner>
                  {{ locating() ? 'Getting your location…' : location() ? 'Finding shops near you…' : '' }}
                </p>
              } @else {
                @for (s of shops(); track s.name) {
                  @if (s.name !== knownName()) {
                    <button type="button" class="row" (click)="pickShop(s.name)">
                      <ion-icon name="storefront-outline" aria-hidden="true"></ion-icon>
                      <span class="row-main">{{ s.name }}</span><span class="row-sub">{{ s.distanceM }} m</span>
                    </button>
                  }
                }
                @if (shops()!.length === 0) {
                  <p class="hint center">{{ shopsError() || (location() ? 'No shops found nearby.' : 'No location — type the name below.') }}</p>
                }
              }
              <div class="type-row">
                <input class="field" type="text" [(ngModel)]="typedName" placeholder="Or type the shop's name"
                       aria-label="Shop name" (keyup.enter)="typedName.trim() && pickShop(typedName.trim())" />
                <button type="button" class="btn btn--primary" (click)="pickShop(typedName.trim())" [disabled]="!typedName.trim()">OK</button>
              </div>
              <button type="button" class="link" (click)="next()">Skip</button>
            }

            <!-- 3 · Category -->
            @case ('category') {
              <h2 class="q">What for?</h2>
              <div class="tiles">
                @for (c of quickCats(); track c.id) {
                  <button type="button" class="tile" [class.sel]="categoryId() === c.id" (click)="pickCategory(c.id)"
                          [style.--c]="c.color || 'var(--artha-accent)'">
                    <span class="tile-ic"><ion-icon [name]="c.icon || 'pricetag-outline'" aria-hidden="true"></ion-icon></span>
                    <span class="tile-name">{{ c.name }}</span>
                  </button>
                }
                <button type="button" class="tile" (click)="moreCategories()">
                  <span class="tile-ic tile-ic--more"><ion-icon name="ellipsis-horizontal" aria-hidden="true"></ion-icon></span>
                  <span class="tile-name">More</span>
                </button>
              </div>
              <label class="remember">
                <input type="checkbox" [(ngModel)]="remember" />
                <span>Use this category next time for {{ shopName() || 'this shop' }}</span>
              </label>
              @if (categoryId()) {
                <div class="bar">
                  <button type="button" class="btn btn--primary btn--wide" (click)="next()">Continue with {{ categoryName() }}</button>
                </div>
              }
            }

            <!-- 4 · Pay with -->
            @case ('app') {
              <h2 class="q">Pay {{ amount() | currency: 'INR' : 'symbol' : '1.0-2' }} with</h2>
              <p class="summary">
                {{ categoryName() }} · from
                <select class="inline-select" [(ngModel)]="accountId" aria-label="Paid from">
                  @for (a of accounts(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
                </select>
              </p>
              @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
              @if (apps().length === 0) {
                <p class="hint center">No UPI app found. Install Google Pay, PhonePe, Paytm or BHIM.</p>
              }
              @for (a of orderedApps(); track a.packageName; let first = $first) {
                <button type="button" class="row row--app" [class.row--sel]="first && a.packageName === app()" (click)="pay(a.packageName)">
                  <span class="app-ic" aria-hidden="true">{{ initial(a.label) }}</span>
                  <span class="row-main">{{ a.label }}</span>
                  @if (a.packageName === app()) { <span class="row-sub">Last used</span> }
                  <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon>
                </button>
              }
            }

            @case ('paying') {
              <div class="center-block"><ion-spinner></ion-spinner><p>Finish the payment in your UPI app…</p></div>
            }

            @case ('confirm') {
              <section class="center-block">
                <span class="big-ic"><ion-icon name="help-circle-outline" aria-hidden="true"></ion-icon></span>
                <h2>Did the payment go through?</h2>
                <p>Your UPI app didn't say. Check it, then tell Artha.</p>
                @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
                <button type="button" class="btn btn--primary btn--wide" (click)="save()" [disabled]="busy()">
                  Yes, paid {{ amount() | currency: 'INR' : 'symbol' : '1.0-2' }}
                </button>
                <button type="button" class="btn btn--wide" (click)="notPaid()">No, it didn't</button>
              </section>
            }

            @case ('done') {
              <section class="center-block">
                <span class="big-ic big-ic--ok"><ion-icon name="checkmark-circle" aria-hidden="true"></ion-icon></span>
                <h2>Paid {{ amount() | currency: 'INR' : 'symbol' : '1.0-2' }}</h2>
                <p>{{ shopName() || qr()?.pa }} · {{ categoryName() }}{{ ref() ? ' · ref ' + ref() : '' }}<br />
                  Saved — the bank's SMS for it won't ask again.</p>
                <button type="button" class="btn btn--primary btn--wide" (click)="reset()">
                  <ion-icon name="scan-outline" aria-hidden="true"></ion-icon>Scan another
                </button>
                <button type="button" class="btn btn--wide" (click)="router.navigate(['/expenses'])">See expenses</button>
              </section>
            }

            @case ('failed') {
              <section class="center-block">
                <span class="big-ic big-ic--bad"><ion-icon name="close-circle-outline" aria-hidden="true"></ion-icon></span>
                <h2>Payment didn't go through</h2>
                <p>Nothing was saved.</p>
                <button type="button" class="btn btn--primary btn--wide" (click)="go('app')">Try again</button>
                <button type="button" class="btn btn--wide" (click)="reset()">Scan another QR</button>
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
    .wrap { max-width: 520px; margin: 0 auto; padding: 4px 16px 24px; }
    .num { font-variant-numeric: tabular-nums; }
    .msg { text-align: center; color: var(--artha-text-muted); padding: 32px 8px; }

    .who { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 18px; background: var(--artha-surface-2); }
    .avatar {
      width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center; flex-shrink: 0;
      background: var(--artha-accent); color: #fff; font-weight: 800; font-size: 18px;
    }
    .who-text { flex: 1; min-width: 0; }
    .who-name { font-size: 15.5px; font-weight: 800; color: var(--artha-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .who-id { font-size: 12px; color: var(--artha-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .who-amt {
      border: 0; background: var(--artha-surface); border-radius: 999px; padding: 6px 12px; cursor: pointer;
      font: inherit; font-size: 15px; font-weight: 800; color: var(--artha-text);
    }
    .who-amt[disabled] { cursor: default; }
    .dots { display: flex; justify-content: center; gap: 6px; margin: 12px 0 4px; }
    .dots span { width: 22px; height: 4px; border-radius: 999px; background: var(--artha-border); }
    .dots span.on { background: var(--artha-accent); }

    .q { margin: 14px 2px 12px; font-size: 22px; font-weight: 800; color: var(--artha-text); text-align: center; }
    .hint { margin: 10px 2px; font-size: 13px; color: var(--artha-text-muted); }
    .center { text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .err { margin: 6px 0; font-size: 13px; font-weight: 600; color: var(--artha-negative); text-align: center; }

    .center-block { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 4px; text-align: center; }
    .center-block h2 { margin: 4px 0 0; font-size: 21px; font-weight: 800; color: var(--artha-text); }
    .center-block p { margin: 0 0 6px; max-width: 36ch; font-size: 14px; line-height: 1.5; color: var(--artha-text-muted); }
    .big-ic {
      width: 64px; height: 64px; border-radius: 22px; display: grid; place-items: center; font-size: 32px;
      background: var(--artha-accent-tint); color: var(--artha-accent);
    }
    .big-ic--ok { background: color-mix(in srgb, var(--artha-positive) 15%, transparent); color: var(--artha-positive); }
    .big-ic--bad { background: var(--artha-negative-tint); color: var(--artha-negative); }

    /* Amount keypad */
    .amount { text-align: center; font-size: 52px; font-weight: 800; letter-spacing: -0.03em; color: var(--artha-text); margin: 4px 0 14px; }
    .amount--empty { color: var(--artha-border-strong); }
    .keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .key {
      height: 58px; border: 0; border-radius: 16px; background: var(--artha-surface-2); color: var(--artha-text);
      font: inherit; font-size: 24px; font-weight: 700; cursor: pointer;
    }
    .key:active { background: var(--artha-accent-tint); }

    /* Lists */
    .row {
      display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; margin-top: 8px; padding: 10px 14px;
      border-radius: 16px; border: 1px solid var(--artha-border); background: var(--artha-surface); color: var(--artha-text);
      text-align: left; font: inherit; cursor: pointer;
    }
    .row ion-icon { font-size: 20px; color: var(--artha-accent); flex-shrink: 0; }
    .row-main { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
    .row-sub { font-size: 12.5px; color: var(--artha-text-muted); flex-shrink: 0; }
    .row--sel { border: 2px solid var(--artha-accent); background: var(--artha-accent-tint); }
    .row--app ion-icon { color: var(--artha-text-subtle); }
    .app-ic {
      width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; flex-shrink: 0;
      background: var(--artha-surface-2); color: var(--artha-text); font-weight: 800;
    }
    .type-row { display: flex; gap: 8px; margin-top: 14px; }
    .field {
      flex: 1; min-width: 0; height: 48px; padding: 0 14px; border-radius: 14px; border: 1px solid var(--artha-border);
      background: var(--artha-surface); color: var(--artha-text); font: inherit; font-size: 15px;
    }
    .type-row .btn { height: 48px; }
    .link {
      display: block; margin: 14px auto 0; padding: 8px 16px; border: 0; background: transparent; cursor: pointer;
      font: inherit; font-size: 14px; font-weight: 700; color: var(--artha-text-muted);
    }

    /* Category tiles */
    .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .tile {
      --c: var(--artha-accent);
      display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; padding: 14px 6px;
      border: 2px solid transparent; border-radius: 18px; background: var(--artha-surface-2); color: var(--artha-text);
      font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer;
    }
    .tile.sel { border-color: var(--c); background: color-mix(in srgb, var(--c) 12%, var(--artha-surface)); }
    .tile-ic {
      width: 40px; height: 40px; border-radius: 14px; display: grid; place-items: center; font-size: 20px;
      color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent);
    }
    .tile.sel .tile-ic { background: var(--c); color: #fff; }
    .tile-ic--more { color: var(--artha-text-muted); background: var(--artha-border); }
    .tile-name { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .remember { display: flex; align-items: center; gap: 8px; margin: 14px 2px 0; font-size: 13px; color: var(--artha-text-muted); }
    .remember input { width: 18px; height: 18px; flex-shrink: 0; }

    .summary { text-align: center; margin: -4px 0 8px; font-size: 14px; color: var(--artha-text-muted); }
    .inline-select {
      border: 0; border-bottom: 1px dashed var(--artha-border-strong); background: transparent;
      color: var(--artha-text); font: inherit; font-weight: 700; padding: 2px 0;
    }

    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      height: 52px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--artha-border);
      background: var(--artha-surface); color: var(--artha-text); cursor: pointer; font: inherit; font-size: 15px; font-weight: 700;
    }
    .btn[disabled] { opacity: 0.45; cursor: default; }
    .btn ion-icon { font-size: 20px; }
    .btn--primary { border: 0; background: var(--artha-accent); color: #fff; }
    .btn--wide { width: 100%; }

    /* The main button stays on screen, above the floating tab bar. */
    .bar { position: sticky; bottom: 0; z-index: 5; margin: 16px -16px 0; padding: 12px 16px 16px; background: var(--artha-surface); }
    @media (max-width: 767.98px) {
      :host ion-content { --padding-bottom: 0px; }
      .wrap { padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
      .bar { padding-bottom: calc(96px + env(safe-area-inset-bottom)); margin-bottom: calc(-96px - env(safe-area-inset-bottom)); }
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
  protected readonly keys = KEYS;
  protected readonly step = signal<Step>('scan');
  protected readonly qr = signal<UpiQr | null>(null);
  protected readonly categoryId = signal<string>('');
  protected readonly apps = signal<{ packageName: string; label: string }[]>([]);
  protected readonly app = signal<string>(readLocal(APP_KEY) ?? '');
  protected readonly location = signal<ExpenseLocation | null>(null);
  protected readonly locating = signal(false);
  protected readonly busy = signal(false);
  /** Nearby shops (Google Places with your key, else OpenStreetMap); null = still looking. */
  protected readonly shops = signal<{ name: string; distanceM: number }[] | null>(null);
  protected readonly shopsError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly ref = signal<string | null>(null);
  /** The shop's name as chosen (a nearby place, typed, known before, or the QR's own). */
  protected readonly shopName = signal<string>('');
  /** A name Artha already had for this QR / spot, offered first on the shop step. */
  protected readonly knownName = signal<string | null>(null);
  protected readonly knownWhy = signal<string>('');
  private readonly amountSig = signal<string>('');

  protected typedName = '';
  protected accountId = '';
  protected remember = true;

  protected get amountText(): string {
    return this.amountSig();
  }

  protected readonly accounts = computed(() => this.accountsStore.active());
  /** The steps this payment goes through (a fixed amount skips the keypad). */
  protected readonly flow = computed<Step[]>(() => FLOW.filter((s) => !(s === 'amount' && this.qr()?.am != null)));
  protected readonly inFlow = computed(() => FLOW.includes(this.step()));
  protected readonly orderedApps = computed(() => {
    const last = this.app();
    return [...this.apps()].sort((a, b) => Number(b.packageName === last) - Number(a.packageName === last));
  });
  protected readonly quickCats = computed<Category[]>(() => {
    const byId = this.categoriesStore.byId();
    const ids: string[] = [];
    const push = (id: string | null | undefined) => {
      const c = id ? byId[id] : undefined;
      if (c && !c.archived && !ids.includes(c.id)) ids.push(c.id);
    };
    push(this.categoryId());
    for (const e of [...this.expensesStore.items()].sort((a, b) => b.date.localeCompare(a.date))) {
      if (ids.length >= 8) break;
      push(e.categoryId);
    }
    for (const c of this.categoriesStore.active()) {
      if (ids.length >= 8) break;
      if (!c.parentId) push(c.id);
    }
    return ids.map((id) => byId[id]);
  });
  protected readonly categoryName = computed(() =>
    this.categoryId() ? this.categoriesStore.pathLabel(this.categoryId()) || '' : '',
  );

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
    const v = Number(this.amountSig());
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  protected initial(name: string): string {
    return (name.trim()[0] ?? '?').toUpperCase();
  }

  // ---- Steps ----

  protected go(step: Step): void {
    this.error.set(null);
    this.step.set(step);
  }

  /** The next step this payment needs (shop / category are skipped when already known). */
  protected next(): void {
    const order = this.flow();
    let i = order.indexOf(this.step()) + 1;
    while (i < order.length && this.skippable(order[i])) i++;
    this.go(order[Math.min(i, order.length - 1)]);
  }

  /** Back goes one step back in the flow; from the start it leaves Scan & Pay. */
  protected back(): void {
    const order = this.flow();
    const i = order.indexOf(this.step());
    if (i > 0) {
      this.go(order[i - 1]);
    } else if (i === 0 || this.step() === 'failed' || this.step() === 'confirm') {
      this.reset(false);
    } else {
      void this.router.navigate(['/dashboard']);
    }
  }

  private skippable(s: Step): boolean {
    // Known shop: no need to ask (its name shows at the top; tap Back to change it).
    if (s === 'shop') return !!this.shopName();
    return false;
  }

  protected press(k: string): void {
    let v = this.amountSig();
    if (k === '⌫') v = v.slice(0, -1);
    else if (k === '.') v = v.includes('.') ? v : (v || '0') + '.';
    else {
      if (v.includes('.') && v.split('.')[1].length >= 2) return; // paise: two digits
      if (v.replace('.', '').length >= 7) return;
      v = v === '0' ? k : v + k;
    }
    this.amountSig.set(v);
  }

  protected pickShop(name: string): void {
    if (!name) return;
    this.shopName.set(name);
    this.typedName = '';
    // A shop: worth remembering its category.
    this.remember = true;
    this.go('category');
  }

  protected pickCategory(id: string): void {
    this.categoryId.set(id);
    this.next();
  }

  // ---- Scan ----

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
    this.ref.set(null);
    this.shops.set(null);
    this.shopsError.set(null);
    this.amountSig.set('');
    this.typedName = '';
    // The shop's name: one typed before for this UPI id, else the QR's own (never a placeholder like "Default").
    const saved = payeeNames()[q.pa.toLowerCase()] ?? null;
    const own = placeholderName(q.pn) ? null : q.pn;
    this.shopName.set(saved ?? own ?? '');
    this.knownName.set(saved ?? own);
    this.knownWhy.set(saved ? 'You named it before' : own ? 'From the QR' : '');
    // The category learned for this shop: by its UPI id first (unique), then by name.
    const learned =
      this.sms.payeeCategory(q.pa) ??
      (saved ? this.sms.payeeCategory(saved) : null) ??
      (own ? this.sms.payeeCategory(own) : null);
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
    this.go(q.am != null ? (this.shopName() ? 'category' : 'shop') : 'amount');
    this.locate(q);
  }

  /** Location for the expense, then the shop remembered at this spot and the shops around it. */
  private locate(q: UpiQr): void {
    this.locating.set(true);
    void this.sms
      .currentLocation()
      .then(async (l) => {
        if (this.qr() !== q) return;
        this.location.set(l);
        if (!l) {
          this.shops.set([]);
          return;
        }
        if (!this.knownName()) {
          const r = await SmsReader.recallPlace({ lat: l.lat, lng: l.lng, accuracy: l.accuracy }).catch(() => null);
          if (r?.name && this.qr() === q && !this.knownName()) {
            this.knownName.set(r.name);
            this.knownWhy.set('You paid here before');
            if (!this.categoryId() && r.categoryId && this.categoriesStore.byId()[r.categoryId]) {
              this.categoryId.set(r.categoryId);
            }
          }
        }
        try {
          const found = await this.sms.findNearbyPlaces(l.lat, l.lng);
          if (this.qr() === q) this.shops.set(found);
        } catch {
          if (this.qr() === q) {
            this.shopsError.set("Couldn't reach the shop search — type the name instead.");
            this.shops.set([]);
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
    if (role === 'select' && data) this.pickCategory(data);
  }

  // ---- Pay ----

  protected async pay(packageName: string): Promise<void> {
    const q = this.qr();
    if (!q || this.amount() <= 0 || !this.categoryId() || !this.accountId) {
      this.error.set(!this.categoryId() ? 'Pick a category first.' : 'Enter the amount first.');
      return;
    }
    this.error.set(null);
    this.app.set(packageName);
    writeLocal(APP_KEY, packageName);
    writeLocal(ACCOUNT_KEY, this.accountId);
    this.step.set('paying');
    const name = this.shopName();
    // From now on the bank's SMS for this payment is expected: neither the
    // full-screen alert nor the in-app listener should ask about it.
    this.sms.recordPaidHere(this.amount(), q.pa, name);
    let outcome: UpiOutcome = 'unknown';
    try {
      const res = await this.appLock.hold(() =>
        SmsReader.upiPay({
          uri: buildPayUri(q, this.amount(), name),
          packageName,
          amount: this.amount(),
          vpa: q.pa,
          name: q.pn,
        }),
      );
      const parsed = parseUpiResponse(res?.response);
      outcome = parsed.status;
      this.ref.set(parsed.ref);
      this.sms.setPaidRef(this.amount(), parsed.ref);
    } catch (e) {
      this.sms.forgetPaidHere(this.amount());
      this.step.set('app');
      this.error.set(
        String((e as Error)?.message ?? e).includes('no-upi-app')
          ? 'That UPI app is no longer installed. Pick another.'
          : "Couldn't open the UPI app.",
      );
      return;
    }
    if (outcome === 'success' || outcome === 'submitted') {
      await this.save();
    } else if (outcome === 'failure') {
      await this.notPaid(true);
    } else {
      this.step.set('confirm');
    }
  }

  protected async save(): Promise<void> {
    const q = this.qr();
    if (!q) return;
    this.busy.set(true);
    try {
      const name = this.shopName().trim();
      const created = await this.expensesStore.add({
        date: localToday(),
        amount: this.amount(),
        categoryId: this.categoryId(),
        accountId: this.accountId,
        note: name || q.pa,
        excluded: false,
        type: 'expense',
        ...(this.location() ? { location: this.location() } : {}),
      });
      // No name yet: the payee name in the bank's SMS (e.g. "To APOLLO DENTAL") fills it in later.
      this.sms.setPaidExpense(this.amount(), created.id, !name);
      // The name chosen for this UPI id is used next time you scan it.
      if (name && name !== q.pn) savePayeeName(q.pa, name);
      if (this.remember) {
        this.sms.rememberPayeeCategory(q.pa, this.categoryId());
        if (name) this.sms.rememberPayeeCategory(name, this.categoryId());
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
    this.step.set(failed ? 'failed' : 'app');
  }

  protected reset(rescan = true): void {
    this.qr.set(null);
    this.location.set(null);
    this.step.set('scan');
    if (rescan) void this.scan();
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
