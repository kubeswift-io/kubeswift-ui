import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

// NOTE: no animations provider — the P0 slice (toolbar / table / chips /
// progress-bar) renders without the @angular/animations engine. Add
// provideAnimationsAsync() + @angular/animations when an animated component
// (menus, dialogs, expansion) lands.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
  ]
};
