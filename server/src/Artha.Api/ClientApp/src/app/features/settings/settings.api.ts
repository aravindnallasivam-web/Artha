// Thin pass-through to the Drive-backed service. Kept as `SettingsApi` so the
// store's injection point is unchanged after the serverless cutover.
import { Injectable, inject } from '@angular/core';
import { Settings, SettingsUpdateRequest } from '../../core/models/settings.model';
import { SettingsDriveService } from './settings.drive';

@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly drive = inject(SettingsDriveService);

  get(): Promise<Settings> {
    return this.drive.get();
  }

  put(request: SettingsUpdateRequest): Promise<Settings> {
    return this.drive.put(request);
  }
}
