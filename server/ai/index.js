import config from '../config.js';
import OpenAIProvider from './openai.js';
import AnthropicProvider from './anthropic.js';

/**
 * Provider factory. Add OpenAI-compatible endpoints by setting AI_PROVIDER=openai
 * and pointing OPENAI_BASE_URL at the compatible host.
 */
export function createProvider(name = config.ai.provider, opts = {}) {
  switch ((name || '').toLowerCase()) {
    case 'openai':
      return new OpenAIProvider(opts);
    case 'anthropic':
      return new AnthropicProvider(opts);
    default:
      throw new Error(`未知 AI 提供方：${name}`);
  }
}

/**
 * Robustly extract a JSON object from a model's text output, tolerating
 * accidental markdown fences or surrounding prose.
 */
export function extractJson(text) {
  if (!text) throw new Error('AI 返回为空');
  let s = text.trim();
  // strip ```json ... ``` fences if present
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // take the outermost {...}
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('AI 返回中没有 JSON 对象：' + s.slice(0, 120));
  }
  return JSON.parse(s.slice(start, end + 1));
}

export { OpenAIProvider, AnthropicProvider };
export default { createProvider, extractJson };
