import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { registerIcons } from './core/icons';
import { AppLockOverlay } from './core/security/app-lock.overlay';

registerIcons();

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AppLockOverlay],
  template: '<router-outlet /><artha-app-lock />',
})
export class App {}
