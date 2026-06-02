import { Component, OnInit, inject } from '@angular/core';
import {
  AlertController,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonList,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { Category } from '../../core/models/category.model';
import { CategoryEditModal } from './category-edit.modal';
import { CategoriesStore } from './categories.store';

@Component({
  selector: 'artha-categories-list',
  standalone: true,
  imports: [
    IonContent,
    IonFab,
    IonFabButton,
    IonHeader,
    IonIcon,
    IonItem,
    IonItemOption,
    IonItemOptions,
    IonItemSliding,
    IonLabel,
    IonList,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToggle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Categories</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-item>
        <ion-toggle (ionChange)="onToggleArchived($event)">Show archived</ion-toggle>
      </ion-item>

      @if (store.loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else if (store.items().length === 0) {
        <div class="empty">No categories yet.</div>
      } @else {
        <ion-list>
          @for (cat of store.items(); track cat.id) {
            <ion-item-sliding>
              <ion-item>
                <span
                  class="color-dot"
                  [style.background]="cat.color || '#94a3b8'"
                  slot="start"
                >
                  @if (cat.icon) {
                    <ion-icon [name]="cat.icon"></ion-icon>
                  }
                </span>
                <ion-label>
                  {{ cat.name }}
                  @if (cat.archived) {
                    <ion-note color="medium"> · archived</ion-note>
                  }
                </ion-label>
              </ion-item>
              @if (!cat.archived) {
                <ion-item-options side="end">
                  <ion-item-option (click)="edit(cat)">
                    <ion-icon name="pencil" slot="icon-only"></ion-icon>
                  </ion-item-option>
                  <ion-item-option color="danger" (click)="archive(cat)">
                    <ion-icon name="trash" slot="icon-only"></ion-icon>
                  </ion-item-option>
                </ion-item-options>
              }
            </ion-item-sliding>
          }
        </ion-list>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button (click)="addCategory()">
          <ion-icon name="add"></ion-icon>
        </ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: [`
    .color-dot {
      width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      color: #fff;
    }
    .color-dot ion-icon { font-size: 16px; }
    .state, .empty {
      display: flex; align-items: center; justify-content: center;
      padding: 32px; color: var(--ion-color-medium);
    }
  `],
})
export class CategoriesListPage implements OnInit {
  protected readonly store = inject(CategoriesStore);
  private readonly alertCtrl = inject(AlertController);
  private readonly modalCtrl = inject(ModalController);
  private readonly notifier = inject(ConflictNotifierService);

  ngOnInit(): void {
    void this.store.load();
  }

  async onToggleArchived(event: Event): Promise<void> {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail?.checked ?? false;
    await this.store.load(checked);
  }

  async addCategory(): Promise<void> {
    await this.openEditor();
  }

  async edit(cat: Category): Promise<void> {
    await this.openEditor(cat);
  }

  /** Open the category editor modal. The modal saves itself (showing a loader)
      and dismisses with role 'saved' on success. */
  private async openEditor(category?: Category): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CategoryEditModal,
      componentProps: { category },
    });
    await modal.present();
    await modal.onWillDismiss();
  }

  async archive(cat: Category): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: `Archive "${cat.name}"?`,
      message:
        'Existing expenses keep this category. New expenses can no longer use it.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Archive',
          role: 'destructive',
          handler: async () => {
            try {
              await this.store.remove(cat.id);
            } catch (err) {
              await this.notifier.notifyError(
                'Could not archive — it may still be in use by expenses.',
              );
            }
          },
        },
      ],
    });
    await alert.present();
  }
}
