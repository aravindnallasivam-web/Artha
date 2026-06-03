import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { CATEGORY_COLORS, CATEGORY_ICONS, Category } from '../../core/models/category.model';
import { CategoriesStore } from './categories.store';

@Component({
  selector: 'artha-category-edit',
  standalone: true,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonIcon,
    IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ category ? 'Edit category' : 'New category' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()" [disabled]="saving()" aria-label="Close">
            <ion-icon name="close-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <!-- Live preview -->
      <div class="preview">
        <span class="preview-dot" [style.background]="color() || '#94a3b8'">
          @if (icon()) {
            <ion-icon [name]="icon()!"></ion-icon>
          }
        </span>
        <span class="preview-name">{{ name().trim() || 'Category name' }}</span>
      </div>

      <label class="field-label" for="cat-name">Name</label>
      <input
        id="cat-name"
        class="text-field"
        type="text"
        placeholder="e.g. Groceries"
        [ngModel]="name()"
        (ngModelChange)="name.set($event)"
        maxlength="40"
        [disabled]="saving()"
      />

      <div class="field-label-row">
        <span class="field-label">Colour</span>
        <label class="custom-color">
          Custom
          <input
            type="color"
            [ngModel]="color() || '#3b82f6'"
            (ngModelChange)="color.set($event)"
            [disabled]="saving()"
          />
        </label>
      </div>
      <div class="swatches">
        @for (c of colors; track c) {
          <button
            type="button"
            class="swatch"
            [class.selected]="color()?.toLowerCase() === c.toLowerCase()"
            [style.background]="c"
            (click)="color.set(c)"
            [disabled]="saving()"
            [attr.aria-label]="'Colour ' + c"
          ></button>
        }
      </div>

      <span class="field-label">Icon</span>
      <div class="icon-grid">
        <button
          type="button"
          class="icon-cell"
          [class.selected]="icon() === null"
          (click)="icon.set(null)"
          [disabled]="saving()"
          aria-label="No icon"
        >
          <ion-icon name="close-outline"></ion-icon>
        </button>
        @for (ic of icons; track ic) {
          <button
            type="button"
            class="icon-cell"
            [class.selected]="icon() === ic"
            (click)="icon.set(ic)"
            [disabled]="saving()"
            [attr.aria-label]="ic"
          >
            <ion-icon [name]="ic"></ion-icon>
          </button>
        }
      </div>

      <button
        type="button"
        class="save-btn"
        [disabled]="saving() || name().trim().length === 0"
        (click)="save()"
      >
        @if (saving()) {
          <ion-spinner name="crescent"></ion-spinner>
          <span>Saving…</span>
        } @else {
          <span>{{ category ? 'Save changes' : 'Add category' }}</span>
        }
      </button>
    </ion-content>
  `,
  styles: [`
    .preview {
      display: flex; align-items: center; gap: 12px;
      padding: 14px; margin-bottom: 18px;
      border-radius: var(--artha-radius, 12px);
      background: var(--artha-surface-2, #f3f4f6);
    }
    .preview-dot {
      width: 40px; height: 40px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      color: #fff; flex-shrink: 0;
    }
    .preview-dot ion-icon { font-size: 20px; }
    .preview-name { font-size: 16px; font-weight: 600; color: var(--artha-text, #111); }

    .field-label {
      display: block;
      font-size: 13px; font-weight: 600;
      color: var(--artha-text-muted, #555);
      margin: 16px 0 8px;
    }
    .field-label-row {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 16px;
    }
    .field-label-row .field-label { margin: 0 0 8px; }
    .custom-color {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600; color: var(--artha-accent, #2f6df6);
      cursor: pointer;
    }
    .custom-color input[type="color"] {
      width: 28px; height: 28px; padding: 0; border: 0; background: none; cursor: pointer;
    }

    .text-field {
      width: 100%; box-sizing: border-box;
      padding: 11px 12px;
      border: 1px solid var(--artha-border, #d1d5db);
      border-radius: var(--artha-radius-sm, 8px);
      font-size: 15px; color: var(--artha-text, #111);
      background: var(--artha-surface, #fff);
    }
    .text-field:focus { outline: 2px solid var(--artha-accent, #2f6df6); outline-offset: -1px; }

    .swatches {
      display: grid; grid-template-columns: repeat(10, 1fr); gap: 8px;
    }
    .swatch {
      aspect-ratio: 1; border: 0; border-radius: 50%; cursor: pointer;
      padding: 0; position: relative;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08);
    }
    .swatch.selected {
      box-shadow: 0 0 0 2px var(--artha-surface, #fff), 0 0 0 4px var(--artha-text, #111);
    }

    .icon-grid {
      display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px;
    }
    .icon-cell {
      aspect-ratio: 1; display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--artha-border, #e5e7eb);
      border-radius: var(--artha-radius-sm, 8px);
      background: var(--artha-surface, #fff);
      color: var(--artha-text-muted, #555);
      cursor: pointer;
    }
    .icon-cell ion-icon { font-size: 20px; }
    .icon-cell.selected {
      border-color: var(--artha-accent, #2f6df6);
      background: var(--artha-accent-tint, #eaf1ff);
      color: var(--artha-accent, #2f6df6);
    }

    .save-btn {
      width: 100%; margin-top: 24px;
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 13px; border: 0;
      border-radius: var(--artha-radius-sm, 8px);
      background: var(--artha-accent, #2f6df6); color: #fff;
      font-size: 15px; font-weight: 600; cursor: pointer;
    }
    .save-btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .save-btn ion-spinner { width: 18px; height: 18px; }
  `],
})
export class CategoryEditModal implements OnInit {
  /** Set via modal componentProps. Absent => creating a new category. */
  category?: Category;

  private readonly modalCtrl = inject(ModalController);
  private readonly store = inject(CategoriesStore);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly colors = CATEGORY_COLORS;
  protected readonly icons = CATEGORY_ICONS;

  protected readonly name = signal('');
  protected readonly color = signal<string | null>(CATEGORY_COLORS[10]);
  protected readonly icon = signal<string | null>(null);
  protected readonly saving = signal(false);

  ngOnInit(): void {
    if (this.category) {
      this.name.set(this.category.name);
      this.color.set(this.category.color);
      this.icon.set(this.category.icon);
    }
  }

  protected async save(): Promise<void> {
    const name = this.name().trim();
    if (!name || this.saving()) {
      return;
    }
    this.saving.set(true);
    const payload = { name, color: this.color(), icon: this.icon() };
    try {
      if (this.category) {
        await this.store.update(this.category.id, payload);
      } else {
        await this.store.add(payload);
      }
      await this.modalCtrl.dismiss(true, 'saved');
    } catch {
      this.saving.set(false);
      await this.notifier.notifyError(
        this.category ? 'Could not save category.' : 'Could not add category.',
      );
    }
  }

  protected dismiss(): void {
    if (!this.saving()) {
      void this.modalCtrl.dismiss(null, 'cancel');
    }
  }
}
