import { Injectable, computed, inject, signal } from '@angular/core';
import { Settings, SettingsUpdateRequest, symbolFor } from '../../core/models/settings.model';
import { SettingsApi } from './settings.api';

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly api = inject(SettingsApi);

  private readonly _settings = signal<Settings | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  readonly settings = this._settings.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly currency = computed(() => this._settings()?.currency ?? 'USD');
  readonly currencySymbol = computed(() => symbolFor(this.currency()));

  async load(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      this._settings.set(await this.api.get());
    } catch (err) {
      this._error.set('Could not load settings.');
    } finally {
      this._loading.set(false);
    }
  }

  async update(request: SettingsUpdateRequest): Promise<Settings> {
    const updated = await this.api.put(request);
    this._settings.set(updated);
    return updated;
  }
}
