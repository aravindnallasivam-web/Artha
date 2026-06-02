import { Component, computed, input } from '@angular/core';

/**
 * Zero-dependency SVG area/line chart for a daily spend series. Renders a
 * filled area, the line, and small dots at a few sample points.
 */
@Component({
  selector: 'artha-line-chart',
  standalone: true,
  template: `
    <svg viewBox="0 0 360 170" preserveAspectRatio="none" role="img" [attr.aria-label]="ariaLabel()">
      <!-- gridlines -->
      @for (gy of gridY; track gy) {
        <line x1="6" [attr.y1]="gy" x2="354" [attr.y2]="gy"
          stroke="var(--artha-border, #eef2f7)" stroke-width="1" />
      }
      @if (hasData()) {
        <path [attr.d]="areaPath()" fill="var(--artha-accent, #3b82f6)" fill-opacity="0.12" />
        <polyline [attr.points]="linePoints()" fill="none"
          stroke="var(--artha-accent, #3b82f6)" stroke-width="2.5"
          stroke-linejoin="round" stroke-linecap="round" />
        @for (d of dots(); track d.i) {
          <circle [attr.cx]="d.x" [attr.cy]="d.y" r="3" fill="#fff"
            stroke="var(--artha-accent, #3b82f6)" stroke-width="2" />
        }
      } @else {
        <text x="180" y="90" text-anchor="middle" font-size="12"
          fill="var(--artha-text-subtle, #94a3b8)">No spend</text>
      }
    </svg>
  `,
  styles: [`
    :host { display: block; }
    svg { display: block; width: 100%; height: auto; }
  `],
})
export class LineChartComponent {
  readonly series = input.required<number[]>();
  readonly currency = input<string>('USD');

  protected readonly gridY = [20, 60, 100, 140];
  private readonly top = 12;
  private readonly bottom = 150;
  private readonly left = 8;
  private readonly right = 352;

  protected readonly hasData = computed(() => this.series().some((v) => v > 0));

  private readonly points = computed(() => {
    const data = this.series();
    const n = data.length;
    if (n === 0) return [] as { x: number; y: number }[];
    const max = Math.max(...data, 1);
    const span = n > 1 ? n - 1 : 1;
    return data.map((v, i) => ({
      x: this.left + (this.right - this.left) * (i / span),
      y: this.bottom - (this.bottom - this.top) * (v / max),
    }));
  });

  protected readonly linePoints = computed(() =>
    this.points().map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
  );

  protected readonly areaPath = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return '';
    const head = `M ${this.left} ${this.bottom}`;
    const body = pts.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return `${head} ${body} L ${this.right} ${this.bottom} Z`;
  });

  protected readonly dots = computed(() => {
    const pts = this.points();
    const step = Math.max(1, Math.floor(pts.length / 6));
    return pts.filter((_, i) => i % step === 0).map((p, i) => ({ i, x: p.x, y: p.y }));
  });

  protected readonly ariaLabel = computed(() => {
    const total = this.series().reduce((s, v) => s + v, 0);
    return `Daily spend trend, total ${total.toFixed(0)}`;
  });
}
