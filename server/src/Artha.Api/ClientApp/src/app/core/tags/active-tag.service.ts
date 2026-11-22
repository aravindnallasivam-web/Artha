import { Injectable, signal } from '@angular/core';

const KEY = 'artha.tags.active';

export interface ActiveTag {
  tag: string;
  /** When it was turned on (ISO). */
  since: string;
}

/**
 * "Trip mode": a tag added to every new expense - from SMS, Scan & Pay or
 * added by hand - until it's turned off. Kept on this device.
 */
@Injectable({ providedIn: 'root' })
export class ActiveTagService {
  private readonly _active = signal<ActiveTag | null>(load());
  readonly active = this._active.asReadonly();

  start(tag: string): void {
    const v: ActiveTag = { tag, since: new Date().toISOString() };
    this._active.set(v);
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      // This session only.
    }
  }

  stop(): void {
    this._active.set(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing stored.
    }
  }
}

function load(): ActiveTag | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.tag === 'string' && v.tag ? v : null;
  } catch {
    return null;
  }
}
