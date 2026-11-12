import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ActionSheetController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonDatetime,
  IonHeader,
  IonIcon,
  IonModal,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { AiProviderService } from '../../core/ai/ai-provider.service';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { DEFAULT_ACCOUNT_ID } from '../../core/models/account.model';
import { Category } from '../../core/models/category.model';
import { ExpenseLocation, TransactionType } from '../../core/models/expense.model';
import { NearbyPlace } from '../../core/native/sms-reader';
import { SmsCaptureService } from '../sms/sms-capture.service';
import { AccountsStore } from '../accounts/accounts.store';
import { AmountInputDirective } from '../../shared/amount-input.directive';
import { CategoriesStore } from '../categories/categories.store';
import { CategoryEditModal } from '../categories/category-edit.modal';
import { CategorySearchModal } from '../categories/category-search.modal';
import { ExpensesStore } from './expenses.store';

const QUICK_CATEGORY_COUNT = 7;

@Component({
  selector: 'artha-expense-edit',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AmountInputDirective,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonDatetime,
    IonHeader,
    IonIcon,
    IonModal,
    IonSpinner,
    IonTitle,
    IonToggle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/expenses" icon="close-outline" text="" aria-label="Close"></ion-back-button>
        </ion-buttons>
        <ion-title>
          {{ mode() === 'edit' ? 'Edit ' : 'New ' }}{{ isIncome() ? 'income' : 'expense' }}
        </ion-title>
        @if (mode() === 'edit' && !isIncome()) {
          <ion-buttons slot="end">
            <ion-button (click)="makeRecurring()" aria-label="Make recurring">
              <ion-icon name="calendar-outline" slot="icon-only"></ion-icon>
            </ion-button>
          </ion-buttons>
        }
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="wrap">
            <!-- Expense / Income -->
            <div class="type-row">
              <div class="type-toggle" role="group" aria-label="Type">
                <button type="button" class="type-btn" [class.on]="!isIncome()"
                        [attr.aria-pressed]="!isIncome()" (click)="setType('expense')">Expense</button>
                <button type="button" class="type-btn" [class.on]="isIncome()"
                        [attr.aria-pressed]="isIncome()" (click)="setType('income')">Income</button>
              </div>
            </div>

            <!-- Amount hero -->
            <div class="amount" [class.amount--income]="isIncome()">
              <div class="amount-row">
                <span class="cur">{{ isIncome() ? '+' : '' }}{{ currencySymbol() }}</span>
                <input
                  class="amount-input"
                  type="text"
                  inputmode="decimal"
                  placeholder="0"
                  formControlName="amount"
                  arthaAmount
                  (focus)="selectAll($event)"
                  aria-label="Amount"
                />
              </div>
              <label class="note-pill">
                <span class="sr-only">Note</span>
                <input type="text" formControlName="note" placeholder="Add a note" />
              </label>
            </div>

            <!-- Category -->
            <div class="section-row">
              <div class="section-label">Category</div>
              @if (ai.isEnabled()) {
                <button type="button" class="ai-suggest" [disabled]="aiBusy()" (click)="suggestCategory()">
                  @if (aiBusy()) {
                    <ion-spinner name="dots" aria-label="Asking AI"></ion-spinner>
                  } @else {
                    <ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon>Suggest
                  }
                </button>
              }
            </div>
            @if (aiMessage(); as m) {
              <p class="ai-msg" [class.ai-msg--ok]="m.ok">{{ m.text }}</p>
            }
            <div class="cat-grid">
              @for (c of quickCategories(); track c.id) {
                <button type="button" class="cat-tile" [class.sel]="isSelected(c)"
                        [style.--c]="c.color || 'var(--artha-accent)'"
                        [attr.aria-pressed]="isSelected(c)" (click)="selectCategory(c.id)">
                  <span class="cat-icon"><ion-icon [name]="c.icon || 'pricetag-outline'" aria-hidden="true"></ion-icon></span>
                  <span class="cat-name">{{ c.name }}</span>
                </button>
              }
              <button type="button" class="cat-tile" (click)="openCategoryPicker()">
                <span class="cat-icon cat-icon--more"><ion-icon name="ellipsis-horizontal" aria-hidden="true"></ion-icon></span>
                <span class="cat-name">More</span>
              </button>
            </div>
            @if (selectedPath(); as path) {
              <p class="cat-path">Selected: <b>{{ path }}</b></p>
            }

            <!-- Account + date -->
            <div class="pills">
              <button type="button" class="pill pill--grow" (click)="pickAccount()">
                <ion-icon name="wallet-outline" aria-hidden="true"></ion-icon>
                <span class="pill-text">{{ accountName() || 'Choose account' }}</span>
                <ion-icon class="pill-chev" name="chevron-down" aria-hidden="true"></ion-icon>
              </button>
              <button type="button" class="pill" id="expense-date-pill">
                <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
                <span class="pill-text">{{ dateLabel() }}</span>
              </button>
              <ion-modal trigger="expense-date-pill" [keepContentsMounted]="true" class="date-modal">
                <ng-template>
                  <ion-datetime presentation="date" formControlName="date" [showDefaultButtons]="true"></ion-datetime>
                </ng-template>
              </ion-modal>
            </div>
            <div class="quick-dates">
              <button type="button" class="qd" [class.sel]="isToday()" (click)="setDate(0)">Today</button>
              <button type="button" class="qd" [class.sel]="isYesterday()" (click)="setDate(1)">Yesterday</button>
            </div>

            <!-- Where the SMS arrived (saved by the full-screen alert) -->
            @if (location(); as loc) {
              <section class="loc" aria-label="Location">
                <div class="loc-head">
                  <span class="loc-pin"><ion-icon name="location-outline" aria-hidden="true"></ion-icon></span>
                  <div class="loc-text">
                    <div class="loc-title">Where you were</div>
                    <div class="loc-sub">{{ locationLabel(loc) }}</div>
                  </div>
                  <a class="loc-map" [href]="mapsUrl(loc)" target="_blank" rel="noopener">Open in Maps</a>
                </div>
                @if (places() === null) {
                  <button type="button" class="loc-find" [disabled]="placesBusy()" (click)="findPlaces(loc)">
                    @if (placesBusy()) {
                      <ion-spinner name="dots" aria-label="Looking up shops"></ion-spinner>
                    } @else {
                      <ion-icon name="storefront-outline" aria-hidden="true"></ion-icon>Find nearby shops
                    }
                  </button>
                } @else if (places()!.length === 0) {
                  @if (placesError()) {
                    <p class="loc-msg">{{ placesError() }}</p>
                    <button type="button" class="loc-find" (click)="findPlaces(loc)">Try again</button>
                  } @else {
                    <p class="loc-msg">No named shops on the map within 400 m — OpenStreetMap misses many small shops.
                      Type the shop's name in the note, or add a Google Places key in Settings → Nearby shops for
                      much better coverage.</p>
                  }
                } @else {
                  <p class="loc-msg">Tap the shop you paid — it becomes the note.</p>
                  <div class="loc-chips">
                    @for (p of places(); track p.name) {
                      <button type="button" class="loc-chip" [class.sel]="form.controls.note.value === p.name"
                              (click)="usePlace(p)">
                        {{ p.name }}<span class="loc-dist">{{ p.distanceM }} m</span>
                      </button>
                    }
                  </div>
                }
                <button type="button" class="loc-remove" (click)="removeLocation()">Remove location</button>
              </section>
            }

            <!-- More options -->
            <details class="more">
              <summary>More options</summary>
              <div class="more-body">
                <ion-toggle formControlName="excluded">
                  <div class="excl-title">Exclude from totals</div>
                  <div class="excl-sub">Refunds, transfers, settlements</div>
                </ion-toggle>
              </div>
            </details>
          </div>

          <!-- Sticky save -->
          <div class="save-bar">
            <button type="submit" class="save-btn" [disabled]="form.invalid || saving()">
              {{ saving() ? 'Saving…' : (mode() === 'edit' ? 'Save changes' : (isIncome() ? 'Save income' : 'Save expense')) }}
            </button>
          </div>
        </form>
      }
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-surface); }
    ion-toolbar { --background: var(--artha-surface); }
    .state { display: flex; justify-content: center; padding: 48px; }
    .wrap { max-width: 640px; margin: 0 auto; padding: 4px 20px 16px; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

    /* Expense / Income toggle */
    .type-row { display: flex; justify-content: center; }
    .type-toggle { display: inline-flex; padding: 4px; border-radius: 999px; background: var(--artha-surface-2); }
    .type-btn {
      height: 36px; padding: 0 20px; border: 0; border-radius: 999px; cursor: pointer;
      background: transparent; color: var(--artha-text-muted);
      font-family: inherit; font-size: 14px; font-weight: 600;
    }
    .type-btn.on {
      background: var(--artha-surface); color: var(--artha-text); font-weight: 700;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
    }

    /* Amount hero */
    .amount { text-align: center; padding: 20px 0 8px; }
    .amount-row { display: flex; align-items: baseline; justify-content: center; gap: 4px; }
    .cur { font-size: 30px; font-weight: 700; color: var(--artha-text-muted); }
    .amount--income .amount-input,
    .amount--income .cur { color: var(--artha-positive); }
    .amount-input {
      border: 0; outline: 0; background: transparent; padding: 0;
      font-family: inherit; font-size: 52px; font-weight: 800; letter-spacing: -0.04em;
      color: var(--artha-text); width: 6ch; max-width: 66vw; text-align: center;
      font-variant-numeric: tabular-nums; caret-color: var(--artha-accent);
    }
    .amount-input::placeholder { color: var(--artha-border-strong); }
    .note-pill {
      display: inline-flex; align-items: center; margin-top: 10px;
      padding: 9px 16px; border-radius: 999px; background: var(--artha-surface-2);
    }
    .note-pill input {
      width: 200px; max-width: 60vw; border: 0; outline: 0; background: transparent;
      font-family: inherit; font-size: 14px; color: var(--artha-text); text-align: center;
    }
    .note-pill input::placeholder { color: var(--artha-text-subtle); }

    .section-label {
      font-size: 12.5px; font-weight: 700; letter-spacing: 0.04em;
      color: var(--artha-text-subtle); margin: 18px 2px 10px;
    }

    .section-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 18px 2px 10px; }
    .section-row .section-label { margin: 0; }
    .ai-suggest {
      display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 12px;
      border: 0; border-radius: 999px; cursor: pointer;
      background: var(--artha-accent-tint); color: var(--artha-accent);
      font-family: inherit; font-size: 13px; font-weight: 700;
    }
    .ai-suggest[disabled] { opacity: 0.6; cursor: default; }
    .ai-suggest ion-icon { font-size: 15px; }
    .ai-suggest ion-spinner { width: 22px; height: 22px; color: var(--artha-accent); }
    .ai-msg { margin: -2px 2px 10px; font-size: 12.5px; color: var(--artha-text-muted); }
    .ai-msg--ok { color: var(--artha-accent); font-weight: 600; }

    /* Category grid */
    .cat-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .cat-tile {
      --c: var(--artha-accent);
      display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0;
      padding: 10px 4px; border: 2px solid transparent; border-radius: 16px; cursor: pointer;
      background: var(--artha-surface-2); color: var(--artha-text);
      font-family: inherit; font-size: 12px; font-weight: 600;
    }
    .cat-tile.sel {
      border-color: var(--c);
      background: color-mix(in srgb, var(--c) 12%, var(--artha-surface));
      font-weight: 700;
    }
    .cat-icon {
      width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center;
      color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); font-size: 18px;
    }
    .cat-tile.sel .cat-icon { background: var(--c); color: #fff; }
    .cat-icon--more { color: var(--artha-text-muted); background: var(--artha-border); }
    .cat-name { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cat-path { margin: 8px 2px 0; font-size: 12.5px; color: var(--artha-text-muted); }

    /* Account + date pills */
    .pills { display: flex; gap: 10px; margin-top: 16px; }
    .pill {
      display: inline-flex; align-items: center; gap: 8px; min-width: 0;
      height: 48px; padding: 0 14px; border-radius: 14px; cursor: pointer;
      border: 1px solid var(--artha-border); background: var(--artha-surface); color: var(--artha-text);
      font-family: inherit; font-size: 14px; font-weight: 600;
    }
    .pill ion-icon { font-size: 17px; color: var(--artha-text-subtle); flex-shrink: 0; }
    .pill--grow { flex: 1; }
    .pill-text { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill-chev { font-size: 14px; }
    .quick-dates { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    .qd {
      height: 32px; padding: 0 12px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--artha-border); background: transparent; color: var(--artha-text-muted);
      font-family: inherit; font-size: 12.5px; font-weight: 600;
    }
    .qd.sel { background: var(--artha-accent-tint); border-color: transparent; color: var(--artha-accent); }
    .date-modal { --width: 320px; --height: auto; --border-radius: 20px; }

    /* Location */
    .loc { margin-top: 18px; padding: 14px 16px; border-radius: 16px; background: var(--artha-surface-2); }
    .loc-head { display: flex; align-items: center; gap: 12px; }
    .loc-pin {
      width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; flex-shrink: 0;
      background: var(--artha-accent-tint); color: var(--artha-accent); font-size: 18px;
    }
    .loc-text { flex: 1; min-width: 0; }
    .loc-title { font-size: 14px; font-weight: 700; color: var(--artha-text); }
    .loc-sub { font-size: 12px; color: var(--artha-text-muted); margin-top: 2px; }
    .loc-map { font-size: 13px; font-weight: 700; color: var(--artha-accent); text-decoration: none; white-space: nowrap; }
    .loc-find {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; height: 44px; margin-top: 12px; border: 1px solid var(--artha-border); border-radius: 999px;
      background: var(--artha-surface); color: var(--artha-text); cursor: pointer;
      font-family: inherit; font-size: 14px; font-weight: 700;
    }
    .loc-find[disabled] { opacity: 0.7; cursor: default; }
    .loc-find ion-icon { font-size: 17px; color: var(--artha-accent); }
    .loc-find ion-spinner { width: 22px; height: 22px; }
    .loc-msg { margin: 12px 2px 8px; font-size: 12.5px; color: var(--artha-text-muted); }
    .loc-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .loc-chip {
      display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
      height: 36px; padding: 0 14px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--artha-border); background: var(--artha-surface); color: var(--artha-text);
      font-family: inherit; font-size: 13px; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .loc-chip.sel { background: var(--artha-accent); border-color: var(--artha-accent); color: #fff; }
    .loc-dist { font-size: 11.5px; font-weight: 500; opacity: 0.7; }
    .loc-remove {
      display: block; margin: 10px auto 0; padding: 6px 10px; border: 0; background: transparent; cursor: pointer;
      font-family: inherit; font-size: 12.5px; font-weight: 600; color: var(--artha-text-subtle);
    }

    /* More options */
    .more { margin-top: 18px; border-radius: 16px; background: var(--artha-surface-2); }
    .more summary {
      padding: 14px 16px; cursor: pointer; list-style: none;
      font-size: 14px; font-weight: 700; color: var(--artha-text-muted);
    }
    .more summary::-webkit-details-marker { display: none; }
    .more summary::after { content: '+'; float: right; font-weight: 800; }
    .more[open] summary::after { content: '−'; }
    .more-body { padding: 0 16px 14px; }
    .more ion-toggle { width: 100%; --track-background: var(--artha-border-strong); }
    .excl-title { font-size: 14px; color: var(--artha-text); }
    .excl-sub { font-size: 12px; color: var(--artha-text-muted); margin-top: 2px; }

    /* Sticky save */
    .save-bar {
      position: sticky; bottom: 0; z-index: 5;
      background: var(--artha-surface);
      padding: 12px 20px 16px;
      max-width: 640px; margin: 0 auto;
    }
    /* Soft fade so content scrolling under the button doesn't end in a hard cut. */
    .save-bar::before {
      content: ''; position: absolute; left: 0; right: 0; top: -20px; height: 20px; pointer-events: none;
      background: linear-gradient(to bottom, transparent, var(--artha-surface));
    }
    .save-btn {
      width: 100%; height: 56px; border: 0; border-radius: 18px; cursor: pointer;
      background: var(--artha-accent); color: #fff;
      font-family: inherit; font-size: 16px; font-weight: 800;
      box-shadow: 0 8px 20px -10px rgba(79, 70, 229, 0.8);
    }
    .save-btn:disabled { opacity: 0.45; box-shadow: none; cursor: default; }
    @media (max-width: 767.98px) {
      /* Sit above the floating tab bar (68px tall, 16px off the bottom). */
      /* The bar sits on the screen's bottom edge and its own background fills
         the space behind the tab bar, so nothing shows between the two. The
         page's usual tab-bar padding is then already inside the bar. */
      :host ion-content { --padding-bottom: 0px; }
      .save-bar { bottom: 0; padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
    }
  `],
})
export class ExpenseEditPage implements OnInit {
  private readonly expensesStore = inject(ExpensesStore);
  protected readonly categoriesStore = inject(CategoriesStore);
  protected readonly accountsStore = inject(AccountsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly notifier = inject(ConflictNotifierService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  protected readonly ai = inject(AiProviderService);
  private readonly sms = inject(SmsCaptureService);

  /** Where the phone was when the SMS came in (expenses from SMS only). */
  protected readonly location = signal<ExpenseLocation | null>(null);
  /** Set when the user removed it, so the save clears it in Drive. */
  private locationRemoved = false;
  /** New expense: the location reading in progress. */
  private locating: Promise<ExpenseLocation | null> | null = null;
  /** null = not looked up yet. */
  protected readonly places = signal<NearbyPlace[] | null>(null);
  protected readonly placesBusy = signal(false);
  protected readonly placesError = signal<string | null>(null);

  protected locationLabel(loc: ExpenseLocation): string {
    const d = new Date(loc.at);
    const when = Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const acc = loc.accuracy != null ? `±${Math.round(loc.accuracy)} m` : '';
    return [when, acc].filter(Boolean).join(' · ') || `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
  }

  protected mapsUrl(loc: ExpenseLocation): string {
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
  }

  protected async findPlaces(loc: ExpenseLocation): Promise<void> {
    this.placesBusy.set(true);
    this.placesError.set(null);
    try {
      this.places.set(await this.sms.findNearbyPlaces(loc.lat, loc.lng));
    } catch {
      this.placesError.set("The map service didn't answer (it's often busy). Check the connection and try again.");
      this.places.set([]);
    } finally {
      this.placesBusy.set(false);
    }
  }

  /** Shop tapped from "Find nearby shops"; learned for the alert when saved. */
  private pickedPlace: string | null = null;

  protected usePlace(p: NearbyPlace): void {
    this.pickedPlace = p.name;
    this.form.patchValue({ note: p.name });
    this.form.controls.note.markAsDirty();
  }

  protected removeLocation(): void {
    this.location.set(null);
    this.places.set(null);
    this.locationRemoved = true;
  }

  protected readonly aiBusy = signal(false);
  protected readonly aiMessage = signal<{ text: string; ok: boolean } | null>(null);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly mode = signal<'create' | 'edit'>('create');
  protected readonly categories = computed(() => this.categoriesStore.active());
  protected readonly accounts = computed(() => this.accountsStore.active());

  protected readonly form = this.fb.nonNullable.group({
    date: [this.today(), Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    categoryId: ['', Validators.required],
    accountId: [DEFAULT_ACCOUNT_ID, Validators.required],
    note: [''],
    excluded: [false],
    type: ['expense' as TransactionType, Validators.required],
  });

  protected isIncome(): boolean {
    return this.form.controls.type.value === 'income';
  }

  protected setType(type: TransactionType): void {
    this.form.patchValue({ type });
  }

  /**
   * Category tiles: the most recently used active categories, topped up with
   * top-level ones. The current selection is always shown (first if it would
   * otherwise be missing), so a subcategory chosen via More stays visible.
   */
  protected quickCategories(): Category[] {
    const byId = this.categoriesStore.byId();
    const ids: string[] = [];
    const push = (id: string | null | undefined) => {
      const c = id ? byId[id] : undefined;
      if (c && !c.archived && !ids.includes(c.id)) ids.push(c.id);
    };
    const recent = [...this.expensesStore.items()].sort((a, b) => b.date.localeCompare(a.date));
    for (const e of recent) {
      if (ids.length >= QUICK_CATEGORY_COUNT) break;
      push(e.categoryId);
    }
    for (const c of this.categories()) {
      if (ids.length >= QUICK_CATEGORY_COUNT) break;
      if (!c.parentId) push(c.id);
    }
    const selected = this.form.controls.categoryId.value;
    if (selected && byId[selected] && !ids.includes(selected)) {
      ids.unshift(selected);
      ids.length = Math.min(ids.length, QUICK_CATEGORY_COUNT);
    }
    return ids.map((id) => byId[id]);
  }

  protected isSelected(c: Category): boolean {
    return this.form.controls.categoryId.value === c.id;
  }

  protected selectCategory(id: string): void {
    this.form.patchValue({ categoryId: id });
    this.form.controls.categoryId.markAsDirty();
  }

  /** Ask the AI provider which category fits this expense's note. */
  protected async suggestCategory(): Promise<void> {
    const note = this.form.controls.note.value.trim();
    if (!note) {
      this.aiMessage.set({ text: 'Add a note first, e.g. "Lunch at Truffles".', ok: false });
      return;
    }
    this.aiBusy.set(true);
    this.aiMessage.set(null);
    try {
      const categories = this.categories().map((c) => ({
        id: c.id,
        name: this.categoriesStore.pathLabel(c.id) || c.name,
      }));
      const suggestion = await this.ai.suggestForExpense(
        { note, amount: this.form.controls.amount.value, date: this.form.controls.date.value },
        categories,
      );
      if (suggestion?.categoryId) {
        this.selectCategory(suggestion.categoryId);
        const name = this.categoriesStore.pathLabel(suggestion.categoryId);
        this.aiMessage.set({ text: `AI picked ${name}. Tap another category to change it.`, ok: true });
      } else {
        this.aiMessage.set({ text: "The AI couldn't match a category. Pick one below.", ok: false });
      }
    } catch (err) {
      this.aiMessage.set({ text: err instanceof Error ? err.message : 'The AI request failed.', ok: false });
    } finally {
      this.aiBusy.set(false);
    }
  }

  /** "Food · Cafés" for a subcategory selection; null for a top-level one. */
  protected selectedPath(): string | null {
    const id = this.form.controls.categoryId.value;
    const c = id ? this.categoriesStore.byId()[id] : undefined;
    return c?.parentId ? this.categoriesStore.pathLabel(id) : null;
  }

  protected async openCategoryPicker(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CategorySearchModal,
      componentProps: {
        options: this.categoriesStore.pickerOptions(),
        includeNone: false,
        allowCreate: true,
        selectedId: this.form.controls.categoryId.value || null,
        title: 'Category',
      },
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<string | null>();
    if (role === 'select' && data) {
      this.selectCategory(data);
    } else if (role === 'create') {
      const edit = await this.modalCtrl.create({ component: CategoryEditModal });
      await edit.present();
      const res = await edit.onWillDismiss<Category>();
      if (res.role === 'saved' && res.data?.id) {
        this.selectCategory(res.data.id);
      }
    }
  }

  protected accountName(): string {
    return this.accountsStore.byId()[this.form.controls.accountId.value]?.name ?? '';
  }

  protected async pickAccount(): Promise<void> {
    const current = this.form.controls.accountId.value;
    const sheet = await this.actionSheetCtrl.create({
      header: 'Account',
      buttons: [
        ...this.accounts().map((a) => ({
          text: a.id === current ? `✓  ${a.name}` : a.name,
          handler: () => {
            this.form.patchValue({ accountId: a.id });
          },
        })),
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /** "Today", "Yesterday" or e.g. "12 Oct" for the chosen date. */
  protected dateLabel(): string {
    if (this.isToday()) return 'Today';
    if (this.isYesterday()) return 'Yesterday';
    const v = this.dateValue();
    const d = new Date(`${v}T00:00:00`);
    if (Number.isNaN(d.getTime())) return v || 'Date';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  }

  private editingId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      const loads: Promise<void>[] = [];
      if (this.categoriesStore.items().length === 0) loads.push(this.categoriesStore.load());
      if (this.accountsStore.items().length === 0) loads.push(this.accountsStore.load());
      await Promise.all(loads);

      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        this.mode.set('edit');
        this.editingId = id;
        let expense = this.expensesStore.findById(id);
        if (!expense) {
          await this.expensesStore.load();
          expense = this.expensesStore.findById(id);
        }
        if (expense) {
          this.form.patchValue({
            date: expense.date,
            amount: expense.amount,
            categoryId: expense.categoryId,
            accountId: expense.accountId || DEFAULT_ACCOUNT_ID,
            note: expense.note ?? '',
            excluded: expense.excluded ?? false,
            type: expense.type ?? 'expense',
          });
          this.location.set(expense.location ?? null);
        }
      } else {
        // A new expense saves where you are now (Settings → "Save location with expenses").
        this.locating = this.sms.currentLocation().then((l) => {
          if (l && !this.locationRemoved && !this.location()) this.location.set(l);
          return l;
        });
        const firstCat = this.categories()[0];
        if (firstCat) {
          this.form.patchValue({ categoryId: firstCat.id });
        }
        const firstAcc = this.accounts()[0];
        if (firstAcc) {
          this.form.patchValue({ accountId: firstAcc.id });
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Turn this expense into a planned (recurring) bill — prefill the planned
      editor with its amount, category, name and day, for the user to confirm. */
  protected makeRecurring(): void {
    const raw = this.form.getRawValue();
    const date = this.dateValue();
    const day = date ? Number(date.slice(8, 10)) : NaN;
    const catName = raw.categoryId ? this.categoriesStore.byId()[raw.categoryId]?.name ?? null : null;
    void this.router.navigate(['/planned-expenses/new'], {
      state: {
        name: raw.note?.trim() || catName || '',
        amount: raw.amount || null,
        categoryId: raw.categoryId || null,
        dayOfMonth: Number.isFinite(day) && day >= 1 && day <= 31 ? day : null,
        intervalMonths: 1,
      },
    });
  }

  async save(): Promise<void> {
    if (this.form.invalid) return;
    this.saving.set(true);
    const raw = this.form.getRawValue();
    const payload = {
      date: this.toDateOnly(raw.date),
      amount: Number(raw.amount),
      categoryId: raw.categoryId,
      accountId: raw.accountId,
      note: raw.note?.trim() || null,
      excluded: raw.excluded,
      type: raw.type,
      // Omitted keeps the saved location; null clears it.
      ...(this.locationRemoved ? { location: null } : {}),
    };
    try {
      if (this.editingId) {
        await this.expensesStore.update(this.editingId, payload);
        const loc = this.location();
        if (loc && this.pickedPlace && payload.note === this.pickedPlace) {
          void this.sms.rememberPlaceAt(loc, this.pickedPlace, payload.categoryId);
        }
      } else {
        // Give a reading still in progress a moment, so the expense isn't saved without it.
        let loc = this.locationRemoved ? null : this.location();
        if (!loc && !this.locationRemoved && this.locating) {
          loc = await Promise.race([this.locating, new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
        }
        await this.expensesStore.add({ ...payload, ...(loc ? { location: loc } : {}) });
      }
      await this.router.navigate(['/expenses']);
    } catch (err) {
      await this.notifier.notifyError(
        this.editingId ? 'Could not save changes.' : 'Could not add expense.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  /** Currency symbol for the selected account, e.g. ₹ / $ / €. */
  protected currencySymbol(): string {
    const acc = this.accountsStore.byId()[this.form.controls.accountId.value];
    const code = acc?.currency || 'INR';
    try {
      const parts = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: code,
      }).formatToParts(0);
      return parts.find((p) => p.type === 'currency')?.value ?? code;
    } catch {
      return code;
    }
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement | null)?.select();
  }

  protected isToday(): boolean {
    return this.dateValue() === this.today();
  }

  protected isYesterday(): boolean {
    return this.dateValue() === this.daysAgo(1);
  }

  protected setDate(days: number): void {
    this.form.patchValue({ date: this.daysAgo(days) });
  }

  private dateValue(): string {
    return this.toDateOnly(this.form.controls.date.value);
  }

  private daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private toDateOnly(value: string): string {
    // ion-datetime returns "2026-05-15T00:00:00.000+00:00" sometimes; trim.
    return (value ?? '').slice(0, 10);
  }
}
