import { Component, Input, computed, inject, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonSearchbar,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { CategoryOption } from './categories.store';

/**
 * Searchable category chooser. Opened by CategoryPickerComponent; lists every
 * category (subcategories indented) with a search box to filter by name, plus
 * optional "None" and "New category…" actions. Dismisses with the chosen id
 * (role 'select'), 'create', or 'cancel'.
 */
@Component({
  selector: 'artha-category-search',
  standalone: true,
  imports: [
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonSearchbar,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ title }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          placeholder="Search categories"
          [debounce]="0"
          (ionInput)="onSearch($event)"
        ></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        @if (includeNone) {
          <ion-item button detail="false" (click)="choose(null)">
            <ion-label>{{ noneLabel }}</ion-label>
            @if (selectedId === null) {
              <ion-icon name="checkmark-circle" slot="end" color="primary"></ion-icon>
            }
          </ion-item>
        }
        @for (o of filtered(); track o.id) {
          <ion-item button detail="false" (click)="choose(o.id)">
            <ion-label [class.child]="o.isChild">{{ o.name }}</ion-label>
            @if (o.id === selectedId) {
              <ion-icon name="checkmark-circle" slot="end" color="primary"></ion-icon>
            }
          </ion-item>
        }
        @if (filtered().length === 0) {
          <div class="empty">No categories match "{{ query() }}".</div>
        }
        @if (allowCreate) {
          <ion-item button detail="false" class="create" (click)="create()">
            <ion-icon name="add" slot="start"></ion-icon>
            <ion-label>New category…</ion-label>
          </ion-item>
        }
      </ion-list>
    </ion-content>
  `,
  styles: [`
    ion-label.child { padding-inline-start: 20px; font-weight: 400; }
    .empty { padding: 24px 16px; text-align: center; color: var(--artha-text-subtle, #888); }
    .create { --color: var(--artha-accent, #2f6df6); font-weight: 600; }
  `],
})
export class CategorySearchModal {
  /** Hierarchical options (top-level then indented subcategories). */
  @Input() options: CategoryOption[] = [];
  @Input() includeNone = false;
  @Input() noneLabel = 'None';
  @Input() allowCreate = true;
  @Input() selectedId: string | null = null;
  @Input() title = 'Category';

  private readonly modalCtrl = inject(ModalController);

  protected readonly query = signal('');
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) {
      return this.options;
    }
    return this.options.filter((o) => o.name.toLowerCase().includes(q));
  });

  protected onSearch(event: Event): void {
    this.query.set((event as CustomEvent<{ value: string }>).detail?.value ?? '');
  }

  protected choose(id: string | null): void {
    void this.modalCtrl.dismiss(id, 'select');
  }

  protected create(): void {
    void this.modalCtrl.dismiss(null, 'create');
  }

  protected close(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }
}
