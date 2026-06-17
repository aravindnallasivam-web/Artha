import { Component, Input, computed, forwardRef, inject, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IonSelect, IonSelectOption } from '@ionic/angular/standalone';
import { CategoriesStore } from './categories.store';

/**
 * Reusable category picker — a single `<ion-select>` that lists every top-level
 * category followed by its subcategories (indented), so the hierarchy shows the
 * same way in every screen (expense edit, SMS confirm/bulk-review, planned
 * expenses, loan payment, …).
 *
 * Implements ControlValueAccessor, so it drops in with `formControlName`,
 * `[(ngModel)]`, or `[ngModel]`/`(ngModelChange)`. `:host { display: contents }`
 * lets the inner ion-select sit inside an `<ion-item>` as if it were a direct
 * child, preserving Ionic's label/layout.
 */
@Component({
  selector: 'artha-category-picker',
  standalone: true,
  imports: [IonSelect, IonSelectOption],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CategoryPickerComponent),
      multi: true,
    },
  ],
  template: `
    <ion-select
      [label]="label"
      [labelPlacement]="labelPlacement"
      [interface]="interface"
      [placeholder]="placeholder"
      [disabled]="disabled"
      [value]="value()"
      (ionChange)="onSelect($event)"
    >
      @if (includeNone) {
        <ion-select-option [value]="null">{{ noneLabel }}</ion-select-option>
      }
      @for (opt of options(); track opt.id) {
        <ion-select-option [value]="opt.id">{{ opt.label }}</ion-select-option>
      }
    </ion-select>
  `,
  styles: [':host { display: contents; }'],
})
export class CategoryPickerComponent implements ControlValueAccessor {
  private readonly store = inject(CategoriesStore);

  @Input() label = 'Category';
  @Input() labelPlacement: 'stacked' | 'fixed' | 'floating' | 'start' | 'end' = 'stacked';
  @Input() interface: 'popover' | 'action-sheet' | 'alert' = 'popover';
  @Input() placeholder = 'Choose a category';
  /** Show a leading "None" option (value null) — e.g. optional planned-expense category. */
  @Input() includeNone = false;
  @Input() noneLabel = 'None';
  @Input() disabled = false;

  protected readonly value = signal<string | null>(null);

  /**
   * Hierarchical options. If the bound value is a category that's no longer in
   * the active list (e.g. an archived one on an existing record), it's appended
   * so the select still shows its name instead of going blank.
   */
  protected readonly options = computed<{ id: string; label: string }[]>(() => {
    const opts = this.store.pickerOptions().map((o) => ({ id: o.id, label: o.label }));
    const current = this.value();
    if (current && !opts.some((o) => o.id === current)) {
      opts.push({ id: current, label: this.store.pathLabel(current) || current });
    }
    return opts;
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

  protected onSelect(event: Event): void {
    const next = (event as CustomEvent<{ value: string | null }>).detail?.value ?? null;
    this.value.set(next);
    this.onChange(next);
    this.onTouched();
  }
}
