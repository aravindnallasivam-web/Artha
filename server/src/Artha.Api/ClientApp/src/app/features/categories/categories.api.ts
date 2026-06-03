import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Category, CategoryUpsertRequest } from '../../core/models/category.model';

@Injectable({ providedIn: 'root' })
export class CategoriesApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/categories`;

  list(includeArchived = false): Promise<Category[]> {
    const params: Record<string, string> = {};
    if (includeArchived) params['includeArchived'] = 'true';
    return firstValueFrom(this.http.get<Category[]>(this.baseUrl, { params }));
  }

  create(request: CategoryUpsertRequest): Promise<Category> {
    return firstValueFrom(this.http.post<Category>(this.baseUrl, request));
  }

  update(id: string, request: CategoryUpsertRequest): Promise<Category> {
    return firstValueFrom(this.http.put<Category>(`${this.baseUrl}/${id}`, request));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.baseUrl}/${id}`));
  }

  /** Reassign every expense from the source categories to the target, then
      archive the sources. Returns the remaining active categories. */
  merge(targetId: string, sourceIds: string[]): Promise<Category[]> {
    return firstValueFrom(
      this.http.post<Category[]>(`${this.baseUrl}/merge`, { targetId, sourceIds }),
    );
  }
}
