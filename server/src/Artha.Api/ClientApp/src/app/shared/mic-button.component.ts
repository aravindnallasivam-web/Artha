import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { VoiceService } from '../core/voice/voice.service';

/**
 * A round 🎤 button that fills a field by voice (Android). Emits what was
 * heard; the field decides what to do with it (text, amount…).
 */
@Component({
  selector: 'artha-mic',
  standalone: true,
  imports: [IonIcon],
  template: `
    @if (voice.isSupported()) {
      <button type="button" class="mic" [class.mic--busy]="busy()" (click)="speak($event)"
              [attr.aria-label]="'Speak ' + (label || 'text')" title="Voice typing">
        <ion-icon name="mic" aria-hidden="true"></ion-icon>
      </button>
    }
  `,
  styles: [`
    :host { display: contents; }
    .mic {
      width: 44px; height: 44px; flex-shrink: 0; border-radius: 999px; border: 0; cursor: pointer;
      display: grid; place-items: center; background: var(--artha-accent-tint); color: var(--artha-accent);
    }
    .mic ion-icon { font-size: 21px; }
    .mic--busy { background: var(--artha-accent); color: #fff; }
  `],
})
export class MicButtonComponent {
  protected readonly voice = inject(VoiceService);
  protected readonly busy = signal(false);
  /** What's being asked, shown in the "Speak now" box ("Shop name", "Amount"…). */
  @Input() label = '';
  @Output() readonly heard = new EventEmitter<string>();
  @Output() readonly failed = new EventEmitter<string>();

  protected async speak(event: Event): Promise<void> {
    event.stopPropagation();
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const text = await this.voice.listen(this.label ? `Say the ${this.label.toLowerCase()}` : 'Speak now');
      if (text) this.heard.emit(text);
    } catch (e) {
      this.failed.emit(
        String((e as Error)?.message ?? e).includes('voice-unavailable')
          ? 'Voice typing needs the Google app / speech services on this phone.'
          : "Couldn't start voice typing.",
      );
    } finally {
      this.busy.set(false);
    }
  }
}
