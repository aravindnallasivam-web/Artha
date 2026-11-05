import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  AlertController,
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonModal,
  IonSearchbar,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { InvestmentsStore } from './investments.store';
import { FundDetails, MarketDataService, StockDetails } from './market-data.service';
import { PricePoint, sliceForChart, standardReturns } from './price-history';

const RANGES: { label: string; months: number | null }[] = [
  { label: '1M', months: 1 },
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
  { label: '3Y', months: 36 },
  { label: '5Y', months: 60 },
  { label: 'All', months: null },
];

@Component({
  selector: 'artha-investment-detail',
  standalone: true,
  imports: [
    CurrencyPipe,
    DecimalPipe,
    IonBackButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonModal,
    IonSearchbar,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/investments" text="" aria-label="Back"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ isFund() ? 'Mutual fund' : 'Stock' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="wrap">
        @if (row(); as r) {
          <section class="hero">
            <h1>{{ r.holding.name }}</h1>
            @if (fund(); as f) {
              <p class="sub">{{ f.fundHouse }}@if (f.category) { · {{ f.category }} }</p>
            } @else if (stock()?.exchange; as ex) {
              <p class="sub">{{ shortSymbol(r.holding.symbol) }} · {{ ex }}</p>
            }
            <div class="hero-value num">{{ r.value | currency: 'INR' : 'symbol' : '1.0-0' }}</div>
            <div class="hero-pnl num" [class.up]="r.pnl >= 0" [class.down]="r.pnl < 0">
              {{ sign(r.pnl) }}{{ abs(r.pnl) | currency: 'INR' : 'symbol' : '1.0-0' }}
              @if (r.pnlPct != null) { ({{ sign(r.pnl) }}{{ abs(r.pnlPct) | number: '1.1-1' }}%) } overall
            </div>
            @if (r.price != null) {
              <div class="hero-price num">
                {{ isFund() ? 'NAV' : 'Price' }} {{ r.price | currency: 'INR' : 'symbol' : '1.2-2' }}
                @if (r.asOf) { · {{ shortDate(r.asOf) }} }
                @if (r.source === 'statement') { <span class="tag">from statement</span> }
              </div>
            }
          </section>

          @if (!r.holding.symbol) {
            <section class="card warn">
              <p>Artha couldn't match this {{ isFund() ? 'fund' : 'stock' }} to live {{ isFund() ? 'NAVs' : 'prices' }} automatically, so it uses the price from your statement.</p>
              <button type="button" class="btn" (click)="changeMatch()">{{ isFund() ? 'Choose the fund' : 'Set the NSE symbol' }}</button>
            </section>
          }

          <section class="card">
            <div class="ranges" role="group" aria-label="Chart range">
              @for (rg of ranges; track rg.label) {
                <button type="button" [class.on]="range() === rg.label" [attr.aria-pressed]="range() === rg.label" (click)="range.set(rg.label)">{{ rg.label }}</button>
              }
            </div>
            @if (loadingHistory()) {
              <div class="chart-empty"><ion-spinner name="crescent"></ion-spinner></div>
            } @else if (chart(); as c) {
              <div class="chart-change num" [class.up]="c.change >= 0" [class.down]="c.change < 0">
                {{ sign(c.change) }}{{ abs(c.change) | number: '1.1-1' }}% <span>{{ c.fromLabel }} – {{ c.toLabel }}</span>
              </div>
              <svg viewBox="0 0 360 160" preserveAspectRatio="none" class="chart" role="img"
                   [attr.aria-label]="(isFund() ? 'NAV' : 'Price') + ' history, ' + range()">
                <path [attr.d]="c.area" [attr.fill]="c.change >= 0 ? 'var(--artha-positive)' : 'var(--artha-negative)'" fill-opacity="0.1" />
                <polyline [attr.points]="c.line" fill="none" [attr.stroke]="c.change >= 0 ? 'var(--artha-positive)' : 'var(--artha-negative)'"
                          stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
              </svg>
              <div class="chart-axis num"><span>{{ c.min | currency: 'INR' : 'symbol' : '1.0-2' }}</span><span>{{ c.max | currency: 'INR' : 'symbol' : '1.0-2' }}</span></div>
            } @else {
              <div class="chart-empty">{{ historyError() || 'No history available.' }}</div>
            }
          </section>

          @if (returns().length) {
            <section class="card">
              <h2>Returns</h2>
              <div class="returns">
                @for (rt of returns(); track rt.label) {
                  <div>
                    <span class="k">{{ rt.label }}{{ rt.annualised ? ' p.a.' : '' }}</span>
                    @if (rt.pct != null) {
                      <span class="v num" [class.up]="rt.pct >= 0" [class.down]="rt.pct < 0">{{ sign(rt.pct) }}{{ abs(rt.pct) | number: '1.1-1' }}%</span>
                    } @else {
                      <span class="v muted">—</span>
                    }
                  </div>
                }
              </div>
              <p class="note">{{ isFund() ? 'Fund' : 'Price' }} returns over each period, not your own returns. 3Y and 5Y are annualised.</p>
            </section>
          }

          <section class="card">
            <h2>Your holding</h2>
            <dl class="facts">
              @if (r.holding.platform) { <dt>Platform</dt><dd>{{ r.holding.platform }}</dd> }
              <dt>{{ isFund() ? 'Units' : 'Quantity' }}</dt><dd class="num">{{ r.holding.quantity | number: '1.0-4' }}</dd>
              <dt>{{ isFund() ? 'Average NAV' : 'Average price' }}</dt><dd class="num">{{ r.holding.avgPrice | currency: 'INR' : 'symbol' : '1.2-2' }}</dd>
              <dt>Invested</dt><dd class="num">{{ r.invested | currency: 'INR' : 'symbol' : '1.0-0' }}</dd>
              <dt>Current value</dt><dd class="num">{{ r.value | currency: 'INR' : 'symbol' : '1.0-0' }}</dd>
              @if (r.dayChange != null) {
                <dt>Today</dt>
                <dd class="num" [class.up]="r.dayChange >= 0" [class.down]="r.dayChange < 0">{{ sign(r.dayChange) }}{{ abs(r.dayChange) | currency: 'INR' : 'symbol' : '1.0-0' }}</dd>
              }
              @if (r.holding.statementPrice != null) {
                <dt>{{ isFund() ? 'NAV in statement' : 'Price in statement' }}</dt><dd class="num">{{ r.holding.statementPrice | currency: 'INR' : 'symbol' : '1.2-2' }}</dd>
              }
            </dl>
          </section>

          <section class="card">
            <h2>About</h2>
            <dl class="facts">
              @if (fund(); as f) {
                <dt>Scheme</dt><dd>{{ f.name }}</dd>
                @if (f.fundHouse) { <dt>Fund house</dt><dd>{{ f.fundHouse }}</dd> }
                @if (f.category) { <dt>Category</dt><dd>{{ f.category }}</dd> }
                @if (f.type) { <dt>Type</dt><dd>{{ f.type }}</dd> }
                <dt>AMFI code</dt><dd class="num">{{ f.code }}</dd>
                @if (f.isin || r.holding.isin) { <dt>ISIN</dt><dd class="num">{{ f.isin || r.holding.isin }}</dd> }
                @if (f.history.length) { <dt>NAV since</dt><dd>{{ shortDate(f.history[0].date, true) }}</dd> }
              } @else {
                @if (r.holding.symbol) { <dt>Symbol</dt><dd>{{ r.holding.symbol }}</dd> }
                @if (stock()?.name; as n) { <dt>Company</dt><dd>{{ n }}</dd> }
                @if (r.holding.isin) { <dt>ISIN</dt><dd class="num">{{ r.holding.isin }}</dd> }
              }
            </dl>
            @if (r.holding.symbol) {
              <button type="button" class="link" (click)="changeMatch()">
                {{ isFund() ? 'Wrong fund? Change match' : 'Wrong stock? Change symbol' }}
              </button>
            }
          </section>
        } @else if (store.loaded()) {
          <p class="missing">This holding isn't in your investments anymore.</p>
        } @else {
          <div class="chart-empty"><ion-spinner name="crescent"></ion-spinner></div>
        }
      </div>

      <ion-modal [isOpen]="pickerOpen()" (didDismiss)="pickerOpen.set(false)">
        <ng-template>
          <ion-header>
            <ion-toolbar>
              <ion-title>Choose the fund</ion-title>
              <ion-buttons slot="end"><button type="button" class="close" (click)="pickerOpen.set(false)">Close</button></ion-buttons>
            </ion-toolbar>
            <ion-toolbar>
              <ion-searchbar [value]="pickerQuery()" [debounce]="350" placeholder="Search scheme name"
                             (ionInput)="searchFunds($any($event).detail.value ?? '')"></ion-searchbar>
            </ion-toolbar>
          </ion-header>
          <ion-content>
            <div class="picker">
              @if (pickerBusy()) {
                <div class="chart-empty"><ion-spinner name="crescent"></ion-spinner></div>
              } @else if (pickerResults().length === 0) {
                <p class="note pad">Type at least 3 letters of the scheme name, e.g. "parag parikh flexi".</p>
              }
              @for (f of pickerResults(); track f.code) {
                <button type="button" class="pick" [class.on]="row()?.holding?.symbol === 'mf:' + f.code" (click)="pickFund(f.code)">
                  <span>{{ f.name }}</span><small class="num">{{ f.code }}</small>
                </button>
              }
            </div>
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .wrap { padding: 8px 20px 32px; max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
    .num { font-variant-numeric: tabular-nums; }
    .up { color: var(--artha-positive); }
    .down { color: var(--artha-negative); }
    .muted { color: var(--artha-text-subtle); }
    .hero { padding: 4px 4px 4px; }
    .hero h1 { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; color: var(--artha-text); line-height: 1.25; }
    .sub { margin: 4px 0 0; font-size: 13px; color: var(--artha-text-muted); }
    .hero-value { margin-top: 12px; font-size: 30px; font-weight: 800; letter-spacing: -0.03em; color: var(--artha-text); }
    .hero-pnl { margin-top: 2px; font-size: 14px; font-weight: 700; }
    .hero-price { margin-top: 4px; font-size: 12.5px; color: var(--artha-text-subtle); }
    .tag { margin-left: 4px; padding: 1px 6px; border-radius: 999px; background: var(--artha-surface-2); font-size: 10.5px; font-weight: 700; }
    .card { padding: 16px; border-radius: var(--artha-radius-xl, 22px); background: var(--artha-surface); }
    .card h2 { margin: 0 0 10px; font-size: 15px; font-weight: 800; color: var(--artha-text); }
    .warn { background: color-mix(in srgb, var(--artha-warning, #f59e0b) 12%, var(--artha-surface)); }
    .warn p { margin: 0 0 10px; font-size: 13.5px; color: var(--artha-text); line-height: 1.45; }
    .btn { height: 40px; padding: 0 16px; border: 0; border-radius: 12px; background: var(--artha-accent); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
    .ranges { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--artha-surface-2); }
    .ranges button { flex: 1; height: 32px; border: 0; border-radius: 999px; background: transparent; color: var(--artha-text-muted); font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
    .ranges button.on { background: var(--artha-surface); color: var(--artha-text); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12); }
    .chart-change { margin: 12px 0 6px; font-size: 15px; font-weight: 800; }
    .chart-change span { margin-left: 6px; font-size: 12px; font-weight: 600; color: var(--artha-text-subtle); }
    .chart { display: block; width: 100%; height: 160px; }
    .chart-axis { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: var(--artha-text-subtle); }
    .chart-empty { display: grid; place-items: center; min-height: 160px; font-size: 13px; color: var(--artha-text-subtle); text-align: center; }
    .returns { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
    .returns > div { display: flex; flex-direction: column; gap: 2px; }
    .returns .k { font-size: 11px; font-weight: 600; color: var(--artha-text-subtle); }
    .returns .v { font-size: 14px; font-weight: 800; }
    .note { margin: 10px 0 0; font-size: 11.5px; line-height: 1.45; color: var(--artha-text-subtle); }
    .note.pad { padding: 16px 20px; margin: 0; }
    .facts { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: 0; font-size: 13.5px; }
    .facts dt { color: var(--artha-text-muted); }
    .facts dd { margin: 0; text-align: right; font-weight: 600; color: var(--artha-text); word-break: break-word; }
    .link { margin-top: 14px; padding: 0; border: 0; background: none; font: inherit; font-size: 13.5px; font-weight: 700; color: var(--artha-accent); cursor: pointer; }
    .missing { text-align: center; color: var(--artha-text-muted); padding: 48px 0; }
    .close { border: 0; background: none; font: inherit; font-weight: 700; color: var(--artha-accent); padding: 8px 12px; cursor: pointer; }
    .picker { display: flex; flex-direction: column; }
    .pick { display: flex; justify-content: space-between; gap: 12px; padding: 14px 20px; border: 0; border-bottom: 1px solid var(--artha-border); background: var(--artha-surface); color: var(--artha-text); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
    .pick small { color: var(--artha-text-subtle); flex: none; }
    .pick.on { background: var(--artha-accent-tint); font-weight: 700; }
  `],
})
export class InvestmentDetailPage implements OnInit {
  protected readonly store = inject(InvestmentsStore);
  private readonly market = inject(MarketDataService);
  private readonly route = inject(ActivatedRoute);
  private readonly alertCtrl = inject(AlertController);
  private readonly notifier = inject(ConflictNotifierService);

  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly ranges = RANGES;
  protected readonly range = signal('1Y');
  protected readonly fund = signal<FundDetails | null>(null);
  protected readonly stock = signal<StockDetails | null>(null);
  protected readonly loadingHistory = signal(false);
  protected readonly historyError = signal('');

  protected readonly pickerOpen = signal(false);
  protected readonly pickerQuery = signal('');
  protected readonly pickerBusy = signal(false);
  protected readonly pickerResults = signal<{ code: string; name: string }[]>([]);

  protected readonly row = computed(() => this.store.rows().find((r) => r.holding.id === this.id) ?? null);
  protected readonly isFund = computed(() => this.row()?.kind === 'mf');

  private readonly history = computed<PricePoint[]>(() => this.fund()?.history ?? this.stock()?.history ?? []);
  protected readonly returns = computed(() => (this.history().length > 1 ? standardReturns(this.history()) : []));

  protected readonly chart = computed(() => {
    const months = RANGES.find((r) => r.label === this.range())?.months ?? null;
    const pts = sliceForChart(this.history(), months);
    if (pts.length < 2) return null;
    const values = pts.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    const xy = pts.map((p, i) => ({
      x: (i / (pts.length - 1)) * 360,
      y: 150 - ((p.value - min) / spread) * 140,
    }));
    const line = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = `M0,160 L${xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')} L360,160 Z`;
    const first = pts[0];
    const last = pts[pts.length - 1];
    return {
      line,
      area,
      min,
      max,
      change: ((last.value - first.value) / first.value) * 100,
      fromLabel: this.shortDate(first.date, true),
      toLabel: this.shortDate(last.date, true),
    };
  });

  async ngOnInit(): Promise<void> {
    await this.store.load().catch(() => undefined);
    await this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    const symbol = this.row()?.holding.symbol;
    this.fund.set(null);
    this.stock.set(null);
    this.historyError.set('');
    if (!symbol) return;
    this.loadingHistory.set(true);
    try {
      if (symbol.startsWith('mf:')) {
        this.fund.set(await this.market.fundDetails(symbol));
      } else {
        this.stock.set(await this.market.stockDetails(symbol));
        this.range.set(this.range() === 'All' ? '5Y' : this.range());
      }
      if (!this.fund() && !this.stock()) this.historyError.set("Couldn't load the history right now.");
    } finally {
      this.loadingHistory.set(false);
    }
  }

  protected async changeMatch(): Promise<void> {
    const r = this.row();
    if (!r) return;
    if (this.isFund()) {
      this.pickerResults.set([]);
      this.pickerOpen.set(true);
      await this.searchFunds(r.holding.name.replace(/\b(direct|regular|growth|idcw|plan|option|fund)\b/gi, ' ').replace(/\s+/g, ' ').trim());
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'NSE symbol',
      message: 'Enter the symbol as on NSE, e.g. RELIANCE or HDFCBANK.',
      inputs: [{ name: 'symbol', type: 'text', value: this.shortSymbol(r.holding.symbol), attributes: { autocapitalize: 'characters' } }],
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Save', role: 'confirm' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values: { symbol: string } }>();
    const raw = data?.values?.symbol?.trim().toUpperCase();
    if (role !== 'confirm' || !raw) return;
    const symbol = /\.(NS|BO)$/.test(raw) ? raw : `${raw}.NS`;
    await this.store.setSymbol(r.holding.id, symbol);
    await this.loadHistory();
  }

  protected async searchFunds(query: string): Promise<void> {
    this.pickerQuery.set(query);
    if (query.trim().length < 3) {
      this.pickerResults.set([]);
      return;
    }
    this.pickerBusy.set(true);
    try {
      this.pickerResults.set(await this.market.searchFunds(query));
    } finally {
      this.pickerBusy.set(false);
    }
  }

  protected async pickFund(code: string): Promise<void> {
    const r = this.row();
    if (!r) return;
    this.pickerOpen.set(false);
    try {
      await this.store.setSymbol(r.holding.id, `mf:${code}`);
      await this.loadHistory();
    } catch {
      await this.notifier.notifyError('Could not save the fund.');
    }
  }

  protected sign(n: number): string {
    return n > 0 ? '+' : n < 0 ? '−' : '';
  }

  protected abs(n: number): number {
    return Math.abs(n);
  }

  protected shortSymbol(symbol: string | null): string {
    return (symbol ?? '').replace(/\.(NS|BO)$/, '');
  }

  protected shortDate(iso: string, withYear = false): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  }
}
