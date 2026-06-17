import { Component, Input, computed, forwardRef, inject, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IonIcon, IonInput, ModalController } from '@ionic/angular/standalone';
import { Category } from '../../core/models/category.model';
import { CategoryEditModal } from './category-edit.modal';
import { CategorySearchModal } from './category-search.modal';
import { CategoriesStore } from './categories.store';

/**
 * Reusable, searchable category picker. Shows the current selection as a
 * read-only field; tapping it opens a modal that lists every top-level category
 * with its subcategories (indented), filterable by name, plus optional "None"
 * and inline "New category…" actions.
 *
 * Implements ControlValueAccessor, so it drops in with `formControlName`,
 * `[(ngModel)]`, or `[ngModel]`/`(ngModelChange)`. `:host { display: contents }`
 * lets the inner field sit inside an `<ion-item>` as if a direct child.
 */
@Component({
  selector: 'artha-category-picker',
  standalone: true,
  imports: [IonInput, IonIcon],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CategoryPickerComponent),
      multi: true,
    },
  ],
  template: `
    <ion-input
      [label]="label"
      [labelPlacement]="labelPlacement"
      [value]="selectedLabel()"
      [placeholder]="placeholder"
      [disabled]="disabled"
      [readonly]="true"
      (click)="open()"
    >
      <ion-icon slot="end" name="chevron-down" aria-hidden="true"></ion-icon>
    </ion-input>
  `,
  styles: [':host { display: contents; }'],
})
export class CategoryPickerComponent implements ControlValueAccessor {
  private readonly store = inject(CategoriesStore);
  private readonly modalCtrl = inject(ModalController);

  @Input() label = 'Category';
  @Input() labelPlacement: 'stacked' | 'fixed' | 'floating' | 'start' | 'end' = 'stacked';
  /** Retained for API compatibility; the picker now always opens a search modal. */
  @Input() interface: 'popover' | 'action-sheet' | 'alert' = 'popover';
  @Input() placeholder = 'Choose a category';
  /** Show a leading "None" option (value null) — e.g. optional planned-expense category. */
  @Input() includeNone = false;
  @Input() noneLabel = 'None';
  /** Offer a "New category…" action that opens the category editor inline. */
  @Input() allowCreate = true;
  @Input() disabled = false;

  protected readonly value = signal<string | null>(null);

  /** Display text for the field: the category's "Parent · Child" path, or empty. */
  protected readonly selectedLabel = computed(() => {
    const v = this.value();
    return v ? this.store.pathLabel(v) || v : '';
  });

  protected onChange: (value: string | null) => void = () => {};
  protected onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    this.value.set(value ?? null);
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  /** Open the searchable chooser. */
  protected async open(): Promise<void> {
    if (this.disabled) {
      return;
    }
    this.onTouched();
    const modal = await this.modalCtrl.create({
      component: CategorySearchModal,
      componentProps: {
        options: this.store.pickerOptions(),
        includeNone: this.includeNone,
        noneLabel: this.noneLabel,
        allowCreate: this.allowCreate,
        selectedId: this.value(),
        title: this.label,
      },
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<string | null>();
    if (role === 'select') {
      this.commit(data ?? null);
    } else if (role === 'create') {
      await this.createCategory();
    }
  }

  /** Open the category editor; on save, select the new category. */
  private async createCategory(): Promise<void> {
    const modal = await this.modalCtrl.create({ component: CategoryEditModal });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<Category>();
    if (role === 'saved' && data?.id) {
      this.commit(data.id);
    }
  }

  private commit(value: string | null): void {
    this.value.set(value);
    this.onChange(value);
    this.onTouched();
  }
}
