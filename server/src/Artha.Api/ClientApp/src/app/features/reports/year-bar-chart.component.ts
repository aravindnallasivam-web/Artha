import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { MONTH_LABELS, MonthSummary } from '../../core/models/report.model';

/**
 * Simple SVG bar chart. 12 monthly bars, height proportional to max total
 * in the dataset. Zero-dependency — no chart library.
 */
@Component({
  selector: 'artha-year-bar-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chart-wrap" role="img" [attr.aria-label]="ariaLabel()">
      <svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid meet">
        <!-- Y-axis baseline -->
        <line x1="0" y1="170" x2="360" y2="170"
              stroke="var(--ion-color-step-400, #cbd5e1)" stroke-width="1" />
        <g>
          @for (bar of bars(); track bar.month) {
            <rect
              [attr.x]="bar.x"
              [attr.y]="bar.y"
              [attr.width]="barWidth"
              [attr.height]="bar.height"
              [attr.rx]="2"
              [attr.fill]="bar.fill"
            >
              <title>{{ bar.label }}: {{ formatCurrency(bar.total) }}</title>
            </rect>
            <text
              [attr.x]="bar.x + barWidth / 2"
              [attr.y]="190"
              text-anchor="middle"
              font-size="10"
              fill="var(--ion-color-medium, #64748b)"
            >{{ bar.label }}</text>
          }
        </g>
      </svg>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .chart-wrap { width: 100%; }
    svg { display: block; width: 100%; height: auto; }
  `],
})
export class YearBarChartComponent {
  readonly months = input.required<MonthSummary[]>();
  readonly currency = input<string>('USD');

  protected readonly barWidth = 18;
  private readonly chartHeight = 160;
  private readonly chartTop = 10;
  private readonly leftPadding = 18;
  private readonly slotWidth = 28;

  protected readonly bars = computed(() => {
    const data = this.months();
    if (data.length === 0) return [];
    const max = Math.max(...data.map((m) => m.total), 1);
    return data.map((m) => {
      const height = (m.total / max) * this.chartHeight;
      const x = this.leftPadding + (m.month - 1) * this.slotWidth;
      const y = this.chartTop + (this.chartHeight - height);
      return {
        month: m.month,
        label: MONTH_LABELS[m.month - 1] ?? '',
        total: m.total,
        x,
        y,
        height: Math.max(height, m.total > 0 ? 2 : 0),
        fill: m.total > 0 ? 'var(--ion-color-primary, #3b82f6)' : 'var(--ion-color-step-200, #e2e8f0)',
      };
    });
  });

  protected readonly ariaLabel = computed(() => {
    const total = this.months().reduce((sum, m) => sum + m.total, 0);
    return `Year total ${this.formatCurrency(total)}`;
  });

  protected formatCurrency(value: number): string {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: this.currency(),
      maximumFractionDigits: 0,
    }).format(value);
  }
}
