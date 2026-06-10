import { Component, OnInit, signal } from '@angular/core';

/**
 * Branded launch splash rendered by the web layer so it can show the app name
 * and slogan as crisp text (the native splash is a static image that can't).
 *
 * Its background follows the OS colour scheme (prefers-color-scheme) using the
 * same light/dark values as the native splash (values / values-night), so the
 * native→web handoff is seamless and both never disagree on dark vs light.
 * After a short beat it fades out and removes itself from the layout.
 */
@Component({
  selector: 'artha-splash',
  standalone: true,
  template: `
    @if (present()) {
      <div class="splash" [class.hide]="hiding()" aria-hidden="true">
        <img class="logo" src="artha-logo.svg" alt="" width="120" height="120" />
        <h1 class="name">Artha</h1>
        <p class="slogan">Track expenses. Own your data.</p>
      </div>
    }
  `,
  styles: [`
    .splash {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: #f8fafc;
      opacity: 1;
      transition: opacity 0.35s ease;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    .splash.hide { opacity: 0; }
    .logo {
      width: 120px;
      height: 120px;
      animation: splash-pop 0.5s ease both;
    }
    .name {
      margin: 8px 0 0;
      font-size: 34px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #0f172a;
    }
    .slogan {
      margin: 0;
      font-size: 15px;
      color: #475569;
    }
    @keyframes splash-pop {
      from { transform: scale(0.85); opacity: 0; }
      to   { transform: scale(1); opacity: 1; }
    }
    /* Follow the OS scheme so this matches the native splash (values-night),
       avoiding a light/dark disagreement across the two splash stages. */
    @media (prefers-color-scheme: dark) {
      .splash { background: #0b1220; }
      .name { color: #f1f5f9; }
      .slogan { color: #cbd5e1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .logo { animation: none; }
    }
  `],
})
export class SplashComponent implements OnInit {
  /** Whether the overlay is still in the DOM. */
  protected readonly present = signal(true);
  /** Drives the fade-out before removal. */
  protected readonly hiding = signal(false);

  ngOnInit(): void {
    // Hold briefly so the brand registers, then fade and unmount.
    setTimeout(() => this.hiding.set(true), 1200);
    setTimeout(() => this.present.set(false), 1600);
  }
}
