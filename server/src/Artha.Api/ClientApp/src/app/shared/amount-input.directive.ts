import { Directive, ElementRef, HostListener, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Formats a text input as a money amount with Indian (lakh/crore) grouping as
 * the user types — e.g. "1,33,383.50" — while the bound form value stays a
 * plain number. Use on `<input type="text" inputmode="decimal" arthaAmount>`.
 *
 * It's the input's value accessor, so it works with `formControlName` /
 * `ngModel`. Caret sits at the end after formatting (fine for amount entry).
 */
@Directive({
  selector: 'input[arthaAmount]',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AmountInputDirective),
      multi: true,
    },
  ],
})
export class AmountInputDirective implements ControlValueAccessor {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  @HostListener('input')
  onInput(): void {
    const { display, value } = parseAmount(this.el.nativeElement.value);
    this.el.nativeElement.value = display;
    this.onChange(value);
  }

  @HostListener('blur')
  onBlur(): void {
    this.onTouched();
  }

  writeValue(value: number | null): void {
    this.el.nativeElement.value =
      value == null || isNaN(value) || value === 0
        ? ''
        : value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.el.nativeElement.disabled = isDisabled;
  }
}

/** Group the integer part Indian-style; keep up to two decimals while typing. */
function parseAmount(raw: string): { display: string; value: number | null } {
  let s = (raw ?? '').replace(/[^\d.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    // Keep only the first dot.
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }
  if (s === '') {
    return { display: '', value: null };
  }
  let [intPart, decPart] = s.split('.');
  if (decPart !== undefined) {
    decPart = decPart.slice(0, 2);
  }
  const intNum = intPart === '' ? 0 : parseInt(intPart, 10);
  const grouped = intNum.toLocaleString('en-IN');
  const display = decPart !== undefined ? `${grouped}.${decPart}` : grouped;
  const value = parseFloat(`${intNum}.${decPart ? decPart : '0'}`);
  return { display, value: isNaN(value) ? null : value };
}
