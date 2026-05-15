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
        path: 'categories',
        loadComponent: () =>
          import('./features/categories/categories-list.page').then((m) => m.CategoriesListPage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
