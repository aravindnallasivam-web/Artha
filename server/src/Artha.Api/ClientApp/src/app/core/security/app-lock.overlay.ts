import { Component, inject } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { AppLockService } from './app-lock.service';

/**
 * Full-screen cover shown while the app is locked. Sits above the router outlet
 * so the app's content isn't visible until the user authenticates.
 */
@Component({
  selector: 'artha-app-lock',
  standalone: true,
  imports: [IonIcon],
  template: `
    @if (lock.locked()) {
      <div class="lock-screen">
        <ion-icon name="lock-closed" class="lock-icon" aria-hidden="true"></ion-icon>
        <h1>Artha is locked</h1>
        <p>Unlock with your fingerprint, face, or device PIN.</p>
        <button type="button" class="unlock-btn" (click)="unlock()">
          <ion-icon name="finger-print" aria-hidden="true"></ion-icon>
          Unlock
        </button>
      </div>
    }
  `,
  styles: [`
    .lock-screen {
      position: fixed; inset: 0; z-index: 100000;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; padding: 24px; text-align: center;
      background: var(--artha-bg, #0f172a);
      color: var(--artha-text, #fff);
    }
    .lock-icon { font-size: 56px; color: var(--artha-accent, #2f6df6); margin-bottom: 6px; }
    .lock-screen h1 { margin: 0; font-size: 20px; font-weight: 700; }
    .lock-screen p { margin: 0; font-size: 14px; color: var(--artha-text-muted, #94a3b8); max-width: 280px; }
    .unlock-btn {
      margin-top: 18px;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 22px; border: 0; border-radius: 999px; cursor: pointer;
      background: var(--artha-accent, #2f6df6); color: #fff;
      font-size: 15px; font-weight: 600;
    }
    .unlock-btn ion-icon { font-size: 18px; }
  `],
})
export class AppLockOverlay {
  protected readonly lock = inject(AppLockService);

  protected unlock(): void {
    void this.lock.tryUnlock();
  }
}
