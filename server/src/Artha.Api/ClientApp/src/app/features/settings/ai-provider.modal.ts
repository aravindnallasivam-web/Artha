import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import {
  AiProviderConfig,
  AiProviderKind,
  AiProviderService,
  DEFAULT_CLAUDE_MODEL,
  NamedRef,
} from '../../core/ai/ai-provider.service';
import { SmsCaptureService } from '../sms/sms-capture.service';

/** Add / change the AI provider used to categorise SMS Artha can't match on its own. */
@Component({
  selector: 'artha-ai-provider-modal',
  standalone: true,
  imports: [
    FormsModule,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonList,
    IonNote,
    IonSegment,
    IonSegmentButton,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="close()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>AI provider</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" (click)="save()">Save</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <p class="intro">
        @if (smsSupported) {
          When Artha can't tell which category or account a bank SMS belongs to, it can ask an AI model and
          pre-fill its answer for you to confirm. What you confirm is learned, so the AI is asked less over time.
          When adding an expense by hand, tap Suggest next to Category to ask it too.
        } @else {
          When you add an expense, tap Suggest next to Category and Artha asks an AI model which of your
          categories fits the note. You can always pick a different one.
        }
      </p>

      <ion-segment [value]="kind()" (ionChange)="setKind($any($event).detail.value)">
        <ion-segment-button value="off">Off</ion-segment-button>
        <ion-segment-button value="anthropic">Claude</ion-segment-button>
        <ion-segment-button value="openai-compatible">Custom</ion-segment-button>
      </ion-segment>

      @if (kind() !== 'off') {
        <ion-list inset="true" class="form">
          @if (kind() === 'openai-compatible') {
            <ion-item>
              <ion-input
                label="Base URL"
                labelPlacement="stacked"
                placeholder="https://openrouter.ai/api/v1"
                inputmode="url"
                autocapitalize="off"
                [(ngModel)]="baseUrl"
                (ionBlur)="loadModels()"
              ></ion-input>
            </ion-item>
          }
          <ion-item>
            <ion-input
              label="API key"
              labelPlacement="stacked"
              type="password"
              autocomplete="off"
              autocapitalize="off"
              [placeholder]="kind() === 'anthropic' ? 'sk-ant-…' : 'Leave empty for a local server'"
              [(ngModel)]="apiKey"
              (ionBlur)="loadModels()"
            ></ion-input>
          </ion-item>
          @if (models().length > 0 && !manualModel()) {
            <ion-item>
              <ion-select
                label="Model"
                labelPlacement="stacked"
                interface="alert"
                [interfaceOptions]="{ header: 'Model' }"
                [value]="model"
                (ionChange)="pickModel($any($event).detail.value)"
              >
                @for (m of modelOptions(); track m.id) {
                  <ion-select-option [value]="m.id">{{ m.name }}</ion-select-option>
                }
                <ion-select-option value="__manual__">Type a model name…</ion-select-option>
              </ion-select>
            </ion-item>
          } @else {
            <ion-item>
              <ion-input
                label="Model"
                labelPlacement="stacked"
                autocapitalize="off"
                [placeholder]="kind() === 'anthropic' ? defaultClaudeModel : 'e.g. gpt-4o-mini or llama3.1'"
                [(ngModel)]="model"
              ></ion-input>
            </ion-item>
          }
        </ion-list>

        <div class="models-bar">
          <span class="models-note">
            @if (loadingModels()) {
              Loading models…
            } @else if (modelsError()) {
              {{ modelsError() }}
            } @else if (models().length > 0) {
              {{ models().length }} models available
            } @else {
              Enter your key to load the model list.
            }
          </span>
          <ion-button fill="clear" size="small" [disabled]="loadingModels()" (click)="loadModels(true)">
            @if (loadingModels()) { <ion-spinner name="dots"></ion-spinner> } @else { Refresh list }
          </ion-button>
        </div>

        <ion-button expand="block" fill="outline" [disabled]="testing()" (click)="test()">
          @if (testing()) { <ion-spinner name="dots"></ion-spinner> } @else { Test connection }
        </ion-button>
        @if (testResult(); as r) {
          <p class="result" [class.ok]="r.ok">{{ r.message }}</p>
        }

        @if (smsSupported) {
          <ion-button expand="block" fill="clear" [disabled]="testing()" (click)="trySamples()">
            Try on sample bank SMS
          </ion-button>
          <p class="samples-note">
            Saves this setup and adds 6 sample bank SMS to Pending expenses so you can see what the AI picks.
            Dismiss them afterwards — saving them would log them as real expenses.
          </p>
        }

        <ion-note class="privacy">
          Sent to this provider: the note of an expense when you tap Suggest, and the full text of bank SMS
          Artha can't match itself, together with your category and account names. Your key is stored on this
          device only and never synced to Google Drive.
          @if (kind() === 'anthropic') {
            Claude Opus 5.5 is the default; for lower cost you can enter claude-haiku-5-5 instead.
          }
        </ion-note>
      }
    </ion-content>
  `,
  styles: [`
    .intro { margin: 4px 4px 16px; color: var(--artha-text-muted); font-size: 14px; line-height: 1.5; }
    .form { margin: 16px 0 4px; }
    .models-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 4px 12px; }
    .models-note { font-size: 12.5px; color: var(--artha-text-subtle); }
    .result { margin: 12px 4px 0; font-size: 13.5px; color: var(--artha-negative); }
    .result.ok { color: var(--artha-positive); }
    .samples-note { margin: 0 4px; font-size: 12.5px; line-height: 1.5; color: var(--artha-text-subtle); }
    .privacy { display: block; margin: 16px 4px; font-size: 12.5px; line-height: 1.5; color: var(--artha-text-subtle); }
  `],
})
export class AiProviderModal {
  private readonly modalCtrl = inject(ModalController);
  private readonly ai = inject(AiProviderService);
  private readonly sms = inject(SmsCaptureService);
  protected readonly smsSupported = this.sms.isSupported();

  protected readonly defaultClaudeModel = DEFAULT_CLAUDE_MODEL;
  protected readonly kind = signal<AiProviderKind>(this.ai.config().kind);
  protected apiKey = this.ai.config().apiKey;
  protected model = this.ai.config().model;
  protected baseUrl = this.ai.config().baseUrl;
  protected readonly testing = signal(false);
  protected readonly models = signal<NamedRef[]>([]);
  protected readonly loadingModels = signal(false);
  protected readonly modelsError = signal('');
  protected readonly manualModel = signal(false);
  private modelsLoadedFor = '';

  /** The fetched list, plus the current model if it isn't in it (so it still shows). */
  protected modelOptions(): NamedRef[] {
    const list = this.models();
    const current = (this.model ?? '').trim();
    return current && !list.some((m) => m.id === current) ? [{ id: current, name: current }, ...list] : list;
  }

  constructor() {
    void this.loadModels();
  }

  protected pickModel(id: string): void {
    if (id === '__manual__') {
      this.manualModel.set(true);
      return;
    }
    this.model = id;
  }

  /** Fetch the provider's models; skipped when nothing changed unless forced. */
  protected async loadModels(force = false): Promise<void> {
    const draft = this.draft();
    const ready =
      draft.kind === 'anthropic' ? !!draft.apiKey.trim() : draft.kind === 'openai-compatible' && !!draft.baseUrl.trim();
    if (!ready) return;
    const signature = `${draft.kind}|${draft.baseUrl}|${draft.apiKey}`;
    if (!force && signature === this.modelsLoadedFor) return;
    this.loadingModels.set(true);
    this.modelsError.set('');
    try {
      const list = await this.ai.listModels(draft);
      this.models.set(list);
      this.modelsLoadedFor = signature;
      this.manualModel.set(list.length === 0);
      // A custom server's list replaces whatever was typed; Claude keeps the default.
      if (list.length && !list.some((m) => m.id === this.model) && this.kind() === 'openai-compatible') {
        this.model = list[0].id;
      }
    } catch (err) {
      this.models.set([]);
      this.manualModel.set(true);
      this.modelsError.set(err instanceof Error ? err.message : "Couldn't load models.");
    } finally {
      this.loadingModels.set(false);
    }
  }
  protected readonly testResult = signal<{ ok: boolean; message: string } | null>(null);

  protected setKind(kind: AiProviderKind): void {
    const previous = this.kind();
    this.kind.set(kind);
    this.testResult.set(null);
    // Don't carry a Claude model name over to a custom server or vice versa.
    if (kind !== previous && kind !== 'off') {
      this.model = kind === 'anthropic' ? DEFAULT_CLAUDE_MODEL : '';
      this.models.set([]);
      this.modelsError.set('');
      this.manualModel.set(false);
      this.modelsLoadedFor = '';
      void this.loadModels();
    }
  }

  private draft(): AiProviderConfig {
    return {
      kind: this.kind(),
      apiKey: this.apiKey ?? '',
      model: (this.model ?? '').trim() || (this.kind() === 'anthropic' ? DEFAULT_CLAUDE_MODEL : ''),
      baseUrl: this.baseUrl ?? '',
    };
  }

  protected async test(): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    try {
      await this.ai.test(this.draft());
      this.testResult.set({ ok: true, message: 'Connected. The model answered correctly.' });
    } catch (err) {
      this.testResult.set({ ok: false, message: err instanceof Error ? err.message : 'Connection failed.' });
    } finally {
      this.testing.set(false);
    }
  }

  protected save(): void {
    this.ai.save(this.draft());
    void this.modalCtrl.dismiss(null, 'saved');
  }

  /** Save the current setup, close, and open Pending with the sample SMS queued. */
  protected async trySamples(): Promise<void> {
    this.ai.save(this.draft());
    await this.modalCtrl.dismiss(null, 'saved');
    await this.sms.addSampleMessages();
  }

  protected close(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }
}
