import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { registerIcons } from './core/icons';

registerIcons();

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
