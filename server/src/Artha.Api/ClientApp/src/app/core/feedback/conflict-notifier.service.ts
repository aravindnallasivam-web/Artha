import { Injectable, inject } from '@angular/core';
import { ToastController } from '@ionic/angular/standalone';

@Injectable({ providedIn: 'root' })
export class ConflictNotifierService {
  private readonly toastCtrl = inject(ToastController);

  async notifyConflict(message?: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: message ?? 'Saved by another device — refreshed.',
      duration: 3500,
      color: 'warning',
      position: 'bottom',
      buttons: [{ text: 'OK', role: 'cancel' }],
    });
    await toast.present();
  }

  async notifyError(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3500,
      color: 'danger',
      position: 'bottom',
      buttons: [{ text: 'OK', role: 'cancel' }],
    });
    await toast.present();
  }

  async notifyInfo(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2500,
      color: 'medium',
      position: 'bottom',
    });
    await toast.present();
  }
}
