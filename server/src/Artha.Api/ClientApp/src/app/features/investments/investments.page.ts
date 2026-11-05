import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { AlertController, IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { InvestmentsStore } from './investments.store';

@Component({
  selector: 'artha-investments',
  standalone: true,
  imports: [CurrencyPipe, DecimalPipe, IonContent, IonIcon, IonSpinner],
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
            <h2>Track your stocks</h2>
            <p>Import the holdings report from your broker and Artha keeps the prices up to date.</p>
            <ol>
              <li>In Groww, open <b>Stocks → Holdings</b> and download the <b>holdings report</b> as Excel.</li>
              <li>Tap <b>Import</b> above and choose that file (.xlsx or .csv).</li>
              <li>Import a fresh report whenever you buy or sell.</li>
            </ol>
          </section>
        } @else {
          @let t = store.totals();
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
                <div class="sum-k">Today</div>
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
            {{ t.count }} {{ t.count === 1 ? 'stock' : 'stocks' }}
            @if (pricesLabel(); as p) { · Prices {{ p }} }
            @if (t.liveCount < t.count) { · {{ t.count - t.liveCount }} using statement price }
          </p>

          <div class="list">
            @for (r of store.rows(); track r.holding.id) {
              <article class="row">
                <div class="row-main">
                  <div class="row-name">{{ r.holding.name }}</div>
                  <div class="row-sub num">
                    {{ r.holding.quantity | number: '1.0-4' }} × {{ r.holding.avgPrice | currency: currency() : 'symbol' : '1.0-2' }}
                    @if (r.holding.symbol) { · {{ shortSymbol(r.holding.symbol) }} }
                  </div>
                </div>
                <div class="row-side">
                  <div class="row-value num">{{ r.value | currency: currency() : 'symbol' : '1.0-0' }}</div>
                  <div class="row-pnl num" [class.up]="r.pnl >= 0" [class.down]="r.pnl < 0">
                    {{ sign(r.pnl) }}{{ abs(r.pnl) | currency: currency() : 'symbol' : '1.0-0' }}
                    @if (r.pnlPct != null) { ({{ sign(r.pnl) }}{{ abs(r.pnlPct) | number: '1.1-1' }}%) }
                  </div>
                  <div class="row-price num">
                    @if (r.price != null) { {{ r.price | currency: currency() : 'symbol' : '1.0-2' }} }
                    @if (r.source === 'statement') { <span class="tag">statement</span> }
                    @if (r.source === 'none') { <span class="tag">no price</span> }
                  </div>
                </div>
              </article>
            }
          </div>

          <p class="foot">
            {{ importedNote() }}
            Live prices from Yahoo Finance, delayed about 15 minutes; "statement" means the closing price in your report.
            <button type="button" class="link" (click)="clearAll()">Remove all holdings</button>
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
    .list { display: flex; flex-direction: column; gap: 10px; }
    .row {
      display: flex; justify-content: space-between; gap: 12px;
      padding: 14px; border-radius: 20px; background: var(--artha-surface);
    }
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
    .foot { margin: 4px 4px 0; font-size: 12px; line-height: 1.5; color: var(--artha-text-subtle); }
    .link { border: 0; background: none; padding: 0; margin-left: 4px; font: inherit; font-weight: 700; color: var(--artha-negative); cursor: pointer; }
  `],
})
export class InvestmentsPage implements OnInit {
  protected readonly store = inject(InvestmentsStore);
  private readonly notifier = inject(ConflictNotifierService);
  private readonly alertCtrl = inject(AlertController);

  protected readonly importing = signal(false);
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
    if (this.store.rows().length > 0) {
      const alert = await this.alertCtrl.create({
        header: 'Replace holdings?',
        message: `Your current ${this.store.rows().length} holdings will be replaced by the ones in ${file.name}.`,
        buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Replace', role: 'confirm' }],
      });
      await alert.present();
      if ((await alert.onDidDismiss()).role !== 'confirm') return;
    }
    this.importing.set(true);
    try {
      const { imported, skipped } = await this.store.importFile(file);
      await this.notifier.notifyInfo(
        `Imported ${imported} ${imported === 1 ? 'holding' : 'holdings'}` +
          (skipped ? `; ${skipped} ${skipped === 1 ? 'row' : 'rows'} couldn't be read.` : '.'),
      );
    } catch (err) {
      await this.notifier.notifyError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      this.importing.set(false);
    }
  }

  protected async refresh(): Promise<void> {
    await this.store.refreshPrices();
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
