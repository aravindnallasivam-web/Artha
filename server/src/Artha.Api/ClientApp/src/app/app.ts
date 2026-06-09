import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SplashComponent } from './core/splash/splash.component';
import { registerIcons } from './core/icons';

registerIcons();

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SplashComponent],
  template: '<router-outlet /><artha-splash />',
})
export class App {}
