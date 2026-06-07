// Thin pass-through to the Drive-backed service. Kept as `CategoriesApi` so the
// store's injection point is unchanged after the serverless cutover.
import { Injectable, inject } from '@angular/core';
import { Category, CategoryUpsertRequest } from '../../core/models/category.model';
import { CategoriesDriveService } from './categories.drive';

@Injectable({ providedIn: 'root' })
export class CategoriesApi {
  private readonly drive = inject(CategoriesDriveService);

  list(includeArchived = false): Promise<Category[]> {
    return this.drive.list(includeArchived);
  }

  create(request: CategoryUpsertRequest): Promise<Category> {
    return this.drive.create(request);
  }

  update(id: string, request: CategoryUpsertRequest): Promise<Category> {
    return this.drive.update(id, request);
  }

  remove(id: string): Promise<void> {
    return this.drive.remove(id);
  }

  merge(targetId: string, sourceIds: string[]): Promise<Category[]> {
    return this.drive.merge(targetId, sourceIds);
  }
}
