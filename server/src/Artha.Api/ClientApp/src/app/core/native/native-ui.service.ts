import { Injectable, effect, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { Style, StatusBar } from '@capacitor/status-bar';
import { ThemeService } from '../theme/theme.service';

/**
 * Native shell polish for the Capacitor builds: status-bar theming that
 * tracks the resolved app theme (ThemeService — which itself follows the OS
 * when set to "system"), and a controlled splash-screen handoff.
 *
 * Every method no-ops on the web build (Capacitor.isNativePlatform() === false)
 * so it is safe to wire unconditionally from the app initializer.
 */
@Injectable({ providedIn: 'root' })
export class NativeUiService {
  private readonly theme = inject(ThemeService);
  private initialized = false;

  // Status-bar background colors (Android only) kept in lockstep with the
  // --artha-bg tokens in styles.scss so the bar blends into the app surface.
  private static readonly LIGHT_BG = '#f8fafc'; // slate-50
  private static readonly DARK_BG = '#0b1220'; // matches dark --artha-bg

  constructor() {
    // Re-theme the status bar whenever the resolved theme flips (user toggles
    // Light/Dark/System, or the OS changes while on "system"). No-ops until
    // initialize() has run on a native platform.
    effect(() => {
      const dark = this.theme.isDark();
      if (this.initialized) {
        void this.applyStatusBarTheme(dark);
      }
    });
  }

  /**
   * Theme the status bar to the resolved app theme, then fade the native splash
   * out now that the web layer has painted. Idempotent and web-safe.
   */
  async initialize(): Promise<void> {
    if (this.initialized || !Capacitor.isNativePlatform()) return;
    this.initialized = true;

    await this.applyStatusBarTheme(this.theme.isDark());

    // launchAutoHide is off in capacitor.config.ts, so we own the exact moment
    // the splash disappears — only after the first paint of the SPA.
    try {
      await SplashScreen.hide();
    } catch {
      // Splash already dismissed (e.g. a very fast cold start) — non-fatal.
    }
  }

  /**
   * Style.Dark renders light glyphs (for dark backgrounds); Style.Light renders
   * dark glyphs. Background color is Android-only — iOS derives the bar color
   * from the content behind it via the safe-area insets.
   */
  private async applyStatusBarTheme(isDark: boolean): Promise<void> {
    try {
      await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({
          color: isDark ? NativeUiService.DARK_BG : NativeUiService.LIGHT_BG,
        });
      }
    } catch {
      // StatusBar plugin unavailable on this surface — non-fatal.
    }
  }
}
