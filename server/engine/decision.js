import config from '../config.js';
import { createProvider, extractJson } from '../ai/index.js';
import { SYSTEM_PROMPT, buildUserPrompt, normalizeDecision } from '../ai/prompt.js';
import { decisionDao } from '../db.js';

/**
 * Run one AI decision pass over the given indicators.
 * Returns the normalized decision plus provider metadata. Does NOT persist
 * or execute — the engine combines this with risk + execution.
 *
 * @param {object} indicators  output of computeIndicators()
 * @param {object} ctx         { position, lastDecision, mode, provider }
 */
export async function decide(indicators, ctx = {}) {
  const provider = ctx.provider || createProvider();
  if (!provider.hasCreds()) {
    throw new Error(`AI 提供方 "${provider.name}" 未配置 API key`);
  }

  const system = SYSTEM_PROMPT;
  const user = buildUserPrompt(indicators, {
    position: ctx.position,
    lastDecision: ctx.lastDecision ?? decisionDao.recent(1)[0],
    mode: ctx.mode,
  });

  const { text, model, provider: providerName } = await provider.complete({ system, user });
  const raw = extractJson(text);
  const decision = normalizeDecision(raw);

  return {
    ...decision,
    provider: providerName,
    model,
    indicators,
    ts: Date.now(),
    raw: text,
  };
}

/**
 * Deterministic fallback decision when no AI is configured / reachable.
 * Pure rules over indicators so the pipeline (and engine) still runs.
 */
export function ruleBasedDecide(indicators) {
  let action = 'HOLD';
  let confidence = 0.5;
  const reasons = [];

  const up = indicators.trend === 'up' && indicators.maCross === 'golden';
  const down = indicators.trend === 'down' && indicators.maCross === 'dead';
  const volExpand = (indicators.volSpike ?? 0) > 1.3;

  if (up) {
    action = 'BUY';
    confidence = volExpand ? 0.7 : 0.6;
    reasons.push('上涨趋势 + 均线金叉');
    if (volExpand) reasons.push('成交量放大');
  } else if (down) {
    action = 'SELL';
    confidence = volExpand ? 0.7 : 0.6;
    reasons.push('下跌趋势 + 均线死叉');
    if (volExpand) reasons.push('成交量放大');
  } else {
    reasons.push('信号混合，暂不行动');
  }

  // overextended price position dampens conviction
  if (action === 'BUY' && (indicators.pricePosition ?? 0) > 0.9) {
    confidence -= 0.15;
    reasons.push('价格接近区间高位，降低信心');
  }

  confidence = Math.min(1, Math.max(0, confidence));
  const sizePct = action === 'HOLD' ? 0 : Math.min(1, confidence);

  return {
    action,
    confidence: Number(confidence.toFixed(2)),
    sizePct: Number(sizePct.toFixed(2)),
    reason: reasons.join('; '),
    provider: 'rule-based',
    model: 'builtin',
    indicators,
    ts: Date.now(),
  };
}

export default { decide, ruleBasedDecide };
