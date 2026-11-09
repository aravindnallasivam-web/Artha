import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AlertController, IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { HoldingKind } from '../../core/models/investment.model';
import { HoldingRow, InvestmentsStore, summarize } from './investments.store';

const COMBINE_KEY = 'artha.investments.combine';

/** One line in the list: a holding, or the same stock / fund held on several platforms. */
interface DisplayRow {
  key: string;
  rows: HoldingRow[];
  /** First row, for name / kind / symbol / price. */
  lead: HoldingRow;
  quantity: number;
  avgPrice: number;
  invested: number;
  value: number;
  pnl: number;
  pnlPct: number | null;
  platforms: string[];
}

/** Same stock across brokers: by price symbol, else by name without Ltd / Limited / punctuation. */
function groupKey(r: HoldingRow): string {
  const name = r.holding.name.toLowerCase().replace(/\b(the|limited|ltd)\b/g, '').replace(/[^a-z0-9]/g, '');
  return `${r.kind}|${r.holding.symbol ?? name}`;
}

function toDisplay(key: string, rows: HoldingRow[]): DisplayRow {
  const quantity = rows.reduce((n, r) => n + r.holding.quantity, 0);
  const invested = rows.reduce((n, r) => n + r.invested, 0);
  const value = rows.reduce((n, r) => n + r.value, 0);
  const pnl = value - invested;
  return {
    key,
    rows,
    lead: rows[0],
    quantity,
    avgPrice: quantity > 0 ? invested / quantity : 0,
    invested,
    value,
    pnl,
    pnlPct: invested > 0 && rows.some((r) => r.price != null) ? (pnl / invested) * 100 : null,
    platforms: [...new Set(rows.map((r) => r.holding.platform ?? 'Unknown platform'))],
  };
}

const DEFAULT_PLATFORMS = ['Groww', 'Zerodha', 'Upstox', 'Angel One', 'Kuvera', 'Paytm Money', 'ICICI Direct', 'HDFC Securities'];
const LAST_PLATFORM_KEY = 'artha.investments.lastPlatform';

/** Platform suggested by a statement's file name ("Groww_Holdings.xlsx" → Groww). */
function guessPlatform(fileName: string, options: string[]): string | null {
  const name = fileName.toLowerCase();
  const rules: [RegExp, string][] = [
    [/groww/, 'Groww'],
    [/zerodha|kite|console|coin/, 'Zerodha'],
    [/upstox/, 'Upstox'],
    [/angel/, 'Angel One'],
    [/kuvera/, 'Kuvera'],
    [/paytm/, 'Paytm Money'],
    [/icici/, 'ICICI Direct'],
    [/hdfc ?sec/, 'HDFC Securities'],
  ];
  const hit = rules.find(([re]) => re.test(name))?.[1];
  return hit ?? options.find((o) => name.includes(o.toLowerCase().replace(/\s+/g, ''))) ?? null;
}

@Component({
  selector: 'artha-investments',
  standalone: true,
  imports: [CurrencyPipe, DecimalPipe, RouterLink, IonContent, IonIcon, IonSpinner],
  template: `
    <ion-content>
      <div class="wrap">
        <div class="head">
          <h1>Investments</h1>
          <div class="head-actions">
            @if (store.rows().length > 0) {
              <button type="button" class="icon-btn" aria-label="Refresh prices" [disabled]="store.refreshing()" (click)="refresh()">
                @if (store.refreshing()) { <ion-spinner name="crescent"></ion-spinner> } @else { <ion-icon name="sync-outline"></ion-icon> }
              </button>
            }
            <button type="button" class="import-btn" [disabled]="importing()" (click)="fileInput.click()">
              @if (importing()) { <ion-spinner name="crescent"></ion-spinner> } @else { <ion-icon name="cloud-upload-outline"></ion-icon> }
              Import
            </button>
            <input #fileInput type="file" accept=".xlsx,.csv" hidden (change)="onFile($event)" />
          </div>
        </div>

        @if (store.loading() && !store.loaded()) {
          <div class="center"><ion-spinner name="crescent"></ion-spinner></div>
        } @else if (store.rows().length === 0) {
          <section class="empty">
            <span class="empty-badge"><ion-icon name="trending-up-outline"></ion-icon></span>
            <h2>Track your stocks and mutual funds</h2>
            <p>Import the holdings reports from your broker and Artha keeps prices and NAVs up to date.</p>
            <ol>
              <li>In Groww, download the <b>holdings report</b> as Excel, once for <b>Stocks</b> and once for <b>Mutual Funds</b>.</li>
              <li>Tap <b>Import</b> above, choose a file (.xlsx or .csv) and pick the platform it's from. Import the second one the same way.</li>
              <li>Import a fresh report whenever you buy or sell; it only replaces holdings from that platform, of the same kind.</li>
            </ol>
          </section>
        } @else {
          @if (store.platforms().length > 1) {
            <div class="chips" role="group" aria-label="Platform">
              <button type="button" [class.on]="!platformFilter()" (click)="platformFilter.set('')">All</button>
              @for (p of store.platforms(); track p) {
                <button type="button" [class.on]="platformFilter() === p" (click)="platformFilter.set(p)">{{ p }}</button>
              }
            </div>
            @if (!platformFilter()) {
              <label class="combine">
                <input type="checkbox" [checked]="combine()" (change)="setCombine($any($event.target).checked)" />
                <span class="switch" aria-hidden="true"></span>
                <span class="combine-text">
                  Combine same stock
                  <small>{{ combine() ? 'Holdings on several platforms show as one line' : 'Each platform listed separately' }}</small>
                </span>
              </label>
            }
          }
          @let t = totals();
          <section class="summary">
            <div class="sum-label">Current value</div>
            <div class="sum-value num">{{ t.value | currency: currency() : 'symbol' : '1.0-0' }}</div>
            <div class="sum-row">
              <div>
                <div class="sum-k">Total P&amp;L</div>
                <div class="sum-v num" [class.up]="t.pnl >= 0" [class.down]="t.pnl < 0">
                  {{ sign(t.pnl) }}{{ abs(t.pnl) | currency: currency() : 'symbol' : '1.0-0' }}
                  @if (t.pnlPct != null) { <span class="pct">({{ sign(t.pnl) }}{{ abs(t.pnlPct) | number: '1.1-1' }}%)</span> }
                </div>
              </div>
              <div>
                <div class="sum-k">{{ fundRows().length && stockRows().length ? 'Today (stocks)' : 'Today' }}</div>
                @if (t.dayChange != null) {
                  <div class="sum-v num" [class.up]="t.dayChange >= 0" [class.down]="t.dayChange < 0">
                    {{ sign(t.dayChange) }}{{ abs(t.dayChange) | currency: currency() : 'symbol' : '1.0-0' }}
                    @if (t.dayChangePct != null) { <span class="pct">({{ sign(t.dayChange) }}{{ abs(t.dayChangePct) | number: '1.1-1' }}%)</span> }
                  </div>
                } @else {
                  <div class="sum-v muted">—</div>
                }
              </div>
              <div>
                <div class="sum-k">Invested</div>
                <div class="sum-v num">{{ t.invested | currency: currency() : 'symbol' : '1.0-0' }}</div>
              </div>
            </div>
          </section>

          <p class="meta">
            {{ countLabel() }}
            @if (pricesLabel(); as p) { · Prices {{ p }} }
            @if (t.liveCount < t.count) { · {{ t.count - t.liveCount }} using statement price }
          </p>

          @for (section of sections(); track section.title) {
            <div class="section-head">
              <span class="section-title">
                {{ section.title }}
                <button type="button" class="section-remove" (click)="removeKind(section.kind)"
                  [attr.aria-label]="'Remove ' + (platformFilter() ? platformFilter() + ' ' : 'all ') + section.title.toLowerCase()">
                  Remove
                </button>
              </span>
              <span class="num" [class.up]="section.pnl >= 0" [class.down]="section.pnl < 0">
                {{ section.value | currency: currency() : 'symbol' : '1.0-0' }} · {{ sign(section.pnl) }}{{ abs(section.pnl) | currency: currency() : 'symbol' : '1.0-0' }}
              </span>
            </div>
            <div class="list">
              @for (d of section.items; track d.key) {
                @if (d.rows.length === 1) {
                  @let r = d.lead;
                  <a class="row" [routerLink]="['/investments', r.holding.id]">
                    <div class="row-main">
                      <div class="row-name">{{ r.holding.name }}</div>
                      <div class="row-sub num">
                        @if (r.kind === 'mf') {
                          {{ r.holding.quantity | number: '1.0-3' }} units × {{ r.holding.avgPrice | currency: currency() : 'symbol' : '1.0-2' }} avg
                          @if (r.holding.platform) { · {{ r.holding.platform }} }
                        } @else {
                          {{ r.holding.quantity | number: '1.0-4' }} × {{ r.holding.avgPrice | currency: currency() : 'symbol' : '1.0-2' }}
                          @if (r.holding.symbol) { · {{ shortSymbol(r.holding.symbol) }} }
                          @if (r.holding.platform) { · {{ r.holding.platform }} }
                        }
                      </div>
                    </div>
                    <div class="row-side">
                      <div class="row-value num">{{ r.value | currency: currency() : 'symbol' : '1.0-0' }}</div>
                      <div class="row-pnl num" [class.up]="r.pnl >= 0" [class.down]="r.pnl < 0">
                        {{ sign(r.pnl) }}{{ abs(r.pnl) | currency: currency() : 'symbol' : '1.0-0' }}
                        @if (r.pnlPct != null) { ({{ sign(r.pnl) }}{{ abs(r.pnlPct) | number: '1.1-1' }}%) }
                      </div>
                      <div class="row-price num">
                        @if (r.price != null) {
                          @if (r.kind === 'mf') { NAV }
                          {{ r.price | currency: currency() : 'symbol' : '1.0-2' }}
                          @if (r.asOf) { · {{ shortDate(r.asOf) }} }
                        }
                        @if (r.source === 'statement') { <span class="tag">statement</span> }
                        @if (r.source === 'none') { <span class="tag">no price</span> }
                      </div>
                    </div>
                  </a>
                } @else {
                  @let r = d.lead;
                  @let open = expanded().has(d.key);
                  <div class="group" [class.open]="open">
                    <button type="button" class="row" (click)="toggle(d.key)" [attr.aria-expanded]="open">
                      <div class="row-main">
                        <div class="row-name">
                          {{ r.holding.name }}
                          <span class="plat-tag">{{ d.platforms.length }} platforms</span>
                        </div>
                        <div class="row-sub num">
                          @if (r.kind === 'mf') {
                            {{ d.quantity | number: '1.0-3' }} units × {{ d.avgPrice | currency: currency() : 'symbol' : '1.0-2' }} avg
                          } @else {
                            {{ d.quantity | number: '1.0-4' }} × {{ d.avgPrice | currency: currency() : 'symbol' : '1.0-2' }} avg
                            @if (r.holding.symbol) { · {{ shortSymbol(r.holding.symbol) }} }
                          }
                        </div>
                        <div class="row-sub">{{ d.platforms.join(' · ') }}</div>
                      </div>
                      <div class="row-side">
                        <div class="row-value num">{{ d.value | currency: currency() : 'symbol' : '1.0-0' }}</div>
                        <div class="row-pnl num" [class.up]="d.pnl >= 0" [class.down]="d.pnl < 0">
                          {{ sign(d.pnl) }}{{ abs(d.pnl) | currency: currency() : 'symbol' : '1.0-0' }}
                          @if (d.pnlPct != null) { ({{ sign(d.pnl) }}{{ abs(d.pnlPct) | number: '1.1-1' }}%) }
                        </div>
                        <div class="row-price num">
                          @if (r.price != null) {
                            @if (r.kind === 'mf') { NAV }
                            {{ r.price | currency: currency() : 'symbol' : '1.0-2' }}
                          }
                          <ion-icon class="chev" [name]="open ? 'chevron-up' : 'chevron-down'"></ion-icon>
                        </div>
                      </div>
                    </button>
                    @if (open) {
                      <div class="subs">
                        @for (sr of d.rows; track sr.holding.id) {
                          <a class="sub" [routerLink]="['/investments', sr.holding.id]">
                            <div class="row-main">
                              <div class="sub-name">{{ sr.holding.platform ?? 'Unknown platform' }}</div>
                              <div class="row-sub num">
                                {{ sr.holding.quantity | number: '1.0-4' }} × {{ sr.holding.avgPrice | currency: currency() : 'symbol' : '1.0-2' }}
                              </div>
                            </div>
                            <div class="row-side">
                              <div class="sub-value num">{{ sr.value | currency: currency() : 'symbol' : '1.0-0' }}</div>
                              <div class="row-pnl num" [class.up]="sr.pnl >= 0" [class.down]="sr.pnl < 0">
                                {{ sign(sr.pnl) }}{{ abs(sr.pnl) | currency: currency() : 'symbol' : '1.0-0' }}
                              </div>
                            </div>
                          </a>
                        }
                      </div>
                    }
                  </div>
                }
              }
            </div>
          }

          <p class="foot">
            {{ importedNote() }}
            Stock prices from Yahoo Finance, delayed about 15 minutes. Fund NAVs from AMFI (via mfapi.in), updated
            once a day. "statement" means the price in your report.
            @if (platformFilter(); as pf) {
              <button type="button" class="link" (click)="removePlatform(pf)">Remove {{ pf }} holdings</button>
            } @else {
              <button type="button" class="link" (click)="clearAll()">Remove all holdings</button>
            }
          </p>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .wrap {
      padding: calc(16px + var(--ion-safe-area-top, 0px)) 20px 24px;
      max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px;
    }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 8px; }
    .head h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.03em; color: var(--artha-text); }
    .head-actions { display: flex; gap: 8px; }
    .icon-btn, .import-btn {
      height: 44px; border-radius: 14px; cursor: pointer; font: inherit;
      border: 1px solid var(--artha-border); background: var(--artha-surface); color: var(--artha-text);
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    }
    .icon-btn { width: 44px; font-size: 20px; }
    .import-btn { padding: 0 14px; font-size: 14px; font-weight: 700; background: var(--artha-accent); color: #fff; border-color: transparent; }
    .import-btn ion-icon { font-size: 18px; }
    .icon-btn[disabled], .import-btn[disabled] { opacity: 0.6; cursor: default; }
    .icon-btn ion-spinner, .import-btn ion-spinner { width: 18px; height: 18px; }
    .import-btn ion-spinner { color: #fff; }
    .center { display: grid; place-items: center; padding: 48px 0; }

    .empty {
      display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px;
      padding: 28px 20px; border-radius: var(--artha-radius-xl, 22px); background: var(--artha-surface);
    }
    .empty-badge {
      width: 56px; height: 56px; border-radius: 18px; display: grid; place-items: center; font-size: 28px;
      background: var(--artha-accent-tint); color: var(--artha-accent);
    }
    .empty h2 { margin: 6px 0 0; font-size: 18px; font-weight: 800; color: var(--artha-text); }
    .empty p { margin: 0; color: var(--artha-text-muted); font-size: 14px; max-width: 380px; }
    .empty ol { margin: 8px 0 0; padding-left: 20px; text-align: left; color: var(--artha-text); font-size: 13.5px; line-height: 1.6; max-width: 420px; }

    .summary { padding: 18px 20px; border-radius: var(--artha-radius-2xl, 24px); background: #0f172a; color: #fff; }
    .sum-label { font-size: 13px; font-weight: 600; color: #cbd5e1; }
    .sum-value { font-size: 32px; font-weight: 800; letter-spacing: -0.03em; margin-top: 2px; }
    .sum-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .sum-k { font-size: 11.5px; font-weight: 600; color: #94a3b8; }
    .sum-v { font-size: 14px; font-weight: 800; margin-top: 2px; }
    .sum-v .pct { font-size: 11.5px; font-weight: 700; opacity: 0.85; }
    .summary .up { color: #6ee7b7; }
    .summary .down { color: #fda4af; }
    .muted { color: #94a3b8; }

    .meta { margin: 0 4px; font-size: 12.5px; color: var(--artha-text-subtle); }
    .chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
    .chips button {
      flex: none; height: 34px; padding: 0 14px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--artha-border); background: var(--artha-surface);
      color: var(--artha-text); font: inherit; font-size: 13px; font-weight: 600;
    }
    .chips button.on { background: var(--artha-tabbar-bg, #0f172a); border-color: transparent; color: #fff; }
    .section-head {
      display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
      margin: 6px 4px -4px; font-size: 13px; font-weight: 800; color: var(--artha-text);
    }
    .section-head .num { font-size: 12.5px; font-weight: 700; }
    .section-title { display: inline-flex; align-items: baseline; gap: 8px; }
    .section-remove {
      border: 0; background: none; padding: 2px 0; cursor: pointer; font: inherit;
      font-size: 12px; font-weight: 700; color: var(--artha-negative);
    }
    .section-head .up { color: var(--artha-positive); }
    .section-head .down { color: var(--artha-negative); }
    .list { display: flex; flex-direction: column; gap: 10px; }
    .row {
      display: flex; justify-content: space-between; gap: 12px;
      padding: 14px; border-radius: 20px; background: var(--artha-surface);
      text-decoration: none; color: inherit; cursor: pointer;
    }
    .row:active { transform: scale(0.99); }
    .row-main { min-width: 0; }
    .row-name { font-size: 14.5px; font-weight: 700; color: var(--artha-text); }
    .row-sub { margin-top: 3px; font-size: 12px; color: var(--artha-text-subtle); }
    .row-side { text-align: right; flex: none; }
    .row-value { font-size: 15px; font-weight: 800; color: var(--artha-text); }
    .row-pnl { margin-top: 2px; font-size: 12.5px; font-weight: 700; }
    .row-price { margin-top: 2px; font-size: 11.5px; color: var(--artha-text-subtle); }
    .row .up { color: var(--artha-positive); }
    .row .down { color: var(--artha-negative); }
    .tag { margin-left: 4px; padding: 1px 6px; border-radius: 999px; background: var(--artha-surface-2); font-size: 10.5px; font-weight: 700; }
    .num { font-variant-numeric: tabular-nums; }

    /* Combine same stock */
    .combine { display: flex; align-items: center; gap: 10px; margin: -4px 4px 0; cursor: pointer; }
    .combine input { position: absolute; opacity: 0; pointer-events: none; }
    .switch {
      flex: none; width: 40px; height: 24px; border-radius: 999px; position: relative;
      background: var(--artha-surface-2); border: 1px solid var(--artha-border); transition: background 0.2s;
    }
    .switch::after {
      content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
      background: var(--artha-surface); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25); transition: transform 0.2s;
    }
    .combine input:checked + .switch { background: var(--artha-accent); border-color: transparent; }
    .combine input:checked + .switch::after { transform: translateX(16px); }
    .combine input:focus-visible + .switch { outline: 2px solid var(--artha-accent); outline-offset: 2px; }
    .combine-text { display: flex; flex-direction: column; font-size: 13.5px; font-weight: 700; color: var(--artha-text); }
    .combine-text small { font-size: 11.5px; font-weight: 500; color: var(--artha-text-subtle); }
    button.row { width: 100%; border: 0; font: inherit; text-align: left; }
    .plat-tag {
      display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; vertical-align: 2px;
      background: var(--artha-accent-tint); color: var(--artha-accent); font-size: 10.5px; font-weight: 800;
    }
    .group { border-radius: 20px; background: var(--artha-surface); }
    .group .row { background: transparent; }
    .chev { margin-left: 4px; font-size: 13px; vertical-align: -2px; }
    .subs { display: flex; flex-direction: column; padding: 0 10px 10px; gap: 6px; }
    .sub {
      display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 14px;
      background: var(--artha-surface-2); text-decoration: none; color: inherit;
    }
    .sub-name { font-size: 13px; font-weight: 700; color: var(--artha-text); }
    .sub-value { font-size: 13.5px; font-weight: 800; color: var(--artha-text); }
    .sub .up { color: var(--artha-positive); }
    .sub .down { color: var(--artha-negative); }
    .foot { margin: 4px 4px 0; font-size: 12px; line-height: 1.5; color: var(--artha-text-subtle); }
    .link { border: 0; background: none; padding: 0; margin-left: 4px; font: inherit; font-weight: 700; color: var(--artha-negative); cursor: pointer; }
  `],
})
export class InvestmentsPage implements OnInit {
  protected readonly store = inject(InvestmentsStore);
  private readonly notifier = inject(ConflictNotifierService);
  private readonly alertCtrl = inject(AlertController);

  protected readonly importing = signal(false);

  /** '' = all platforms. */
  protected readonly platformFilter = signal('');
  protected readonly filteredRows = computed(() => {
    const p = this.platformFilter();
    return p ? this.store.rows().filter((r) => r.holding.platform === p) : this.store.rows();
  });
  protected readonly totals = computed(() => summarize(this.filteredRows()));
  protected readonly stockRows = computed(() => this.filteredRows().filter((r) => r.kind === 'stock'));
  protected readonly fundRows = computed(() => this.filteredRows().filter((r) => r.kind === 'mf'));

  /** Merge the same stock / fund across platforms (All view only). Remembered per device. */
  protected readonly combine = signal(loadCombine());
  protected readonly expanded = signal<Set<string>>(new Set());

  protected setCombine(on: boolean): void {
    this.combine.set(on);
    try {
      localStorage.setItem(COMBINE_KEY, on ? '1' : '0');
    } catch {
      // Not remembered; still applies now.
    }
  }

  protected toggle(key: string): void {
    const next = new Set(this.expanded());
    next.has(key) ? next.delete(key) : next.add(key);
    this.expanded.set(next);
  }

  /** Rows as listed: grouped when combining, one per holding otherwise. */
  private display(rows: HoldingRow[]): DisplayRow[] {
    if (!this.combine() || this.platformFilter()) {
      return rows.map((r) => toDisplay(r.holding.id, [r]));
    }
    const groups = new Map<string, HoldingRow[]>();
    for (const r of rows) {
      const key = groupKey(r);
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.entries()].map(([key, rs]) => toDisplay(key, rs));
  }

  protected readonly sections = computed(() =>
    [
      { title: 'Stocks', kind: 'stock' as HoldingKind, rows: this.stockRows() },
      { title: 'Mutual funds', kind: 'mf' as HoldingKind, rows: this.fundRows() },
    ]
      .filter((s) => s.rows.length > 0)
      .map((s) => {
        const value = s.rows.reduce((n, r) => n + r.value, 0);
        const invested = s.rows.reduce((n, r) => n + r.invested, 0);
        return { ...s, items: this.display(s.rows), value, pnl: value - invested };
      }),
  );

  protected countLabel(): string {
    const items = (title: string) => this.sections().find((s) => s.title === title)?.items.length ?? 0;
    const st = items('Stocks');
    const mf = items('Mutual funds');
    return [st ? `${st} ${st === 1 ? 'stock' : 'stocks'}` : '', mf ? `${mf} ${mf === 1 ? 'fund' : 'funds'}` : '']
      .filter(Boolean)
      .join(' · ');
  }

  protected shortDate(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  // NSE/BSE prices are always in rupees, whatever the app's display currency is.
  protected readonly currency = signal('INR');

  async ngOnInit(): Promise<void> {
    try {
      await this.store.load();
    } catch {
      await this.notifier.notifyError('Could not load your investments.');
      return;
    }
    void this.store.refreshPrices();
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const platform = await this.askPlatform(file.name);
    if (!platform) return;
    this.importing.set(true);
    try {
      const { stocks, funds, skipped } = await this.store.importFile(file, platform);
      const parts = [
        stocks ? `${stocks} ${stocks === 1 ? 'stock' : 'stocks'}` : '',
        funds ? `${funds} mutual ${funds === 1 ? 'fund' : 'funds'}` : '',
      ].filter(Boolean);
      await this.notifier.notifyInfo(
        `Imported ${parts.join(' and ')}` +
          ` from ${platform}` +
          (skipped ? `; ${skipped} ${skipped === 1 ? 'row' : 'rows'} couldn't be read.` : '.'),
      );
    } catch (err) {
      await this.notifier.notifyError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      this.importing.set(false);
    }
  }

  /**
   * Ask which platform a statement is from. Holdings already imported from
   * that platform (of the kinds in the file) are replaced; others are kept.
   */
  private async askPlatform(fileName: string): Promise<string | null> {
    const options = [...new Set([...this.store.platforms(), ...DEFAULT_PLATFORMS])];
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_PLATFORM_KEY);
    } catch {
      // No remembered platform.
    }
    const guess = guessPlatform(fileName, options) ?? (last && options.includes(last) ? last : options[0]);
    const pick = await this.alertCtrl.create({
      header: 'Which platform is this from?',
      message: `Your holdings from this platform will be replaced by the ones in ${fileName}. Holdings on other platforms are kept.`,
      inputs: [
        ...options.map((p) => ({ type: 'radio' as const, label: p, value: p, checked: p === guess })),
        { type: 'radio' as const, label: 'Other…', value: '__other__' },
      ],
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Import', role: 'confirm' }],
    });
    await pick.present();
    const choice = await pick.onDidDismiss<{ values: string }>();
    if (choice.role !== 'confirm' || !choice.data?.values) return null;
    let platform = choice.data.values;
    if (platform === '__other__') {
      const other = await this.alertCtrl.create({
        header: 'Platform name',
        inputs: [{ name: 'name', type: 'text', placeholder: 'e.g. Dhan' }],
        buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Import', role: 'confirm' }],
      });
      await other.present();
      const res = await other.onDidDismiss<{ values: { name: string } }>();
      platform = res.role === 'confirm' ? (res.data?.values?.name ?? '').trim() : '';
      if (!platform) return null;
    }
    try {
      localStorage.setItem(LAST_PLATFORM_KEY, platform);
    } catch {
      // Remembering is a convenience.
    }
    return platform;
  }

  protected async removePlatform(platform: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: `Remove ${platform} holdings?`,
      message: `This deletes the holdings imported from ${platform}. Your account there is not affected.`,
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Remove', role: 'destructive' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role === 'destructive') {
      await this.store.removePlatform(platform);
      this.platformFilter.set('');
    }
  }

  protected async refresh(): Promise<void> {
    await this.store.refreshPrices();
  }

  /** Remove every stock or every fund (only the selected platform's when filtered), e.g. before a fresh import. */
  protected async removeKind(kind: HoldingKind): Promise<void> {
    const platform = this.platformFilter() || undefined;
    const what = kind === 'mf' ? 'mutual funds' : 'stocks';
    const count = (kind === 'mf' ? this.fundRows() : this.stockRows()).length;
    const alert = await this.alertCtrl.create({
      header: platform ? `Remove ${platform} ${what}?` : `Remove all ${what}?`,
      message:
        `This deletes ${count} ${count === 1 ? what.replace(/s$/, '') : what}` +
        (platform ? ` imported from ${platform}` : ' from every platform') +
        ` in Artha. ${kind === 'mf' ? 'Your stocks' : 'Your mutual funds'} stay. ` +
        'Then tap Import to add a fresh report. Your broker account is not affected.',
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Remove', role: 'destructive' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    try {
      const removed = await this.store.removeKind(kind, platform);
      if (platform && !this.store.platforms().includes(platform)) this.platformFilter.set('');
      await this.notifier.notifyInfo(`Removed ${removed} ${removed === 1 ? what.replace(/s$/, '') : what}. Tap Import to add a fresh report.`);
    } catch {
      await this.notifier.notifyError(`Could not remove the ${what}.`);
    }
  }

  protected async clearAll(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remove all holdings?',
      message: 'This deletes the imported holdings from Artha. Your broker account is not affected.',
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Remove', role: 'destructive' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role === 'destructive') {
      await this.store.clear();
    }
  }

  protected sign(n: number): string {
    return n > 0 ? '+' : n < 0 ? '−' : '';
  }

  protected abs(n: number): number {
    return Math.abs(n);
  }

  protected shortSymbol(symbol: string): string {
    return symbol.replace(/\.(NS|BO)$/, '');
  }

  protected pricesLabel(): string | null {
    const at = this.store.pricesAt();
    if (!at) return null;
    return `updated ${new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }

  protected importedNote(): string {
    const { importedAt, source } = this.store.snapshot();
    if (!importedAt) return '';
    const date = new Date(importedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return `Imported ${date}${source ? ` from ${source}` : ''}.`;
  }
}

function loadCombine(): boolean {
  try {
    return localStorage.getItem(COMBINE_KEY) !== '0';
  } catch {
    return true;
  }
}
