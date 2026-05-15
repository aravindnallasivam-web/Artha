export interface Category {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  archived: boolean;
}

export interface CategoryUpsertRequest {
  name: string;
  color: string | null;
  icon: string | null;
}
