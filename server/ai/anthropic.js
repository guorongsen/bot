import config from '../config.js';

/**
 * Anthropic Messages API adapter.
 * System prompt goes in the top-level `system` field; we instruct JSON-only
 * output via the prompt and parse the first text block.
 */
export class AnthropicProvider {
  constructor(opts = {}) {
    this.apiKey = opts.apiKey ?? config.ai.anthropic.apiKey;
    this.baseUrl = (opts.baseUrl ?? config.ai.anthropic.baseUrl).replace(/\/$/, '');
    this.model = opts.model ?? config.ai.model;
    this.name = 'anthropic';
    this.version = '2023-06-01';
  }

  hasCreds() {
    return Boolean(this.apiKey);
  }

  async complete({ system, user }) {
    if (!this.apiKey) throw new Error('缺少 ANTHROPIC_API_KEY');
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.version,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 512,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Anthropic 请求失败 ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text);
    const content = Array.isArray(json.content)
      ? json.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      : '';
    return { text: content, model: this.model, provider: this.name };
  }
}

export default AnthropicProvider;
