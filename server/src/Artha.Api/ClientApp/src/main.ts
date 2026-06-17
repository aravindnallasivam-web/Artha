import { registerLocaleData } from '@angular/common';
import localeEnIn from '@angular/common/locales/en-IN';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Indian number grouping (lakh/crore: ₹1,33,383) for all currency/number pipes.
registerLocaleData(localeEnIn);

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
