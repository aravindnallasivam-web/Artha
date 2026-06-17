import { Component, computed, input, output } from '@angular/core';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
  /** Optional identifier so callers can react to a slice being clicked. */
  id?: string;
}

/**
 * Zero-dependency SVG donut. Segments are drawn as stroked arcs on a single
 * circle via stroke-dasharray; the centre shows a caption (e.g. the total).
 */
@Component({
  selector: 'artha-donut-chart',
  standalone: true,
  template: `
    <svg viewBox="0 0 120 120" role="img" [attr.aria-label]="ariaLabel()">
      <g transform="rotate(-90 60 60)">
        @if (arcs().length === 0) {
          <circle cx="60" cy="60" [attr.r]="radius" fill="none"
            stroke="var(--artha-border, #e2e8f0)" [attr.stroke-width]="thickness" />
        }
        @for (a of arcs(); track a.idx) {
          <circle cx="60" cy="60" [attr.r]="radius" fill="none"
            [attr.stroke]="a.color" [attr.stroke-width]="thickness"
            [attr.stroke-dasharray]="a.dash" [attr.stroke-dashoffset]="a.offset"
            [style.cursor]="interactive() ? 'pointer' : null"
            (click)="segmentSelect.emit(a.seg)" />
        }
      </g>
      <text x="60" y="57" text-anchor="middle" font-size="15" font-weight="700"
        fill="var(--artha-text, #0f172a)">{{ centerTop() }}</text>
      <text x="60" y="73" text-anchor="middle" font-size="9"
        fill="var(--artha-text-subtle, #94a3b8)">{{ centerBottom }}</text>
    </svg>
  `,
  styles: [`
    :host { display: block; }
    svg { display: block; width: 100%; height: auto; }
  `],
})
export class DonutChartComponent {
  readonly segments = input.required<DonutSegment[]>();
  readonly currency = input<string>('USD');
  /** When true, slices show a pointer cursor (callers handle segmentSelect). */
  readonly interactive = input<boolean>(false);
  readonly segmentSelect = output<DonutSegment>();
  readonly centerBottom = 'total';

  protected readonly radius = 44;
  protected readonly thickness = 18;
  private readonly circumference = 2 * Math.PI * 44;

  protected readonly arcs = computed(() => {
    const segs = this.segments().filter((s) => s.value > 0);
    const total = segs.reduce((sum, s) => sum + s.value, 0);
    if (total <= 0) return [];
    let offset = 0;
    return segs.map((s, idx) => {
      const len = (s.value / total) * this.circumference;
      const arc = {
        idx,
        seg: s,
        color: s.color,
        dash: `${len.toFixed(2)} ${(this.circumference - len).toFixed(2)}`,
        offset: (-offset).toFixed(2),
      };
      offset += len;
      return arc;
    });
  });

  protected readonly centerTop = computed(() => {
    const total = this.segments().reduce((sum, s) => sum + s.value, 0);
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: this.currency(),
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(total);
  });

  protected readonly ariaLabel = computed(() =>
    this.segments().map((s) => `${s.label}: ${s.value}`).join(', '),
  );
}
