import { Component, effect, inject, signal } from '@angular/core';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { DriveCache, SyncState } from '../drive/drive-cache.service';

type Display = 'hidden' | 'saving' | 'offline' | 'synced';

/**
 * Small, unobtrusive pill that surfaces the background Drive sync state:
 * "Saving…" while a flush is in flight, "Offline — saved" when there are queued
 * edits and no connection, and a brief "Synced ✓" flash once everything is up
 * to date. Hidden when idle and synced.
 */
@Component({
  selector: 'artha-sync-indicator',
  standalone: true,
  imports: [IonIcon, IonSpinner],
  template: `
    @if (display() !== 'hidden') {
      <div
        class="sync"
        [class.sync--ok]="display() === 'synced'"
        [class.sync--warn]="display() === 'offline'"
        role="status"
        aria-live="polite"
      >
        @switch (display()) {
          @case ('saving') {
            <ion-spinner name="dots"></ion-spinner><span>Saving…</span>
          }
          @case ('offline') {
            <ion-icon name="cloud-offline-outline"></ion-icon><span>Offline — saved on device</span>
          }
          @case ('synced') {
            <ion-icon name="checkmark-circle"></ion-icon><span>Synced</span>
          }
        }
      </div>
    }
  `,
  styles: [`
    .sync {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(76px + env(safe-area-inset-bottom));
      z-index: 1000;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      border-radius: 999px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      box-shadow: var(--artha-shadow-lg);
      font-size: 12.5px;
      font-weight: 600;
      color: var(--artha-text-muted);
      animation: sync-fade 160ms ease;
    }
    .sync--ok { color: var(--artha-positive); border-color: var(--artha-positive); }
    .sync--warn { color: var(--artha-warning); border-color: var(--artha-warning); }
    .sync ion-spinner { width: 15px; height: 15px; }
    .sync ion-icon { font-size: 16px; }
    @keyframes sync-fade { from { opacity: 0; } to { opacity: 1; } }
    @media (min-width: 768px) {
      .sync { left: auto; right: 20px; bottom: 20px; transform: none; }
    }
  `],
})
export class SyncIndicatorComponent {
  private readonly cache = inject(DriveCache);

  protected readonly display = signal<Display>('hidden');
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private prev: SyncState = 'synced';

  constructor() {
    effect(() => {
      const state = this.cache.syncState();
      if (state === 'synced') {
        // Only flash "Synced" if we were actually doing something.
        if (this.prev !== 'synced') {
          this.show('synced');
          this.scheduleHide(1800);
        }
      } else {
        if (this.hideTimer) {
          clearTimeout(this.hideTimer);
          this.hideTimer = null;
        }
        this.show(state === 'offline' ? 'offline' : 'saving');
      }
      this.prev = state;
    });
  }

  private show(kind: Display): void {
    this.display.set(kind);
  }

  private scheduleHide(ms: number): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }
    this.hideTimer = setTimeout(() => this.display.set('hidden'), ms);
  }
}
