import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth/callback.component').then((m) => m.CallbackComponent),
  },
  {
    // Bridge page used by the Capacitor mobile flow. The Web OAuth client
    // can only redirect to HTTPS, so mobile uses this URL as redirect_uri
    // and the page bounces to com.artha.app:// which the OS routes back
    // to the Artha app via @capacitor/app's appUrlOpen event.
    path: 'auth/callback/mobile',
    loadComponent: () =>
      import('./features/auth/mobile-callback.component').then((m) => m.MobileCallbackComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'expenses',
        loadComponent: () =>
          import('./features/expenses/expenses-list.page').then((m) => m.ExpensesListPage),
      },
      {
        path: 'expenses/new',
        loadComponent: () =>
          import('./features/expenses/expense-edit.page').then((m) => m.ExpenseEditPage),
      },
      {
        path: 'expenses/:id',
        loadComponent: () =>
          import('./features/expenses/expense-edit.page').then((m) => m.ExpenseEditPage),
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./features/reports/reports.page').then((m) => m.ReportsPage),
      },
      {
        path: 'planned-expenses',
        loadComponent: () =>
          import('./features/planned-expenses/planned-expenses-list.page').then(
            (m) => m.PlannedExpensesListPage,
          ),
      },
      {
        path: 'planned-expenses/new',
        loadComponent: () =>
          import('./features/planned-expenses/planned-expense-edit.page').then(
            (m) => m.PlannedExpenseEditPage,
          ),
      },
      {
        path: 'planned-expenses/:id',
        loadComponent: () =>
          import('./features/planned-expenses/planned-expense-edit.page').then(
            (m) => m.PlannedExpenseEditPage,
          ),
      },
      {
        path: 'accounts',
        loadComponent: () =>
          import('./features/accounts/accounts-list.page').then((m) => m.AccountsListPage),
      },
      {
        path: 'accounts/new',
        loadComponent: () =>
          import('./features/accounts/account-edit.page').then((m) => m.AccountEditPage),
      },
      {
        path: 'accounts/:id',
        loadComponent: () =>
          import('./features/accounts/account-edit.page').then((m) => m.AccountEditPage),
      },
      {
        path: 'categories',
        loadComponent: () =>
          import('./features/categories/categories-list.page').then((m) => m.CategoriesListPage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        path: 'more',
        loadComponent: () =>
          import('./features/more/more.page').then((m) => m.MorePage),
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
