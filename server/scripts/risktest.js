/**
 * Offline test for stage 2 — risk guardrails + rule-based decision.
 * No network / no AI key required.
 *
 * Run: node server/scripts/risktest.js
 */
import { applyRisk, evaluatePositionExits, setRiskParams, getRiskParams } from '../engine/risk.js';
import { ruleBasedDecide } from '../engine/decision.js';
import { extractJson } from '../ai/index.js';
import { normalizeDecision } from '../ai/prompt.js';

function assert(cond, msg) {
  if (!cond) throw new Error('断言失败：' + msg);
  console.log('✓ ' + msg);
}

console.log('\n=== 阶段 2 离线测试 ===\n');

// reset risk params to known values
setRiskParams({
  maxOrderUsdt: 100, maxPositionUsdt: 500, stopLossPct: 0.05,
  takeProfitPct: 0.1, cooldownMs: 1800000, minConfidence: 0.6, leverage: 3,
});

// --- JSON extraction tolerance ---
assert(extractJson('{"action":"BUY","confidence":0.8,"sizePct":0.5,"reason":"x"}').action === 'BUY', '可提取纯 JSON');
assert(extractJson('```json\n{"action":"SELL","confidence":0.7,"sizePct":0.3,"reason":"y"}\n```').action === 'SELL', '可提取代码块 JSON');
assert(extractJson('Here is my call: {"action":"HOLD","confidence":0.2,"sizePct":0,"reason":"z"} done').action === 'HOLD', '可从混合文本中提取 JSON');

// --- normalize clamps ---
const norm = normalizeDecision({ action: 'buy', confidence: 5, sizePct: -1, reason: 'a'.repeat(999) });
assert(norm.action === 'BUY' && norm.confidence === 1 && norm.sizePct === 0, '标准化会限制置信度和仓位比例');
assert(normalizeDecision({ action: 'HOLD', sizePct: 0.9 }).sizePct === 0, '观望会强制仓位比例为 0');

// --- rule-based decide ---
const upInd = { trend: 'up', maCross: 'golden', volSpike: 1.5, pricePosition: 0.5 };
const rb = ruleBasedDecide(upInd);
assert(rb.action === 'BUY' && rb.confidence >= 0.6, '内置规则会在上涨+金叉+放量时给出买入');

// --- risk: confidence threshold ---
let r = applyRisk({ action: 'BUY', confidence: 0.4, sizePct: 1, reason: '' }, { lastPrice: 2000, positionUsdt: 0, lastExecutedTs: 0 });
assert(r.action === 'HOLD' && !r.allowed, '低置信度会被拦截');

// --- risk: cooldown ---
r = applyRisk({ action: 'BUY', confidence: 0.9, sizePct: 1, reason: '' }, { lastPrice: 2000, positionUsdt: 0, lastExecutedTs: Date.now() - 1000 });
assert(r.action === 'HOLD' && r.notes.some((n) => n.includes('冷却')), '冷却期会被拦截');

// --- risk: per-order cap ---
r = applyRisk({ action: 'BUY', confidence: 0.9, sizePct: 1, reason: '' }, { lastPrice: 2000, positionUsdt: 0, lastExecutedTs: 0 });
assert(r.allowed && r.sizeUsdt === 100, `单笔上限生效（实际 ${r.sizeUsdt}）`);

// --- risk: position cap trims order ---
r = applyRisk({ action: 'BUY', confidence: 0.9, sizePct: 1, reason: '' }, { lastPrice: 2000, positionUsdt: 450, lastExecutedTs: 0 });
assert(r.allowed && r.sizeUsdt === 50, `总仓位上限会缩减到剩余额度（实际 ${r.sizeUsdt}）`);
r = applyRisk({ action: 'SELL', confidence: 0.9, sizePct: 1, reason: '' }, { lastPrice: 2000, positionUsdt: 450, lastExecutedTs: 0 });
assert(r.allowed && r.sizeUsdt === 50, `总仓位上限会缩减卖出信号到剩余额度（实际 ${r.sizeUsdt}）`);

// --- risk: position full → HOLD ---
r = applyRisk({ action: 'BUY', confidence: 0.9, sizePct: 1, reason: '' }, { lastPrice: 2000, positionUsdt: 500, lastExecutedTs: 0 });
assert(!r.allowed && r.action === 'HOLD', '仓位已满会拦截新买入');
r = applyRisk({ action: 'SELL', confidence: 0.9, sizePct: 1, reason: '' }, { lastPrice: 2000, positionUsdt: 500, lastExecutedTs: 0 });
assert(!r.allowed && r.action === 'HOLD', '仓位已满会拦截新卖出');

// --- risk: live not armed ---
r = applyRisk({ action: 'BUY', confidence: 0.9, sizePct: 1, reason: '' }, { lastPrice: 2000, positionUsdt: 0, lastExecutedTs: 0, live: true, liveArmed: false });
assert(!r.allowed && r.notes.some((n) => n.includes('实盘')), '实盘需要先解锁');

// --- risk: live armed passes ---
r = applyRisk({ action: 'BUY', confidence: 0.9, sizePct: 0.5, reason: '' }, { lastPrice: 2000, positionUsdt: 0, lastExecutedTs: 0, live: true, liveArmed: true });
assert(r.allowed && r.sizeUsdt === 50, `实盘解锁后允许下单（实际 ${r.sizeUsdt}）`);

// --- risk: stop loss / take profit exits ---
const exits = evaluatePositionExits([
  { instId: 'ETH-USDT-SWAP', posSide: 'long', pos: '1', avgPx: '100', notionalUsd: '90' },
  { instId: 'ETH-USDT-SWAP', posSide: 'short', pos: '-1', avgPx: '100', notionalUsd: '112' },
], 90, getRiskParams());
assert(exits.length === 2, '可检测止损/止盈平仓信号');
assert(exits.some((x) => x.type === 'stop_loss' && x.action === 'SELL'), '多头止损会转成卖出平仓');
assert(exits.some((x) => x.type === 'take_profit' && x.action === 'BUY'), '空头止盈会转成买入平仓');
assert(evaluatePositionExits([{ posSide: 'long', pos: '1', avgPx: '100' }], 102, getRiskParams()).length === 0, '阈值内不会触发平仓');

console.log('\n所有阶段 2 风控/决策检查已通过。\n');
process.exit(0);
