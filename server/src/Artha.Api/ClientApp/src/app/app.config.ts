import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
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
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideIonicAngular({ mode: 'md' }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // Native (Capacitor) only: restore the session from Capacitor Preferences
    // if localStorage was evicted, then register the appUrlOpen handler so
    // the OAuth deep link is caught even on cold launch. Both no-op on web.
    provideAppInitializer(async () => {
      await inject(SessionService).restoreFromNativeIfNeeded();
      inject(GoogleAuthService).initializeMobileAuthListener();
    }),
  ],
};
