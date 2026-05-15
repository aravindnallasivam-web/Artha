import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Settings, SettingsUpdateRequest } from '../../core/models/settings.model';

@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/settings`;

  get(): Promise<Settings> {
    return firstValueFrom(this.http.get<Settings>(this.baseUrl));
  }

  put(request: SettingsUpdateRequest): Promise<Settings> {
    return firstValueFrom(this.http.put<Settings>(this.baseUrl, request));
  }
}
