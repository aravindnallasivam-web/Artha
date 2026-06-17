import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { GoogleTokenStore } from '../drive/google-token.store';
import { SessionService } from './session.service';

export const authGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const tokens = inject(GoogleTokenStore);
  const router = inject(Router);

  // Serverless: a valid session also requires Google Drive tokens. An existing
  // user whose session predates the serverless build has no tokens yet, so we
  // send them to sign in once more to capture them.
  if (session.isAuthenticated() && (await tokens.hasTokens())) {
    return true;
  }
  return router.createUrlTree(['/login']);
};
