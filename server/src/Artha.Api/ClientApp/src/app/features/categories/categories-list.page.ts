import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
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
    IonButton,
    IonButtons,
    IonContent,
    IonFab,
    IonFabButton,
    IonHeader,
    IonIcon,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        @if (selecting()) {
          <ion-buttons slot="start">
            <ion-button (click)="cancelSelect()">Cancel</ion-button>
          </ion-buttons>
          <ion-title>{{ selectedIds().size }} selected</ion-title>
          <ion-buttons slot="end">
            <ion-button
              [strong]="true"
              [disabled]="selectedIds().size < 2"
              (click)="startMerge()"
            >
              Merge
            </ion-button>
          </ion-buttons>
        } @else {
          <ion-title>Categories</ion-title>
          @if (view() === 'active' && store.active().length >= 2) {
            <ion-buttons slot="end">
              <ion-button (click)="enterSelect()">
                <ion-icon name="git-merge-outline" slot="start"></ion-icon>
                Merge
              </ion-button>
            </ion-buttons>
          }
        }
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (store.loading()) {
        <div class="state"><ion-spinner></ion-spinner></div>
      } @else {
        <div class="wrap">
          @if (!selecting()) {
            <ion-segment [value]="view()" (ionChange)="onView($event)">
              <ion-segment-button value="active"><ion-label>Active</ion-label></ion-segment-button>
              <ion-segment-button value="archived"><ion-label>Archived</ion-label></ion-segment-button>
            </ion-segment>
          } @else {
            <div class="merge-hint">
              Pick the categories to combine, then tap Merge and choose which one to keep.
            </div>
          }

          @if (visible().length === 0) {
            @if (view() === 'archived') {
              <div class="empty">
                <ion-icon name="archive-outline"></ion-icon>
                <div>No archived categories.</div>
              </div>
            } @else {
              <div class="empty">
                <ion-icon name="pricetag-outline"></ion-icon>
                <div>No categories yet.</div>
                <div class="cta" (click)="addCategory()">Add your first category</div>
              </div>
            }
          } @else {
            @for (cat of visible(); track cat.id) {
              <div
                class="cat-card"
                [class.selectable]="selecting()"
                [class.selected]="isSelected(cat)"
                (click)="onCardClick(cat)"
              >
                <div
                  class="cat-badge"
                  [style.background]="badgeBg(cat)"
                  [style.color]="badgeColor(cat)"
                >
                  <ion-icon [name]="cat.icon || 'pricetag'"></ion-icon>
                </div>
                <div class="cat-name">{{ cat.name }}</div>

                @if (selecting()) {
                  <ion-icon
                    class="check"
                    [name]="isSelected(cat) ? 'checkmark-circle' : 'ellipse-outline'"
                  ></ion-icon>
                } @else if (!cat.archived) {
                  <div class="cat-actions">
                    <button
                      class="iconbtn"
                      [attr.aria-label]="'Edit ' + cat.name"
                      (click)="edit($event, cat)"
                    >
                      <ion-icon name="pencil"></ion-icon>
                    </button>
                    <button
                      class="iconbtn danger"
                      [attr.aria-label]="'Archive ' + cat.name"
                      (click)="onArchive($event, cat)"
                    >
                      <ion-icon name="trash"></ion-icon>
                    </button>
                  </div>
                }
              </div>
            }
          }
        </div>
      }

      @if (!selecting()) {
        <ion-fab slot="fixed" vertical="bottom" horizontal="end">
          <ion-fab-button (click)="addCategory()">
            <ion-icon name="add"></ion-icon>
          </ion-fab-button>
        </ion-fab>
      }
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-bg); }
    .wrap { padding: 14px 14px 96px; max-width: 640px; margin: 0 auto; }

    ion-segment { margin-bottom: 14px; }
    .merge-hint {
      font-size: 13px; color: var(--artha-text-muted); line-height: 1.45;
      background: var(--artha-accent-tint); border-radius: var(--artha-radius);
      padding: 10px 14px; margin-bottom: 14px;
    }

    .cat-card {
      display: flex; align-items: center; gap: 12px;
      background: var(--artha-surface);
      border: 1px solid var(--artha-border);
      border-radius: var(--artha-radius);
      padding: 12px 14px; margin-bottom: 10px;
      box-shadow: var(--artha-shadow-sm);
      transition: transform 120ms ease, border-color 120ms ease;
    }
    .cat-card.selectable { cursor: pointer; }
    .cat-card.selectable:active { transform: scale(0.992); }
    .cat-card.selected {
      border-color: var(--artha-accent);
      box-shadow: 0 0 0 1px var(--artha-accent) inset;
    }
    .cat-badge {
      width: 40px; height: 40px; border-radius: 12px; flex: none;
      display: flex; align-items: center; justify-content: center; font-size: 20px;
    }
    .cat-name {
      flex: 1; min-width: 0;
      font-weight: 600; font-size: 15px; color: var(--artha-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .check { font-size: 24px; color: var(--artha-accent); flex: none; }
    .check[name="ellipse-outline"] { color: var(--artha-text-subtle); }

    .cat-actions { display: flex; gap: 2px; flex: none; }
    .iconbtn {
      background: transparent; border: 0; padding: 4px; border-radius: 8px;
      color: var(--artha-text-subtle); font-size: 18px; display: flex; cursor: pointer;
    }
    .iconbtn:hover { background: var(--artha-surface-2); color: var(--artha-text-muted); }
    .iconbtn.danger:hover { color: var(--artha-negative); }

    .state, .empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px; padding: 48px 24px; color: var(--artha-text-subtle); text-align: center;
    }
    .empty ion-icon { font-size: 40px; }
    .empty .cta { color: var(--artha-accent); font-weight: 600; cursor: pointer; }
  `],
})
export class CategoriesListPage implements OnInit {
  protected readonly store = inject(CategoriesStore);
  private readonly alertCtrl = inject(AlertController);
  private readonly modalCtrl = inject(ModalController);
  private readonly notifier = inject(ConflictNotifierService);

  protected readonly view = signal<'active' | 'archived'>('active');
  protected readonly selecting = signal(false);
  protected readonly selectedIds = signal<Set<string>>(new Set());

  protected readonly visible = computed(() =>
    this.view() === 'active'
      ? this.store.active()
      : this.store.items().filter((c) => c.archived),
  );

  ngOnInit(): void {
    void this.store.load();
  }

  protected async onView(event: Event): Promise<void> {
    const value = (event as CustomEvent<{ value: 'active' | 'archived' }>).detail?.value;
    if (!value || value === this.view()) {
      return;
    }
    this.view.set(value);
    if (value === 'archived') {
      await this.store.load(true);
    }
  }

  protected badgeColor(cat: Category): string {
    return cat.color || 'var(--artha-accent)';
  }

  protected badgeBg(cat: Category): string {
    return cat.color ? `${cat.color}22` : 'var(--artha-accent-tint)';
  }

  // --- Selection / merge -------------------------------------------------

  protected enterSelect(): void {
    this.selectedIds.set(new Set());
    this.selecting.set(true);
  }

  protected cancelSelect(): void {
    this.selecting.set(false);
    this.selectedIds.set(new Set());
  }

  protected isSelected(cat: Category): boolean {
    return this.selectedIds().has(cat.id);
  }

  protected onCardClick(cat: Category): void {
    if (this.selecting()) {
      this.toggle(cat);
    } else if (!cat.archived) {
      void this.openEditor(cat);
    }
  }

  private toggle(cat: Category): void {
    const next = new Set(this.selectedIds());
    if (next.has(cat.id)) {
      next.delete(cat.id);
    } else {
      next.add(cat.id);
    }
    this.selectedIds.set(next);
  }

  protected async startMerge(): Promise<void> {
    const chosen = this.store.active().filter((c) => this.selectedIds().has(c.id));
    if (chosen.length < 2) {
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'Keep which category?',
      message:
        'Expenses from the others move into the one you keep, and those categories are archived.',
      inputs: chosen.map((c, i) => ({
        type: 'radio' as const,
        label: c.name,
        value: c.id,
        checked: i === 0,
      })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Merge',
          handler: (targetId: string) => {
            void this.runMerge(targetId, chosen);
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  private async runMerge(targetId: string, chosen: Category[]): Promise<void> {
    const sourceIds = chosen.map((c) => c.id).filter((id) => id !== targetId);
    if (sourceIds.length === 0) {
      return;
    }
    const targetName = chosen.find((c) => c.id === targetId)?.name ?? 'category';
    try {
      await this.store.merge(targetId, sourceIds);
      this.cancelSelect();
      await this.notifier.notifyInfo(
        `Merged ${sourceIds.length + 1} categories into "${targetName}".`,
      );
    } catch {
      await this.notifier.notifyError('Could not merge categories. Please try again.');
    }
  }

  // --- Editing / archiving ----------------------------------------------

  protected addCategory(): void {
    void this.openEditor();
  }

  protected edit(event: Event, cat: Category): void {
    event.stopPropagation();
    void this.openEditor(cat);
  }

  /** Open the category editor modal. The modal saves itself and dismisses
      with role 'saved' on success. */
  private async openEditor(category?: Category): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CategoryEditModal,
      componentProps: { category },
    });
    await modal.present();
    await modal.onWillDismiss();
  }

  protected onArchive(event: Event, cat: Category): void {
    event.stopPropagation();
    void this.archive(cat);
  }

  private async archive(cat: Category): Promise<void> {
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
