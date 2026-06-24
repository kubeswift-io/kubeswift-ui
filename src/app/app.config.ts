import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { AuthService } from './auth.service';

// NOTE: no animations provider — the P0 slice (toolbar / table / chips /
// progress-bar) renders without the @angular/animations engine. Add
// provideAnimationsAsync() + @angular/animations when an animated component
// (menus, dialogs, expansion) lands.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // OIDC: discover the IdP + complete any pending login redirect before the
    // app renders. No-op when OIDC is not configured (insecure/dev mode).
    provideAppInitializer(() => inject(AuthService).init()),
  ],
};
