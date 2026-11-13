import { Injectable, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SmsReader } from '../native/sms-reader';
import { AppLockService } from '../security/app-lock.service';

const LANG_KEY = 'artha.voice.lang';

export const VOICE_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'हिन्दी · Hindi' },
  { code: 'ta-IN', label: 'தமிழ் · Tamil' },
  { code: 'te-IN', label: 'తెలుగు · Telugu' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ · Kannada' },
  { code: 'ml-IN', label: 'മലയാളം · Malayalam' },
  { code: 'mr-IN', label: 'मराठी · Marathi' },
  { code: 'bn-IN', label: 'বাংলা · Bengali' },
  { code: 'gu-IN', label: 'ગુજરાતી · Gujarati' },
  { code: 'en-US', label: 'English (US)' },
];

/**
 * Voice typing with the phone's own speech recognizer (the same one the
 * keyboard's mic uses): free, accurate for Indian accents and languages, and
 * offline once the language is downloaded on the phone. Android only.
 */
@Injectable({ providedIn: 'root' })
export class VoiceService {
  private readonly appLock = inject(AppLockService);
  private readonly _language = signal<string>(load());
  readonly language = this._language.asReadonly();

  isSupported(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  setLanguage(code: string): void {
    this._language.set(code);
    try {
      localStorage.setItem(LANG_KEY, code);
    } catch {
      // This session only.
    }
  }

  /** What was said, or null when cancelled / nothing heard. Throws 'voice-unavailable'. */
  async listen(prompt = 'Speak now'): Promise<string | null> {
    if (!this.isSupported()) return null;
    const r = await this.appLock.hold(() => SmsReader.listen({ prompt, language: this._language() }));
    return r && !r.cancelled && r.text ? r.text.trim() : null;
  }
}

function load(): string {
  try {
    return localStorage.getItem(LANG_KEY) || 'en-IN';
  } catch {
    return 'en-IN';
  }
}
