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
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideIonicAngular({ mode: 'md' }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // Native (Capacitor) only: register the appUrlOpen handler at startup so
    // the OAuth deep link is caught even if the OS launches the app cold.
    // No-op on the web build.
    provideAppInitializer(() => {
      inject(GoogleAuthService).initializeMobileAuthListener();
    }),
  ],
};
