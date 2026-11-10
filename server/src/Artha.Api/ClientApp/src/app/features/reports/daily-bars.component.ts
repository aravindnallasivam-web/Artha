import { CurrencyPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Month view "Daily spending": one bar per day with a value scale, day labels
 * and a dashed daily-average line. Tapping a bar shows that day's total and
 * count, with a link to the day's report; until then the biggest day is shown.
 */
@Component({
  selector: 'artha-daily-bars',
  standalone: true,
  imports: [CurrencyPipe],
  template: `
    @if (info(); as d) {
      <div class="info">
        <div class="info-text">
          <span class="info-date">{{ d.label }}</span>
          <span class="info-amt num">{{ d.total | currency: currency() : 'symbol' : '1.0-0' }}</span>
          <span class="info-sub">
            @if (d.count > 0) { {{ d.count }} {{ d.count === 1 ? 'transaction' : 'transactions' }} } @else { No spending }
            @if (d.isMax && selected() === null) { · highest day }
          </span>
        </div>
        @if (d.count > 0) {
          <button type="button" class="open" (click)="openDay.emit(d.iso)">Open day ›</button>
        }
      </div>
    }

    <div class="chart" role="img" [attr.aria-label]="ariaLabel()">
      <div class="axis num" aria-hidden="true">
        <span>{{ compact(scaleMax()) }}</span>
        <span>{{ compact(scaleMax() / 2) }}</span>
        <span>{{ compact(0) }}</span>
      </div>
      <div class="plot">
        <div class="grid" aria-hidden="true"><i></i><i></i><i></i></div>
        @if (average() > 0) {
          <div class="avg" [style.bottom.%]="pct(average())" aria-hidden="true">
            <span class="avg-label num">avg {{ compact(average()) }}</span>
          </div>
        }
        <div class="bars">
          @for (b of bars(); track b.day) {
            <button
              type="button"
              class="bar"
              [class.sel]="b.day === activeDay()"
              [class.today]="b.today"
              [class.future]="b.future"
              [attr.aria-label]="b.label + ' ' + (b.total | currency: currency() : 'symbol' : '1.0-0')"
              (click)="select(b.day)"
            >
              <span class="fill" [style.height.%]="b.total > 0 ? Math.max(2, pct(b.total)) : 0"></span>
            </button>
          }
        </div>
      </div>
    </div>
    <div class="days num" aria-hidden="true">
      @for (b of bars(); track b.day) {
        <span [class.sel]="b.day === activeDay()">{{ showDayLabel(b.day) ? b.day : '' }}</span>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .num { font-variant-numeric: tabular-nums; }
    .info {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      margin-bottom: 12px; padding: 10px 12px; border-radius: 14px; background: var(--artha-surface-2);
    }
    .info-text { display: flex; flex-direction: column; min-width: 0; }
    .info-date { font-size: 12px; font-weight: 700; color: var(--artha-text-subtle); }
    .info-amt { font-size: 20px; font-weight: 800; color: var(--artha-text); letter-spacing: -0.02em; }
    .info-sub { font-size: 12px; color: var(--artha-text-muted); }
    .open {
      flex: none; border: 0; border-radius: 999px; padding: 8px 12px; cursor: pointer;
      background: var(--artha-accent); color: #fff; font: inherit; font-size: 12.5px; font-weight: 700;
    }
    .chart { display: flex; gap: 6px; height: 150px; }
    .axis {
      display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end;
      font-size: 10.5px; font-weight: 600; color: var(--artha-text-subtle); min-width: 34px;
      margin: -6px 0;
    }
    .plot { position: relative; flex: 1; min-width: 0; }
    .grid { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; }
    .grid i { display: block; height: 1px; background: var(--artha-border); }
    .avg { position: absolute; left: 0; right: 0; height: 0; border-top: 1.5px dashed var(--artha-warning, #f59e0b); z-index: 1; pointer-events: none; }
    .avg-label {
      position: absolute; right: 0; bottom: 2px; padding: 0 4px; border-radius: 4px;
      font-size: 10px; font-weight: 700; color: var(--artha-warning, #b45309); background: var(--artha-surface);
    }
    .bars { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 2px; }
    .bar {
      flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: transparent; cursor: pointer;
      display: flex; align-items: flex-end;
    }
    .fill {
      display: block; width: 100%; border-radius: 3px 3px 1px 1px;
      background: var(--artha-accent-tint, #c7d2fe); transition: height 0.25s ease;
    }
    .bar:hover .fill { background: var(--artha-accent); opacity: 0.6; }
    .bar.today .fill { background: var(--artha-accent); opacity: 0.55; }
    .bar.sel .fill { background: var(--artha-accent); opacity: 1; }
    .bar.future { cursor: default; }
    .days { display: flex; gap: 2px; margin: 6px 0 0 40px; }
    .days span { flex: 1; min-width: 0; text-align: center; font-size: 10px; color: var(--artha-text-subtle); overflow: visible; white-space: nowrap; }
    .days span.sel { color: var(--artha-text); font-weight: 800; }
  `],
})
export class DailyBarsComponent {
  /** Spend per day of the month (index 0 = day 1). */
  readonly series = input.required<number[]>();
  /** Counted transactions per day, same indexing. */
  readonly counts = input<number[]>([]);
  readonly year = input.required<number>();
  /** 1-12 */
  readonly month = input.required<number>();
  readonly currency = input<string>('INR');
  readonly openDay = output<string>();

  protected readonly Math = Math;
  protected readonly selected = signal<number | null>(null);

  private readonly todayDay = computed(() => {
    const now = new Date();
    return now.getFullYear() === this.year() && now.getMonth() + 1 === this.month() ? now.getDate() : null;
  });

  protected readonly bars = computed(() => {
    const today = this.todayDay();
    const isFutureMonth = new Date(this.year(), this.month() - 1, 1) > new Date();
    return this.series().map((total, i) => {
      const day = i + 1;
      const d = new Date(this.year(), this.month() - 1, day);
      return {
        day,
        total,
        count: this.counts()[i] ?? 0,
        today: day === today,
        future: isFutureMonth || (today !== null && day > today),
        label: `${WEEKDAYS[d.getDay()]} ${day} ${MONTHS[d.getMonth()]}`,
        iso: `${this.year()}-${String(this.month()).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      };
    });
  });

  private readonly maxDay = computed(() => {
    let best: number | null = null;
    for (const b of this.bars()) {
      if (b.total > 0 && (best === null || b.total > this.bars()[best - 1].total)) best = b.day;
    }
    return best;
  });

  /** Selected bar, else the biggest day. */
  protected readonly activeDay = computed(() => this.selected() ?? this.maxDay());

  protected readonly info = computed(() => {
    const day = this.activeDay();
    if (day === null) return null;
    const b = this.bars()[day - 1];
    return b ? { ...b, isMax: day === this.maxDay() } : null;
  });

  /** Days up to today (or the whole month if past) for the average. */
  protected readonly average = computed(() => {
    const today = this.todayDay();
    const days = today ?? this.series().length;
    const total = this.series().slice(0, days).reduce((s, v) => s + v, 0);
    return days > 0 ? total / days : 0;
  });

  /** A round number at or above the biggest day, so the scale reads cleanly. */
  protected readonly scaleMax = computed(() => niceCeil(Math.max(...this.series(), 0)));

  protected pct(value: number): number {
    const max = this.scaleMax();
    return max > 0 ? Math.min(100, (value / max) * 100) : 0;
  }

  protected select(day: number): void {
    const b = this.bars()[day - 1];
    if (!b || b.future) return;
    this.selected.set(this.selected() === day ? null : day);
  }

  protected showDayLabel(day: number): boolean {
    const last = this.series().length;
    return day === 1 || day === last || (day % 5 === 0 && last - day >= 2);
  }

  protected compact(value: number): string {
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: this.currency(),
        notation: 'compact',
        maximumFractionDigits: value >= 1000 ? 1 : 0,
      }).format(value);
    } catch {
      return Math.round(value).toLocaleString();
    }
  }

  protected readonly ariaLabel = computed(() => {
    const total = this.series().reduce((s, v) => s + v, 0);
    return `Daily spending, total ${Math.round(total)}, average ${Math.round(this.average())} a day`;
  });
}

/** The next "round" number (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 x 10^n) at or above `v`; halves stay readable. */
function niceCeil(v: number): number {
  if (v <= 0) return 0;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * exp >= v) return m * exp;
  }
  return 10 * exp;
}
