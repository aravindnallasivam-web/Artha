import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ConflictNotifierService } from '../feedback/conflict-notifier.service';
import { SessionService } from './session.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const conflictNotifier = inject(ConflictNotifierService);

  const apiPrefix = `${environment.apiBaseUrl}/api`;
  const targetsApi = req.url.startsWith(apiPrefix);
  const token = session.token();

  const handled = targetsApi && token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(handled).pipe(
    tap({
      error: (err: unknown) => {
        if (!targetsApi || typeof err !== 'object' || err === null || !('status' in err)) {
          return;
        }
        const status = (err as { status?: number }).status;
        if (status === 401) {
          session.clear();
          void router.navigate(['/login']);
        } else if (status === 409) {
          void conflictNotifier.notifyConflict();
        }
      },
    }),
  );
};
