import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The "Expenses | Reports" pill at the top of both screens: Reports lives
 * inside the Expenses tab, and this flips between them (replacing the page,
 * so Back leaves the tab instead of bouncing between the two).
 */
@Component({
  selector: 'artha-section-switch',
  standalone: true,
  imports: [RouterLink],
  template: `
    <nav class="switch" aria-label="Expenses or reports">
      <a
        routerLink="/expenses"
        [replaceUrl]="true"
        [class.on]="active() === 'expenses'"
        [attr.aria-current]="active() === 'expenses' ? 'page' : null"
      >Expenses</a>
      <a
        routerLink="/reports"
        [replaceUrl]="true"
        [class.on]="active() === 'reports'"
        [attr.aria-current]="active() === 'reports' ? 'page' : null"
      >Reports</a>
    </nav>
  `,
  styles: [`
    :host { display: inline-flex; }
    .switch { display: inline-flex; padding: 4px; border-radius: 999px; background: var(--artha-surface-2); }
    a {
      display: inline-flex; align-items: center; height: 36px; padding: 0 18px; border-radius: 999px;
      color: var(--artha-text-muted); font-size: 14px; font-weight: 600; text-decoration: none; white-space: nowrap;
    }
    a:hover { color: var(--artha-text); }
    a.on {
      background: var(--artha-surface); color: var(--artha-text); font-weight: 700;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12); pointer-events: none;
    }
  `],
})
export class SectionSwitchComponent {
  readonly active = input.required<'expenses' | 'reports'>();
}
