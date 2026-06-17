import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  LOCALE_ID,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';

import { authInterceptor } from './core/auth/auth.interceptor';
import { GoogleAuthService } from './core/auth/google-auth.service';
import { SessionService } from './core/auth/session.service';
import { AppLockService } from './core/security/app-lock.service';
import { NativeUiService } from './core/native/native-ui.service';
import { ThemeService } from './core/theme/theme.service';
import { SmsCaptureService } from './features/sms/sms-capture.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Indian English locale → lakh/crore number grouping and dd/MM dates.
    { provide: LOCALE_ID, useValue: 'en-IN' },
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideIonicAngular({ mode: 'md' }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // Native (Capacitor) only: restore the session from Capacitor Preferences
    // if localStorage was evicted, register the appUrlOpen handler so the OAuth
    // deep link is caught even on cold launch, and theme the native status bar
    // + dismiss the splash once the app has painted. All no-op on web.
    provideAppInitializer(async () => {
      // Resolve all dependencies synchronously, before the first `await`.
      // After an `await` the injection context is gone, so calling inject()
      // there throws NG0203 ("inject() must be called from an injection
      // context").
      const session = inject(SessionService);
      const googleAuth = inject(GoogleAuthService);
      const nativeUi = inject(NativeUiService);
      const smsCapture = inject(SmsCaptureService);
      const appLock = inject(AppLockService);
      // Construct the theme service early so the chosen Light/Dark/System
      // palette is applied to <html> as the app boots.
      inject(ThemeService);
      await session.restoreFromNativeIfNeeded();
      googleAuth.initializeMobileAuthListener();
      // Desktop (Electron): catch the OAuth redirect bridged from the main
      // process. No-op on web/native.
      googleAuth.initializeElectronAuthListener();
      await nativeUi.initialize();
      // Resume the SMS watcher if the user enabled capture previously.
      // No-op on web/iOS and when disabled.
      void smsCapture.init();
      // Cover the app with the biometric lock if the user enabled it.
      // No-op on web/desktop. Not awaited so boot isn't blocked by the prompt.
      void appLock.initialize();
    }),
  ],
};
