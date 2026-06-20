import config from '../config.js';

/**
 * The structured decision schema we force the model to return.
 * action  : BUY | SELL | HOLD
 * confidence : 0..1
 * sizePct : 0..1  fraction of the allowed per-order budget to deploy
 * reason  : short human-readable rationale
 */
export const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'confidence', 'sizePct', 'reason'],
  properties: {
    action: { type: 'string', enum: ['BUY', 'SELL', 'HOLD'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    sizePct: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string', maxLength: 400 },
  },
};

export const SYSTEM_PROMPT = `你是一名纪律严明的加密货币永续合约交易分析师。
你会收到单个合约的预计算日线指标，并在 BUY、SELL、HOLD 之间做出选择。

规则：
- 只输出一个符合 schema 的 JSON 对象，不要输出解释文字或 markdown 代码块。
- "confidence" 表示信号强度（0..1）。保持保守；信号冲突时优先 HOLD。
- "sizePct" 表示使用允许单笔预算的比例（0..1），按信心缩放；HOLD 必须为 0。
- "reason" 必须使用简体中文，简短说明趋势、均线结构、动量/连涨连跌、成交量、波动率和价格区间位置。
- 交易不保证盈利。避免过度交易，并尊重下游风控限制。`;

export function buildUserPrompt(indicators, context = {}) {
  const { position, lastDecision, mode } = context;
  const lines = [
    `合约：${indicators.instId}`,
    `模式：${mode || (config.okx.simulated ? 'SIMULATED' : 'LIVE')}`,
    `指标（日线，${indicators.window} 天窗口）：`,
    JSON.stringify(indicators, null, 2),
  ];
  if (position) {
    lines.push(`当前持仓：${JSON.stringify(position)}`);
  } else {
    lines.push('当前持仓：无');
  }
  if (lastDecision) {
    lines.push(
      `最近一次决策：${lastDecision.action}，置信度 ${lastDecision.confidence}（${new Date(
        lastDecision.ts
      ).toISOString()}）`
    );
  }
  lines.push(
    '请只返回 JSON 对象：{"action","confidence","sizePct","reason"}，其中 reason 用简体中文。'
  );
  return lines.join('\n');
}

/** Validate + coerce a raw model object into a safe decision. */
export function normalizeDecision(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('AI 返回的不是对象');
  let action = String(raw.action || '').toUpperCase();
  if (!['BUY', 'SELL', 'HOLD'].includes(action)) action = 'HOLD';

  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.min(1, Math.max(0, confidence));

  let sizePct = Number(raw.sizePct);
  if (!Number.isFinite(sizePct)) sizePct = 0;
  sizePct = Math.min(1, Math.max(0, sizePct));
  if (action === 'HOLD') sizePct = 0;

  const reason = String(raw.reason || '').slice(0, 400);
  return { action, confidence, sizePct, reason };
}

export default { DECISION_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, normalizeDecision };
