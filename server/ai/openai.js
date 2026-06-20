import config from '../config.js';
import { DECISION_SCHEMA } from './prompt.js';

/**
 * OpenAI (and OpenAI-compatible) chat completions adapter.
 * Uses JSON response format and returns the parsed object.
 */
export class OpenAIProvider {
  constructor(opts = {}) {
    this.apiKey = opts.apiKey ?? config.ai.openai.apiKey;
    this.baseUrl = (opts.baseUrl ?? config.ai.openai.baseUrl).replace(/\/$/, '');
    this.model = opts.model ?? config.ai.model;
    this.name = 'openai';
  }

  hasCreds() {
    return Boolean(this.apiKey);
  }

  async complete({ system, user }) {
    if (!this.apiKey) throw new Error('缺少 OPENAI_API_KEY');
    const res = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'trade_decision',
            schema: DECISION_SCHEMA,
            strict: true,
          },
        },
      }),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`OpenAI 请求失败 ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text);
    const content =
      json.output_text ??
      json.output?.flatMap((item) => item.content || []).map((part) => part.text || '').join('') ??
      '';
    return { text: content, model: this.model, provider: this.name };
  }
}

export default OpenAIProvider;
