import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SessionService } from './session.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const router = inject(Router);

  const apiPrefix = `${environment.apiBaseUrl}/api`;
  const targetsApi = req.url.startsWith(apiPrefix);
  const token = session.token();

  const handled = targetsApi && token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(handled).pipe(
    tap({
      error: (err: unknown) => {
        if (
          targetsApi &&
          typeof err === 'object' &&
          err !== null &&
          'status' in err &&
          (err as { status?: number }).status === 401
        ) {
          session.clear();
          void router.navigate(['/login']);
        }
      },
    }),
  );
};
