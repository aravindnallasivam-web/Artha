import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { EventsStore, localToday } from './events.store';

const EMOJIS = ['🏖️', '✈️', '🏔️', '🚗', '🎂', '💍', '🎉', '🛕', '🏠', '🎓', '🏥', '🎁'];

/** Create or edit an event: name, emoji, dates, budget, people. */
@Component({
  selector: 'artha-event-edit',
  standalone: true,
  imports: [FormsModule, IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/events" text=""></ion-back-button></ion-buttons>
        <ion-title>{{ id ? 'Edit event' : 'New event' }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <form class="wrap" (ngSubmit)="save()">
        <label class="field"><span>Name</span>
          <input name="name" [(ngModel)]="name" placeholder="Goa trip, Amma's birthday…" maxlength="60" required />
        </label>
        <div class="emojis" role="group" aria-label="Icon">
          @for (e of emojis; track e) {
            <button type="button" class="emoji" [class.sel]="emoji === e" (click)="emoji = emoji === e ? '' : e">{{ e }}</button>
          }
        </div>
        <div class="two">
          <label class="field"><span>Starts</span>
            <input type="date" name="start" [(ngModel)]="start" required />
          </label>
          <label class="field"><span>Ends</span>
            <input type="date" name="end" [(ngModel)]="end" [min]="start" required />
          </label>
        </div>
        <div class="two">
          <label class="field"><span>Budget (optional)</span>
            <input name="budget" inputmode="decimal" [(ngModel)]="budget" placeholder="₹25,000" />
          </label>
          <label class="field"><span>People sharing</span>
            <input name="people" type="number" min="1" max="50" [(ngModel)]="people" />
          </label>
        </div>
        <p class="hint">Every expense dated {{ start || '…' }} to {{ end || '…' }} joins this event automatically — SMS, Scan &amp;
          Pay or added by hand. You can move one in or out on the expense screen.</p>
        @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
        <button type="submit" class="btn" [disabled]="busy()">{{ busy() ? 'Saving…' : id ? 'Save changes' : 'Create event' }}</button>
      </form>
    </ion-content>
  `,
  styles: [`
    ion-content { --background: var(--artha-surface); }
    ion-toolbar { --background: var(--artha-surface); }
    .wrap { max-width: 560px; margin: 0 auto; padding: 8px 16px 24px; display: flex; flex-direction: column; gap: 14px; }
    .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .field span { font-size: 12.5px; font-weight: 700; color: var(--artha-text-subtle); }
    .field input {
      height: 48px; padding: 0 14px; border-radius: 14px; border: 1px solid var(--artha-border); min-width: 0;
      background: var(--artha-surface); color: var(--artha-text); font: inherit; font-size: 15px;
    }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .emojis { display: flex; flex-wrap: wrap; gap: 8px; }
    .emoji { width: 44px; height: 44px; border-radius: 14px; border: 2px solid transparent; background: var(--artha-surface-2); font-size: 22px; cursor: pointer; }
    .emoji.sel { border-color: var(--artha-accent); background: var(--artha-accent-tint); }
    .hint { margin: 0; font-size: 12.5px; color: var(--artha-text-muted); line-height: 1.45; }
    .err { margin: 0; font-size: 13px; font-weight: 600; color: var(--artha-negative); }
    .btn { height: 54px; border: 0; border-radius: 999px; background: var(--artha-accent); color: #fff; font: inherit; font-size: 16px; font-weight: 800; cursor: pointer; }
    .btn[disabled] { opacity: 0.5; }
  `],
})
export class EventEditPage implements OnInit {
  private readonly events = inject(EventsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly emojis = EMOJIS;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected id: string | null = null;
  protected name = '';
  protected emoji = '';
  protected start = localToday();
  protected end = localToday();
  protected budget = '';
  protected people = 1;

  async ngOnInit(): Promise<void> {
    this.id = this.route.snapshot.paramMap.get('id');
    if (!this.id) return;
    await this.events.ensureLoaded();
    const e = this.events.byId()[this.id];
    if (!e) return;
    this.name = e.name;
    this.emoji = e.emoji ?? '';
    this.start = e.start;
    this.end = e.end;
    this.budget = e.budget ? String(e.budget) : '';
    this.people = e.people;
  }

  protected async save(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const req = {
        name: this.name,
        emoji: this.emoji || null,
        start: this.start,
        end: this.end < this.start ? this.start : this.end,
        budget: Number(String(this.budget).replace(/[^0-9.]/g, '')) || null,
        people: Number(this.people) || 1,
      };
      const saved = this.id ? await this.events.update(this.id, req) : await this.events.add(req);
      await this.router.navigate(['/events', saved.id], { replaceUrl: true });
    } catch (e) {
      this.error.set((e as Error)?.message || "Couldn't save the event.");
    } finally {
      this.busy.set(false);
    }
  }
}
