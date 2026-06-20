import config from '../config.js';
import { settingsDao, decisionDao } from '../db.js';

/**
 * Deterministic risk guardrails. The AI suggestion is ONLY an input;
 * these rules decide the final action and size. Nothing bypasses this.
 *
 * Checks (standard tier):
 *  - confidence threshold
 *  - decision cooldown (anti-overtrading)
 *  - per-order max notional (USDT)
 *  - total position cap (USDT notional)
 *  - live-mode extra guard (must be explicitly armed)
 *
 * Stop-loss / take-profit percentages are emitted as attached params so the
 * order layer can place protective orders or the engine can monitor exits.
 */

/** Merge env defaults with any persisted runtime overrides. */
export function getRiskParams() {
  const overrides = settingsDao.get('risk', {}) || {};
  return { ...config.risk, ...overrides };
}

export function setRiskParams(partial) {
  const merged = { ...getRiskParams(), ...partial };
  settingsDao.set('risk', merged);
  return merged;
}

/**
 * @param {object} decision  normalized {action, confidence, sizePct, reason}
 * @param {object} ctx
 *   ctx.lastPrice       number   latest mark price
 *   ctx.positionUsdt    number   current absolute position notional (USDT)
 *   ctx.lastExecutedTs  number   ms of last executed decision (cooldown)
 *   ctx.live            boolean  true if live trading
 *   ctx.liveArmed       boolean  true if user explicitly armed live trading
 * @returns {object} { action, sizeUsdt, allowed, notes[], stopLossPct, takeProfitPct, params }
 */
export function applyRisk(decision, ctx = {}) {
  const r = getRiskParams();
  const notes = [];
  const now = Date.now();

  const {
    lastPrice = 0,
    positionUsdt = 0,
    lastExecutedTs = decisionDao.lastExecuted()?.ts ?? 0,
    live = !config.okx.simulated,
    liveArmed = false,
  } = ctx;

  let action = decision.action;
  let allowed = action !== 'HOLD';

  // 1) Confidence threshold
  if (allowed && decision.confidence < r.minConfidence) {
    allowed = false;
    notes.push(`置信度 ${decision.confidence} 低于阈值 ${r.minConfidence} → 观望`);
  }

  // 2) Cooldown
  if (allowed && lastExecutedTs && now - lastExecutedTs < r.cooldownMs) {
    const waitMs = r.cooldownMs - (now - lastExecutedTs);
    allowed = false;
    notes.push(`冷却中，剩余 ${Math.ceil(waitMs / 1000)} 秒 → 观望`);
  }

  // 3) Live-mode extra guard
  if (allowed && live && !liveArmed) {
    allowed = false;
    notes.push('实盘未由用户解锁 → 已拦截');
  }

  // 4) Sizing — start from per-order budget scaled by sizePct, cap by notional
  let sizeUsdt = 0;
  if (allowed) {
    sizeUsdt = r.maxOrderUsdt * decision.sizePct;
    if (sizeUsdt > r.maxOrderUsdt) {
      sizeUsdt = r.maxOrderUsdt;
      notes.push(`单笔金额超过上限，已按 ${r.maxOrderUsdt} USDT 限制`);
    }

    // 5) Total position cap. 普通信号的 BUY/SELL 都可能增加合约风险敞口。
    const projected = positionUsdt + sizeUsdt;
    if (projected > r.maxPositionUsdt) {
      const room = Math.max(0, r.maxPositionUsdt - positionUsdt);
      sizeUsdt = room;
      notes.push(`总仓位上限 ${r.maxPositionUsdt} USDT → 订单缩减至 ${room.toFixed(2)} USDT`);
    }

    if (sizeUsdt <= 0) {
      allowed = false;
      notes.push('计算仓位小于等于 0 → 观望');
    }
  }

  if (!allowed) action = 'HOLD';

  return {
    action,
    allowed,
    sizeUsdt: allowed ? Number(sizeUsdt.toFixed(2)) : 0,
    stopLossPct: r.stopLossPct,
    takeProfitPct: r.takeProfitPct,
    leverage: r.leverage,
    notes,
    params: r,
    lastPrice,
  };
}

/** 检查持仓是否触发确定性的止损或止盈平仓信号。 */
export function evaluatePositionExits(positions = [], lastPrice = 0, params = getRiskParams()) {
  const price = Number(lastPrice);
  if (!Number.isFinite(price) || price <= 0) return [];

  const exits = [];
  for (const position of positions || []) {
    const pos = Number(position.pos);
    const entry = Number(position.avgPx);
    if (!Number.isFinite(pos) || pos === 0 || !Number.isFinite(entry) || entry <= 0) continue;

    const isShort = position.posSide === 'short' || pos < 0;
    const pnlPct = isShort ? (entry - price) / entry : (price - entry) / entry;
    const action = isShort ? 'BUY' : 'SELL';
    const notionalUsdt = Math.abs(Number(position.notionalUsd ?? pos * price));

    if (pnlPct <= -params.stopLossPct) {
      exits.push({
        type: 'stop_loss',
        action,
        position,
        pnlPct,
        notionalUsdt,
        note: `触发止损（${(pnlPct * 100).toFixed(2)}%）`,
      });
    } else if (pnlPct >= params.takeProfitPct) {
      exits.push({
        type: 'take_profit',
        action,
        position,
        pnlPct,
        notionalUsdt,
        note: `触发止盈（${(pnlPct * 100).toFixed(2)}%）`,
      });
    }
  }
  return exits;
}

export default { applyRisk, evaluatePositionExits, getRiskParams, setRiskParams };
