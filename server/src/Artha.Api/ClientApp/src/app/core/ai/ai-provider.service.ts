import { Injectable, computed, signal } from '@angular/core';
import type AnthropicClient from '@anthropic-ai/sdk';

export type AiProviderKind = 'off' | 'anthropic' | 'openai-compatible';

export interface AiProviderConfig {
  kind: AiProviderKind;
  apiKey: string;
  model: string;
  /** OpenAI-compatible only, e.g. https://openrouter.ai/api/v1 or http://192.168.1.5:11434/v1 */
  baseUrl: string;
}

export interface NamedRef {
  id: string;
  name: string;
}

/** What the model picked for one SMS; null fields mean "no confident match". */
export interface AiSuggestion {
  categoryId: string | null;
  accountId: string | null;
  merchant: string | null;
}

export interface SmsForAi {
  sender: string;
  body: string;
  amount: number;
  date: string;
}

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

// Device-only on purpose: this key is never written to the Drive-synced settings.
const CONFIG_KEY = 'artha.ai.provider';
const NONE = 'none';

const SYSTEM_PROMPT = [
  'You classify bank and UPI transaction SMS messages for a personal expense tracker used in India.',
  'Pick the one category and the one account, from the lists given, that this transaction belongs to, and return their ids.',
  'Match the account by bank name, sender code, the last digits of the card or account number, or the UPI handle in the message.',
  'Match the category by the merchant or payee and what they sell.',
  `If no listed category or account fits with reasonable confidence, return "${NONE}" for it rather than guessing.`,
  'Also return the merchant or payee name as a short, clean display name (for example "Swiggy", not "SWIGGY*BANGALORE").',
].join(' ');

@Injectable({ providedIn: 'root' })
export class AiProviderService {
  private readonly _config = signal<AiProviderConfig>(loadConfig());
  readonly config = this._config.asReadonly();

  readonly isEnabled = computed(() => {
    const c = this._config();
    if (c.kind === 'off' || !c.model.trim()) return false;
    if (c.kind === 'anthropic') return !!c.apiKey.trim();
    return !!c.baseUrl.trim();
  });

  readonly label = computed(() => {
    const c = this._config();
    if (!this.isEnabled()) return 'Off';
    return c.kind === 'anthropic' ? 'Claude' : hostOf(c.baseUrl) || 'Custom';
  });

  save(config: AiProviderConfig): void {
    const clean: AiProviderConfig = {
      kind: config.kind,
      apiKey: config.apiKey.trim(),
      model: config.model.trim(),
      baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    };
    this._config.set(clean);
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
    } catch {
      // Storage unavailable — the config lives for this session only.
    }
  }

  /** Make one tiny request with `config` (not necessarily saved) and throw a readable error on failure. */
  async test(config: AiProviderConfig): Promise<void> {
    const result = await this.classifyWith(
      config,
      { sender: 'HDFCBK', body: 'Rs.250.00 debited from a/c XX1234 to VPA swiggy@icici on 02-11-26. UPI Ref 123456789.', amount: 250, date: '2026-11-02' },
      [{ id: 'food', name: 'Food' }, { id: 'travel', name: 'Travel' }],
      [{ id: 'hdfc', name: 'HDFC Savings' }],
    );
    if (!result) {
      throw new Error('The provider answered, but not in the expected format. Try a different model.');
    }
  }

  /**
   * Ask the configured provider which category and account an SMS belongs to.
   * Returns null when AI is off, the call fails, or the model declines.
   */
  async classifySms(sms: SmsForAi, categories: NamedRef[], accounts: NamedRef[]): Promise<AiSuggestion | null> {
    if (!this.isEnabled() || (categories.length === 0 && accounts.length === 0)) return null;
    try {
      return await this.classifyWith(this._config(), sms, categories, accounts);
    } catch {
      return null;
    }
  }

  private async classifyWith(
    config: AiProviderConfig,
    sms: SmsForAi,
    categories: NamedRef[],
    accounts: NamedRef[],
  ): Promise<AiSuggestion | null> {
    const schema = suggestionSchema(categories, accounts);
    const prompt = userPrompt(sms, categories, accounts);
    const raw =
      config.kind === 'anthropic'
        ? await this.callClaude(config, prompt, schema)
        : await this.callOpenAiCompatible(config, prompt, schema);
    if (raw == null) return null;
    return toSuggestion(raw, categories, accounts);
  }

  private async callClaude(config: AiProviderConfig, prompt: string, schema: Record<string, unknown>): Promise<unknown> {
    // Loaded on first use so the SDK stays out of the startup bundle.
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    // Bring-your-own-key: the key is the user's own and stays on their device,
    // so calling the API straight from the WebView is intended here.
    const client = new Anthropic({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
      timeout: 30_000,
      maxRetries: 1,
    });
    const model = config.model || DEFAULT_CLAUDE_MODEL;
    const base = {
      model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema } },
      messages: [{ role: 'user' as const, content: prompt }],
    };
    try {
      // Haiku has no server-side fallback; the other current models retry a
      // safety decline on Anthropic's recommended model instead of refusing.
      const response = model.startsWith('claude-haiku')
        ? await client.beta.messages.create(base)
        : await client.beta.messages.create({
            ...base,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          });
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
      const text = response.content.find((b) => b.type === 'text');
      return text && text.type === 'text' ? JSON.parse(text.text) : null;
    } catch (err) {
      throw new Error(claudeErrorMessage(Anthropic, err));
    }
  }

  private async callOpenAiCompatible(config: AiProviderConfig, prompt: string, schema: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${SYSTEM_PROMPT} Reply with only a JSON object matching this JSON Schema: ${JSON.stringify(schema)}` },
            { role: 'user', content: prompt },
          ],
        }),
      });
    } catch {
      throw new Error(`Couldn't reach ${config.baseUrl}. Check the URL and that the server allows requests from the app (CORS).`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`The provider returned ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    try {
      return JSON.parse(stripFences(content));
    } catch {
      return null;
    }
  }
}

function loadConfig(): AiProviderConfig {
  const fallback: AiProviderConfig = { kind: 'off', apiKey: '', model: DEFAULT_CLAUDE_MODEL, baseUrl: '' };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<AiProviderConfig>) } : fallback;
  } catch {
    return fallback;
  }
}

function suggestionSchema(categories: NamedRef[], accounts: NamedRef[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      categoryId: { type: 'string', enum: [...categories.map((c) => c.id), NONE] },
      accountId: { type: 'string', enum: [...accounts.map((a) => a.id), NONE] },
      merchant: { type: 'string' },
    },
    required: ['categoryId', 'accountId', 'merchant'],
    additionalProperties: false,
  };
}

function userPrompt(sms: SmsForAi, categories: NamedRef[], accounts: NamedRef[]): string {
  const list = (items: NamedRef[]) => items.map((i) => `- ${i.id}: ${i.name}`).join('\n') || '(none)';
  return [
    `<sms sender="${sms.sender}" date="${sms.date}" amount="${sms.amount}">`,
    sms.body,
    '</sms>',
    '',
    'Categories (id: name):',
    list(categories),
    '',
    'Accounts (id: name):',
    list(accounts),
  ].join('\n');
}

/** Keep only ids that really exist in the lists; anything else becomes null. */
function toSuggestion(raw: unknown, categories: NamedRef[], accounts: NamedRef[]): AiSuggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pick = (value: unknown, items: NamedRef[]) =>
    typeof value === 'string' && items.some((i) => i.id === value) ? value : null;
  const merchant = typeof r['merchant'] === 'string' ? r['merchant'].trim() : '';
  return {
    categoryId: pick(r['categoryId'], categories),
    accountId: pick(r['accountId'], accounts),
    merchant: merchant || null,
  };
}

function claudeErrorMessage(Anthropic: typeof AnthropicClient, err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check that you copied the whole key.';
  if (err instanceof Anthropic.PermissionDeniedError) return "This key isn't allowed to use that model.";
  if (err instanceof Anthropic.NotFoundError) return 'Model not found. Check the model name.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic. Try again in a minute.';
  if (err instanceof Anthropic.BadRequestError) return `Request rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Anthropic error ${err.status ?? ''}: ${err.message}`;
  return err instanceof Error ? err.message : 'Unknown error';
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
