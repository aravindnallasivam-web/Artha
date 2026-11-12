import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { AccountsStore } from '../accounts/accounts.store';
import { WrongPasswordError } from '../../core/security/vault-crypto';
import {
  CardNetwork,
  NETWORK_LABEL,
  detectNetwork,
  digits,
  expired,
  formatNumber,
  last4,
  luhnOk,
  normalizeExpiry,
} from './card-utils';
import { VaultCard, VaultService, newCardId } from './vault.service';

type View = 'list' | 'detail' | 'form' | 'settings';

/**
 * Card vault: card numbers, expiry, name and CVV, encrypted on this device
 * with the master password before anything is written to Drive.
 */
@Component({
  selector: 'artha-vault',
  standalone: true,
  imports: [
    FormsModule,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          @if (vault.status() === 'unlocked' && view() !== 'list') {
            <ion-button (click)="go('list')" aria-label="Back to cards">
              <ion-icon name="chevron-back" slot="icon-only"></ion-icon>
            </ion-button>
          } @else {
            <ion-back-button defaultHref="/more" text=""></ion-back-button>
          }
        </ion-buttons>
        <ion-title>Card vault</ion-title>
        @if (vault.status() === 'unlocked') {
          <ion-buttons slot="end">
            <ion-button (click)="go('settings')" aria-label="Vault settings">
              <ion-icon name="settings-outline" slot="icon-only"></ion-icon>
            </ion-button>
            <ion-button (click)="lockNow()" aria-label="Lock vault">
              <ion-icon name="lock-closed-outline" slot="icon-only"></ion-icon>
            </ion-button>
          </ion-buttons>
        }
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="wrap">
        @switch (vault.status()) {
          @case ('loading') {
            <div class="state"><ion-spinner></ion-spinner></div>
          }
          @case ('error') {
            <p class="msg">Couldn't read the vault. Check the connection and try again.</p>
            <button type="button" class="btn" (click)="vault.load()">Try again</button>
          }

          <!-- First use -->
          @case ('none') {
            <section class="gate">
              <span class="gate-ic"><ion-icon name="shield-checkmark-outline" aria-hidden="true"></ion-icon></span>
              <h2>Create your card vault</h2>
              <p>Cards are encrypted on this device with a master password (AES-256) before they're saved to
                your Google Drive. Nobody — not Google, not Artha — can read them without it.</p>
              <form (ngSubmit)="create()" class="form">
                <label class="field">
                  <span>Master password</span>
                  <input type="password" name="pw1" [(ngModel)]="pw1" autocomplete="new-password" minlength="10" required />
                </label>
                <div class="meter" [attr.data-level]="strength()"><span></span></div>
                <p class="hint">{{ strengthLabel() }} · at least 10 characters; a short sentence works well.</p>
                <label class="field">
                  <span>Repeat it</span>
                  <input type="password" name="pw2" [(ngModel)]="pw2" autocomplete="new-password" required />
                </label>
                <label class="check">
                  <input type="checkbox" name="ack" [(ngModel)]="ack" />
                  <span>I understand that if I forget this password, the vault <b>cannot be recovered</b>.</span>
                </label>
                @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
                <button type="submit" class="btn btn--primary" [disabled]="busy() || !canCreate()">
                  @if (busy()) { <ion-spinner name="dots"></ion-spinner> } @else { Create vault }
                </button>
              </form>
            </section>
          }

          <!-- Locked -->
          @case ('locked') {
            <section class="gate">
              <span class="gate-ic"><ion-icon name="lock-closed-outline" aria-hidden="true"></ion-icon></span>
              <h2>Vault locked</h2>
              @if (vault.bioEnabled() && vault.isNative()) {
                <button type="button" class="btn btn--primary" (click)="unlockBio()" [disabled]="busy()">
                  <ion-icon name="finger-print" aria-hidden="true"></ion-icon>Unlock with fingerprint
                </button>
                <p class="or">or use your master password</p>
              }
              <form (ngSubmit)="unlock()" class="form">
                <label class="field">
                  <span>Master password</span>
                  <input type="password" name="pw" [(ngModel)]="pw1" autocomplete="current-password" required />
                </label>
                @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
                <button type="submit" class="btn" [class.btn--primary]="!vault.bioEnabled()" [disabled]="busy() || !pw1">
                  @if (busy()) { <ion-spinner name="dots"></ion-spinner> } @else { Unlock }
                </button>
              </form>
            </section>
          }

          <!-- Unlocked -->
          @case ('unlocked') {
            @switch (view()) {
              @case ('list') {
                @if (vault.cards().length === 0) {
                  <section class="gate">
                    <span class="gate-ic"><ion-icon name="card-outline" aria-hidden="true"></ion-icon></span>
                    <h2>No cards yet</h2>
                    <p>Add your credit and debit cards. They stay encrypted; the vault locks itself after 2 minutes.</p>
                  </section>
                }
                <ul class="cards">
                  @for (c of vault.cards(); track c.id) {
                    <li>
                      <button type="button" class="pcard" [attr.data-net]="c.network" (click)="openCard(c)">
                        <div class="pcard-top">
                          <span class="pcard-bank">{{ c.label || c.bank || 'Card' }}</span>
                          <span class="pcard-kind">{{ c.kind }}</span>
                        </div>
                        <div class="pcard-num num">•••• •••• •••• {{ last4(c.number) }}</div>
                        <div class="pcard-bottom">
                          <span>{{ c.nameOnCard || ' ' }}</span>
                          <span class="num" [class.exp]="expired(c.expiry)">{{ c.expiry }}</span>
                          <b>{{ netLabel(c.network) }}</b>
                        </div>
                      </button>
                    </li>
                  }
                </ul>
                <button type="button" class="btn btn--primary add" (click)="newCard()">
                  <ion-icon name="add" aria-hidden="true"></ion-icon>Add card
                </button>
              }

              @case ('detail') {
                @if (current(); as c) {
                  <div class="pcard pcard--big" [attr.data-net]="c.network">
                    <div class="pcard-top">
                      <span class="pcard-bank">{{ c.label || c.bank || 'Card' }}</span>
                      <span class="pcard-kind">{{ c.kind }}</span>
                    </div>
                    <div class="pcard-num num">{{ showNumber() ? formatNumber(c.number) : '•••• •••• •••• ' + last4(c.number) }}</div>
                    <div class="pcard-bottom">
                      <span>{{ c.nameOnCard || ' ' }}</span>
                      <span class="num">{{ c.expiry }}</span>
                      <b>{{ netLabel(c.network) }}</b>
                    </div>
                  </div>

                  <ul class="rows">
                    <li>
                      <span class="row-k">Card number</span>
                      <span class="row-v num">{{ showNumber() ? formatNumber(c.number) : '•••• ' + last4(c.number) }}</span>
                      <button type="button" class="mini" (click)="showNumber.set(!showNumber()); vault.touch()">
                        {{ showNumber() ? 'Hide' : 'Show' }}
                      </button>
                      <button type="button" class="mini" (click)="copy(digits(c.number), 'Card number')">Copy</button>
                    </li>
                    <li>
                      <span class="row-k">Expiry</span>
                      <span class="row-v num" [class.exp]="expired(c.expiry)">{{ c.expiry }}{{ expired(c.expiry) ? ' · expired' : '' }}</span>
                      <button type="button" class="mini" (click)="copy(c.expiry, 'Expiry')">Copy</button>
                    </li>
                    @if (c.nameOnCard) {
                      <li>
                        <span class="row-k">Name</span>
                        <span class="row-v">{{ c.nameOnCard }}</span>
                        <button type="button" class="mini" (click)="copy(c.nameOnCard, 'Name')">Copy</button>
                      </li>
                    }
                    @if (c.cvv) {
                      <li>
                        <span class="row-k">CVV</span>
                        <span class="row-v num">{{ showCvv() ? c.cvv : '•••' }}</span>
                        <button type="button" class="mini" (click)="toggleCvv()">{{ showCvv() ? 'Hide' : 'Show' }}</button>
                        <button type="button" class="mini" (click)="copy(c.cvv, 'CVV')">Copy</button>
                      </li>
                    }
                    @if (accountName(c.accountId); as acc) {
                      <li><span class="row-k">Account</span><span class="row-v">{{ acc }}</span></li>
                    }
                    @if (c.note) {
                      <li class="row-note"><span class="row-k">Note</span><span class="row-v">{{ c.note }}</span></li>
                    }
                  </ul>
                  @if (toast()) { <p class="toast" role="status">{{ toast() }}</p> }

                  <div class="actions">
                    <button type="button" class="btn" (click)="editCard(c)">
                      <ion-icon name="create-outline" aria-hidden="true"></ion-icon>Edit
                    </button>
                    @if (confirmDelete()) {
                      <button type="button" class="btn btn--danger" (click)="deleteCard(c)">Delete for good</button>
                    } @else {
                      <button type="button" class="btn btn--ghost-danger" (click)="confirmDelete.set(true)">Delete</button>
                    }
                  </div>
                }
              }

              @case ('form') {
                <form class="form form--card" (ngSubmit)="saveCard()">
                  <label class="field">
                    <span>Card number</span>
                    <input name="number" inputmode="numeric" autocomplete="off" [ngModel]="draft.number"
                           (ngModelChange)="onNumber($event)" placeholder="1234 5678 9012 3456" required />
                  </label>
                  @if (digits(draft.number).length >= 12 && !luhnOk(draft.number)) {
                    <p class="warn">This number doesn't pass the card checksum — check for a typo.</p>
                  }
                  <div class="two">
                    <label class="field">
                      <span>Expiry (MM/YY)</span>
                      <input name="expiry" inputmode="numeric" autocomplete="off" [(ngModel)]="draft.expiry"
                             (blur)="draft.expiry = normalizeExpiry(draft.expiry)" placeholder="04/29" required />
                    </label>
                    <label class="field">
                      <span>CVV</span>
                      <input name="cvv" inputmode="numeric" type="password" autocomplete="off" maxlength="4"
                             [(ngModel)]="draft.cvv" placeholder="•••" />
                    </label>
                  </div>
                  <label class="field">
                    <span>Name on card</span>
                    <input name="name" autocomplete="off" [(ngModel)]="draft.nameOnCard" />
                  </label>
                  <div class="two">
                    <label class="field">
                      <span>Card name</span>
                      <input name="label" autocomplete="off" [(ngModel)]="draft.label" placeholder="HDFC Millennia" />
                    </label>
                    <label class="field">
                      <span>Type</span>
                      <select name="kind" [(ngModel)]="draft.kind">
                        <option value="credit">Credit</option>
                        <option value="debit">Debit</option>
                        <option value="prepaid">Prepaid</option>
                      </select>
                    </label>
                  </div>
                  <div class="two">
                    <label class="field">
                      <span>Bank</span>
                      <input name="bank" autocomplete="off" [(ngModel)]="draft.bank" placeholder="HDFC Bank" />
                    </label>
                    <label class="field">
                      <span>Network</span>
                      <select name="network" [(ngModel)]="draft.network">
                        @for (n of networks; track n) { <option [value]="n">{{ netLabel(n) }}</option> }
                      </select>
                    </label>
                  </div>
                  <label class="field">
                    <span>Linked account (optional)</span>
                    <select name="account" [(ngModel)]="draft.accountId">
                      <option [ngValue]="null">None</option>
                      @for (a of accounts(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
                    </select>
                  </label>
                  <label class="field">
                    <span>Note (optional)</span>
                    <input name="note" autocomplete="off" [(ngModel)]="draft.note" placeholder="Customer care 1800…" />
                  </label>
                  @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
                  <button type="submit" class="btn btn--primary" [disabled]="busy() || !canSaveCard()">
                    {{ busy() ? 'Saving…' : 'Save card' }}
                  </button>
                </form>
              }

              @case ('settings') {
                <section class="panel">
                  <h3>Unlock</h3>
                  @if (vault.isNative()) {
                    <div class="setting">
                      <div>
                        <b>Fingerprint unlock</b>
                        <p>Uses the phone's secure hardware. Adding a new fingerprint turns it off until you unlock with
                          the password again.</p>
                      </div>
                      <button type="button" class="btn" (click)="toggleBio()" [disabled]="busy()">
                        {{ vault.bioEnabled() ? 'Turn off' : 'Turn on' }}
                      </button>
                    </div>
                  } @else {
                    <p class="hint">Fingerprint unlock is available in the Android app.</p>
                  }
                  <p class="hint">The vault locks after 2 minutes without activity, when you leave this screen and when
                    the app goes to the background. Screenshots are blocked while it's open.</p>
                </section>
                <section class="panel">
                  <h3>Change master password</h3>
                  <form class="form" (ngSubmit)="changePw()">
                    <label class="field"><span>Current password</span>
                      <input type="password" name="cur" [(ngModel)]="pwCur" autocomplete="current-password" /></label>
                    <label class="field"><span>New password</span>
                      <input type="password" name="new1" [(ngModel)]="pw1" autocomplete="new-password" /></label>
                    <div class="meter" [attr.data-level]="strength()"><span></span></div>
                    <label class="field"><span>Repeat new password</span>
                      <input type="password" name="new2" [(ngModel)]="pw2" autocomplete="new-password" /></label>
                    @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
                    @if (toast()) { <p class="toast" role="status">{{ toast() }}</p> }
                    <button type="submit" class="btn" [disabled]="busy() || !pwCur || pw1.length < 10 || pw1 !== pw2">
                      {{ busy() ? 'Changing…' : 'Change password' }}
                    </button>
                  </form>
                </section>
              }
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
    .num { font-variant-numeric: tabular-nums; }
    .state { display: flex; justify-content: center; padding: 48px; }
    .msg { color: var(--artha-text-muted); text-align: center; }

    .gate { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 20px 4px; }
    .gate h2 { margin: 4px 0 0; font-size: 20px; font-weight: 800; color: var(--artha-text); }
    .gate p { margin: 0; max-width: 40ch; font-size: 14px; line-height: 1.5; color: var(--artha-text-muted); }
    .gate-ic {
      width: 56px; height: 56px; border-radius: 18px; display: grid; place-items: center;
      background: var(--artha-accent-tint); color: var(--artha-accent); font-size: 28px;
    }
    .or { font-size: 12.5px !important; margin-top: 4px !important; }

    .form { width: 100%; display: flex; flex-direction: column; gap: 12px; margin-top: 10px; text-align: left; }
    .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .field span { font-size: 12.5px; font-weight: 700; color: var(--artha-text-subtle); letter-spacing: 0.02em; }
    .field input, .field select {
      height: 46px; padding: 0 14px; border-radius: 14px; border: 1px solid var(--artha-border);
      background: var(--artha-surface); color: var(--artha-text); font: inherit; font-size: 15px; min-width: 0;
    }
    .field input:focus, .field select:focus { outline: 2px solid var(--artha-accent); outline-offset: 1px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .check { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.45; color: var(--artha-text-muted); }
    .check input { margin-top: 3px; width: 18px; height: 18px; flex-shrink: 0; }
    .hint { margin: -4px 2px 0; font-size: 12px; color: var(--artha-text-subtle); line-height: 1.45; }
    .err { margin: 0; font-size: 13px; font-weight: 600; color: var(--artha-negative); }
    .warn { margin: -4px 2px 0; font-size: 12.5px; color: var(--artha-warning, #b45309); }
    .toast { margin: 10px 0 0; font-size: 13px; font-weight: 600; color: var(--artha-positive); text-align: center; }

    .meter { height: 6px; border-radius: 999px; background: var(--artha-surface-2); overflow: hidden; }
    .meter span { display: block; height: 100%; width: 0; border-radius: inherit; transition: width .2s; }
    .meter[data-level='1'] span { width: 33%; background: var(--artha-negative); }
    .meter[data-level='2'] span { width: 66%; background: var(--artha-warning, #f59e0b); }
    .meter[data-level='3'] span { width: 100%; background: var(--artha-positive); }

    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      height: 48px; padding: 0 18px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--artha-border); background: var(--artha-surface); color: var(--artha-text);
      font: inherit; font-size: 15px; font-weight: 700;
    }
    .btn[disabled] { opacity: 0.5; cursor: default; }
    .btn ion-icon { font-size: 20px; }
    .btn ion-spinner { width: 24px; height: 24px; }
    .btn--primary { width: 100%; border: 0; background: var(--artha-accent); color: #fff; }
    .btn--danger { border: 0; background: var(--artha-negative); color: #fff; }
    .btn--ghost-danger { color: var(--artha-negative); }
    .add { margin-top: 16px; }

    .cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .pcard {
      --c1: #334155; --c2: #0f172a;
      width: 100%; aspect-ratio: 1.586; max-height: 210px; max-width: 100%;
      display: flex; flex-direction: column; justify-content: space-between;
      padding: 18px 20px; border: 0; border-radius: 20px; cursor: pointer; text-align: left;
      background: linear-gradient(135deg, var(--c1), var(--c2)); color: #fff;
      box-shadow: 0 10px 24px -14px rgba(15, 23, 42, 0.7); font: inherit;
    }
    .pcard[data-net='visa'] { --c1: #1e3a8a; --c2: #172554; }
    .pcard[data-net='mastercard'] { --c1: #9a3412; --c2: #431407; }
    .pcard[data-net='rupay'] { --c1: #065f46; --c2: #022c22; }
    .pcard[data-net='amex'] { --c1: #0e7490; --c2: #083344; }
    .pcard[data-net='diners'], .pcard[data-net='discover'], .pcard[data-net='jcb'] { --c1: #6d28d9; --c2: #2e1065; }
    .pcard--big { cursor: default; margin-bottom: 14px; }
    .pcard-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .pcard-bank { font-size: 15px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pcard-kind { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.75; }
    .pcard-num { font-size: 20px; font-weight: 600; letter-spacing: 0.08em; }
    .pcard-bottom { display: flex; align-items: center; gap: 12px; font-size: 12.5px; }
    .pcard-bottom span:first-child { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; opacity: 0.85; }
    .pcard-bottom b { font-size: 14px; font-style: italic; }
    .exp { color: #fca5a5; }

    .rows { list-style: none; margin: 0; padding: 0; border-radius: 18px; border: 1px solid var(--artha-border); overflow: hidden; }
    .rows li { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--artha-border); }
    .rows li:first-child { border-top: 0; }
    .row-k { width: 92px; flex-shrink: 0; font-size: 12.5px; font-weight: 700; color: var(--artha-text-subtle); }
    .row-v { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: var(--artha-text); overflow-wrap: anywhere; }
    .rows .exp { color: var(--artha-negative); }
    .mini {
      height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--artha-border);
      background: var(--artha-surface-2); color: var(--artha-text); cursor: pointer;
      font: inherit; font-size: 12.5px; font-weight: 700;
    }
    .actions { display: flex; gap: 10px; margin-top: 16px; }
    .actions .btn { flex: 1; }

    .panel { margin-top: 14px; padding: 16px; border-radius: 18px; background: var(--artha-surface-2); }
    .panel h3 { margin: 0 0 10px; font-size: 15px; font-weight: 800; color: var(--artha-text); }
    .setting { display: flex; align-items: center; gap: 12px; }
    .setting > div { flex: 1; min-width: 0; }
    .setting b { font-size: 14px; color: var(--artha-text); }
    .setting p { margin: 2px 0 0; font-size: 12.5px; color: var(--artha-text-muted); line-height: 1.45; }
  `],
})
export class VaultPage implements OnInit, OnDestroy {
  protected readonly vault = inject(VaultService);
  private readonly accountsStore = inject(AccountsStore);

  protected readonly view = signal<View>('list');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly toast = signal<string | null>(null);
  protected readonly current = signal<VaultCard | null>(null);
  protected readonly showNumber = signal(false);
  protected readonly showCvv = signal(false);
  protected readonly confirmDelete = signal(false);

  protected pw1 = '';
  protected pw2 = '';
  protected pwCur = '';
  protected ack = false;
  protected draft: VaultCard = blankCard();

  protected readonly networks: CardNetwork[] = ['visa', 'mastercard', 'rupay', 'amex', 'diners', 'discover', 'jcb', 'other'];
  protected readonly accounts = computed(() => this.accountsStore.active());

  protected readonly digits = digits;
  protected readonly last4 = last4;
  protected readonly formatNumber = formatNumber;
  protected readonly luhnOk = luhnOk;
  protected readonly expired = expired;
  protected readonly normalizeExpiry = normalizeExpiry;

  private cvvTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    void this.vault.setSecureScreen(true);
    if (this.accountsStore.items().length === 0) void this.accountsStore.load().catch(() => undefined);
    await this.vault.load();
    // Straight to the fingerprint prompt when it's set up.
    if (this.vault.status() === 'locked' && this.vault.bioEnabled() && this.vault.isNative()) {
      void this.unlockBio();
    }
  }

  ngOnDestroy(): void {
    // Leaving the vault screen locks it.
    this.vault.lock();
    void this.vault.setSecureScreen(false);
    if (this.cvvTimer) clearTimeout(this.cvvTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  /** Any tap / key in the vault keeps it unlocked a little longer. */
  @HostListener('pointerdown')
  @HostListener('keydown')
  protected activity(): void {
    this.vault.touch();
  }

  protected go(view: View): void {
    this.view.set(view);
    this.error.set(null);
    this.toast.set(null);
    this.showNumber.set(false);
    this.showCvv.set(false);
    this.confirmDelete.set(false);
    this.pw1 = this.pw2 = this.pwCur = '';
  }

  protected strength(): number {
    const p = this.pw1;
    if (!p) return 0;
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((r) => r.test(p)).length;
    if (p.length >= 14 || (p.length >= 10 && kinds >= 3)) return 3;
    if (p.length >= 10) return 2;
    return 1;
  }

  protected strengthLabel(): string {
    return ['Enter a password', 'Too short', 'OK', 'Strong'][this.strength()];
  }

  protected canCreate(): boolean {
    return this.pw1.length >= 10 && this.pw1 === this.pw2 && this.ack;
  }

  protected async create(): Promise<void> {
    if (!this.canCreate()) {
      this.error.set(this.pw1 !== this.pw2 ? "The passwords don't match." : null);
      return;
    }
    await this.run(async () => {
      await this.vault.setup(this.pw1);
      this.go('list');
      // Offer fingerprint right away on the phone.
      if (this.vault.isNative()) void this.vault.enableBiometric();
    });
  }

  protected async unlock(): Promise<void> {
    await this.run(async () => {
      try {
        await this.vault.unlock(this.pw1);
        this.go('list');
      } catch (e) {
        this.error.set(e instanceof WrongPasswordError ? 'Wrong master password.' : "Couldn't open the vault.");
      }
    });
  }

  protected async unlockBio(): Promise<void> {
    await this.run(async () => {
      if (await this.vault.unlockWithBiometric()) {
        this.go('list');
      } else if (!this.vault.bioEnabled()) {
        this.error.set('Fingerprint unlock was reset (a new fingerprint was added). Use your master password.');
      }
    });
  }

  protected lockNow(): void {
    this.vault.lock();
    this.go('list');
  }

  protected openCard(c: VaultCard): void {
    this.go('detail');
    this.current.set(c);
  }

  protected newCard(): void {
    this.draft = blankCard();
    this.go('form');
  }

  protected editCard(c: VaultCard): void {
    this.draft = { ...c, number: formatNumber(c.number) };
    this.go('form');
  }

  protected onNumber(v: string): void {
    const d = digits(v).slice(0, 19);
    const before = detectNetwork(digits(this.draft.number));
    this.draft.number = formatNumber(d);
    const net = detectNetwork(d);
    // Follow the number until the user picks a network themselves.
    if (this.draft.network === 'other' || this.draft.network === before) this.draft.network = net;
  }

  protected canSaveCard(): boolean {
    const n = digits(this.draft.number).length;
    return n >= 12 && n <= 19 && /^\d{2}\/\d{2}$/.test(normalizeExpiry(this.draft.expiry));
  }

  protected async saveCard(): Promise<void> {
    if (!this.canSaveCard()) {
      this.error.set('Enter the card number and an expiry like 04/29.');
      return;
    }
    await this.run(async () => {
      const card: VaultCard = {
        ...this.draft,
        number: digits(this.draft.number),
        expiry: normalizeExpiry(this.draft.expiry),
        cvv: digits(this.draft.cvv).slice(0, 4),
        nameOnCard: this.draft.nameOnCard.trim(),
        label: this.draft.label.trim(),
        bank: this.draft.bank.trim(),
        note: this.draft.note.trim(),
      };
      await this.vault.upsert(card);
      this.openCard(this.vault.cards().find((c) => c.id === card.id) ?? card);
    });
  }

  protected async deleteCard(c: VaultCard): Promise<void> {
    await this.run(async () => {
      await this.vault.remove(c.id);
      this.go('list');
    });
  }

  protected toggleCvv(): void {
    const on = !this.showCvv();
    this.showCvv.set(on);
    if (this.cvvTimer) clearTimeout(this.cvvTimer);
    // The CVV hides itself again after 20 s.
    if (on) this.cvvTimer = setTimeout(() => this.showCvv.set(false), 20_000);
  }

  protected async copy(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.flash(`${what} copied — it's cleared from the clipboard in 45 s.`);
      // Best effort: overwrite the clipboard once it's had time to be pasted.
      setTimeout(() => void navigator.clipboard.writeText('').catch(() => undefined), 45_000);
    } catch {
      this.flash("Couldn't copy on this device.");
    }
  }

  protected async toggleBio(): Promise<void> {
    await this.run(async () => {
      if (this.vault.bioEnabled()) {
        await this.vault.disableBiometric();
        this.flash('Fingerprint unlock is off.');
      } else if (await this.vault.enableBiometric()) {
        this.flash('Fingerprint unlock is on.');
      } else {
        this.error.set("Couldn't turn on fingerprint unlock.");
      }
    });
  }

  protected async changePw(): Promise<void> {
    if (this.pw1.length < 10 || this.pw1 !== this.pw2) {
      this.error.set('The new password needs 10+ characters, typed the same twice.');
      return;
    }
    await this.run(async () => {
      try {
        await this.vault.changePassword(this.pwCur, this.pw1);
        this.pw1 = this.pw2 = this.pwCur = '';
        this.flash('Master password changed.');
      } catch (e) {
        this.error.set(e instanceof WrongPasswordError ? 'The current password is wrong.' : "Couldn't change it.");
      }
    });
  }

  protected netLabel(n: CardNetwork): string {
    return NETWORK_LABEL[n] ?? 'Card';
  }

  protected accountName(id: string | null): string | null {
    return id ? this.accountsStore.byId()[id]?.name ?? null : null;
  }

  private flash(msg: string): void {
    this.toast.set(msg);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch {
      this.error.set('Something went wrong. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}

function blankCard(): VaultCard {
  return {
    id: newCardId(),
    label: '',
    bank: '',
    network: 'other',
    kind: 'credit',
    number: '',
    expiry: '',
    nameOnCard: '',
    cvv: '',
    accountId: null,
    note: '',
    createdAt: '',
    updatedAt: '',
  };
}
