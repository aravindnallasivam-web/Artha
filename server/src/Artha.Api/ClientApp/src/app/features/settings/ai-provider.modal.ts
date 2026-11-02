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
} from '../../core/ai/ai-provider.service';

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
        When Artha can't tell which category or account a bank SMS belongs to, it can ask an AI model and
        pre-fill its answer for you to confirm. What you confirm is learned, so the AI is asked less over time.
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
            ></ion-input>
          </ion-item>
          <ion-item>
            <ion-input
              label="Model"
              labelPlacement="stacked"
              autocapitalize="off"
              [placeholder]="kind() === 'anthropic' ? defaultClaudeModel : 'e.g. gpt-4o-mini or llama3.1'"
              [(ngModel)]="model"
            ></ion-input>
          </ion-item>
        </ion-list>

        <ion-button expand="block" fill="outline" [disabled]="testing()" (click)="test()">
          @if (testing()) { <ion-spinner name="dots"></ion-spinner> } @else { Test connection }
        </ion-button>
        @if (testResult(); as r) {
          <p class="result" [class.ok]="r.ok">{{ r.message }}</p>
        }

        <ion-note class="privacy">
          The full SMS text, plus your category and account names, is sent to this provider only for messages
          Artha can't match itself. Your key is stored on this device only and never synced to Google Drive.
          @if (kind() === 'anthropic') {
            Claude Opus 5.5 is the default; for lower cost you can enter claude-haiku-5-5 instead.
          }
        </ion-note>
      }
    </ion-content>
  `,
  styles: [`
    .intro { margin: 4px 4px 16px; color: var(--artha-text-muted); font-size: 14px; line-height: 1.5; }
    .form { margin: 16px 0; }
    .result { margin: 12px 4px 0; font-size: 13.5px; color: var(--artha-negative); }
    .result.ok { color: var(--artha-positive); }
    .privacy { display: block; margin: 16px 4px; font-size: 12.5px; line-height: 1.5; color: var(--artha-text-subtle); }
  `],
})
export class AiProviderModal {
  private readonly modalCtrl = inject(ModalController);
  private readonly ai = inject(AiProviderService);

  protected readonly defaultClaudeModel = DEFAULT_CLAUDE_MODEL;
  protected readonly kind = signal<AiProviderKind>(this.ai.config().kind);
  protected apiKey = this.ai.config().apiKey;
  protected model = this.ai.config().model;
  protected baseUrl = this.ai.config().baseUrl;
  protected readonly testing = signal(false);
  protected readonly testResult = signal<{ ok: boolean; message: string } | null>(null);

  protected setKind(kind: AiProviderKind): void {
    const previous = this.kind();
    this.kind.set(kind);
    this.testResult.set(null);
    // Don't carry a Claude model name over to a custom server or vice versa.
    if (kind !== previous && kind !== 'off') {
      this.model = kind === 'anthropic' ? DEFAULT_CLAUDE_MODEL : '';
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

  protected close(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }
}
