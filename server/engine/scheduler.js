import { EventEmitter } from 'node:events';
import config, { hasOkxCreds, hasAiCreds } from '../config.js';
import { getMarketSnapshot } from '../okx/market.js';
import { decide, ruleBasedDecide } from './decision.js';
import { applyRisk, evaluatePositionExits, getRiskParams } from './risk.js';
import { closePosition, executeOrder, getPositionUsdt } from './trader.js';
import { decisionDao, settingsDao, getSelectedInstId } from '../db.js';

/**
 * The scheduler engine. On each tick it:
 *   1. refreshes candles + indicators
 *   2. asks the AI (or rule-based fallback) for a decision
 *   3. passes it through deterministic risk guardrails
 *   4. executes via the trader if allowed (and creds present)
 *   5. persists the decision + emits events
 *
 * Emits: 'tick', 'decision', 'trade', 'error', 'status'.
 */
export class Engine extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.running = false;
    this.busy = false;
    this.lastDecision = null;
    this.lastError = null;
    // live trading must be explicitly armed via UI/API even if mode is live
    this.liveArmed = settingsDao.get('liveArmed', false);
  }

  get intervalMs() {
    return settingsDao.get('decisionIntervalMs', config.engine.decisionIntervalMs);
  }

  setInterval(ms) {
    settingsDao.set('decisionIntervalMs', ms);
    if (this.running) {
      this.stop();
      this.start();
    }
    return this.intervalMs;
  }

  setLiveArmed(armed) {
    this.liveArmed = Boolean(armed);
    settingsDao.set('liveArmed', this.liveArmed);
    this.emit('status', this.status());
    return this.liveArmed;
  }

  start() {
    if (this.running) return this.status();
    this.running = true;
    this.emit('status', this.status());
    // run immediately, then on interval
    this.runOnce().catch((e) => this.emit('error', e));
    this.timer = setInterval(() => {
      this.runOnce().catch((e) => this.emit('error', e));
    }, this.intervalMs);
    return this.status();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit('status', this.status());
    return this.status();
  }

  status() {
    const instId = getSelectedInstId();
    return {
      running: this.running,
      busy: this.busy,
      intervalMs: this.intervalMs,
      instId,
      simulated: config.okx.simulated,
      live: !config.okx.simulated,
      liveArmed: this.liveArmed,
      hasOkxCreds: hasOkxCreds(),
      hasAiCreds: hasAiCreds(),
      aiProvider: config.ai.provider,
      aiModel: config.ai.model,
      lastError: this.lastError,
      lastDecisionTs: this.lastDecision?.ts ?? null,
    };
  }

  /** Run a single decision cycle. Safe to call manually (e.g. "Decide now"). */
  async runOnce() {
    if (this.busy) return { skipped: true, reason: 'busy' };
    this.busy = true;
    this.emit('status', this.status());
    try {
      // 1. market data + indicators
      const instId = getSelectedInstId();
      const { candles, indicators, stale } = await getMarketSnapshot(instId);
      if (stale) throw new Error('行情数据已过期，跳过本次决策');
      this.emit('tick', { indicators, candleCount: candles.length });

      // 2. position context (best-effort)
      let positionUsdt = 0;
      let positions = [];
      try {
        const pos = await getPositionUsdt(instId);
        positionUsdt = pos.positionUsdt;
        positions = pos.positions;
      } catch (e) {
        if (hasOkxCreds()) throw new Error('持仓查询失败，跳过本次决策：' + e.message);
      }

      const lastPrice = indicators.lastClose;
      const exitSignals = evaluatePositionExits(positions, lastPrice);
      if (exitSignals.length) {
        const exitResults = [];
        const riskParams = getRiskParams();
        for (const exit of exitSignals) {
          const liveBlocked = !config.okx.simulated && !this.liveArmed;
          const noOkxCreds = !hasOkxCreds();
          const action = liveBlocked ? 'HOLD' : exit.action;
          const riskNotes = [exit.note];
          if (liveBlocked) riskNotes.push('实盘未由用户解锁 → 已拦截');
          else if (noOkxCreds) riskNotes.push('信号已通过，但未配置 OKX 交易密钥 → 未下单（仅纸面信号）');
          const riskNote = riskNotes.join(' | ');
          const decId = decisionDao.insert({
            instId: indicators.instId,
            action: exit.action,
            confidence: 1,
            sizePct: 1,
            reason: exit.note,
            provider: 'risk',
            model: 'stop-take-profit',
            indicators,
            riskAction: action,
            riskNote,
            executed: false,
            simulated: config.okx.simulated,
          });

          let trade = null;
          let executed = false;
          if (!liveBlocked && !noOkxCreds) {
            try {
              trade = await closePosition({
                position: exit.position,
                price: lastPrice,
                decisionId: decId,
                leverage: riskParams.leverage,
                reason: exit.note,
              });
              executed = Boolean(trade && trade.ok);
              if (trade) this.emit('trade', trade);
            } catch (e) {
              this.emit('error', new Error('平仓失败：' + e.message));
            }
          }
          decisionDao.updateExecution(decId, executed);

          const result = {
            decisionId: decId,
            decision: {
              action: exit.action,
              confidence: 1,
              sizePct: 1,
              reason: exit.note,
              provider: 'risk',
              model: 'stop-take-profit',
              indicators,
              ts: Date.now(),
            },
            risk: {
              action,
              allowed: !liveBlocked,
              sizeUsdt: exit.notionalUsdt,
              notes: riskNotes,
              stopLossPct: riskParams.stopLossPct,
              takeProfitPct: riskParams.takeProfitPct,
              leverage: riskParams.leverage,
              params: riskParams,
              lastPrice,
            },
            trade,
            executed,
            indicators,
            positionUsdt,
            exit: exit.type,
          };
          this.lastDecision = { ...result.decision, ts: Date.now() };
          this.emit('decision', result);
          exitResults.push(result);
        }
        this.lastError = null;
        return exitResults.length === 1 ? exitResults[0] : { exits: exitResults, indicators, positionUsdt };
      }

      // 3. decision: AI if configured, else rule-based fallback
      let decision;
      if (hasAiCreds()) {
        try {
          decision = await decide(indicators, {
            position: positions[0] ?? null,
            mode: config.okx.simulated ? 'SIMULATED' : 'LIVE',
          });
        } catch (e) {
          this.emit('error', new Error('AI 决策失败，改用内置规则：' + e.message));
          decision = ruleBasedDecide(indicators);
        }
      } else {
        decision = ruleBasedDecide(indicators);
      }

      // 4. risk gate
      const risk = applyRisk(decision, {
        lastPrice,
        positionUsdt,
        live: !config.okx.simulated,
        liveArmed: this.liveArmed,
      });
      if (risk.allowed && !hasOkxCreds()) {
        risk.notes.push('信号已通过，但未配置 OKX 交易密钥 → 未下单（仅纸面信号）');
      }

      // 5. persist decision, then execute if allowed and creds present
      const decId = decisionDao.insert({
        instId: indicators.instId,
        action: decision.action,
        confidence: decision.confidence,
        sizePct: decision.sizePct,
        reason: decision.reason,
        provider: decision.provider,
        model: decision.model,
        indicators,
        riskAction: risk.action,
        riskNote: risk.notes.join(' | '),
        executed: false,
        simulated: config.okx.simulated,
      });

      let trade = null;
      let executed = false;
      if (risk.allowed && hasOkxCreds()) {
        try {
          trade = await executeOrder({
            action: risk.action,
            sizeUsdt: risk.sizeUsdt,
            price: lastPrice,
            decisionId: decId,
            leverage: risk.leverage,
            instId: indicators.instId,
          });
          executed = Boolean(trade && trade.ok);
          if (trade) this.emit('trade', trade);
        } catch (e) {
          this.emit('error', new Error('下单失败：' + e.message));
        }
      }

      decisionDao.updateExecution(decId, executed);

      const result = {
        decisionId: decId,
        decision,
        risk,
        trade,
        executed,
        indicators,
        positionUsdt,
      };
      this.lastDecision = { ...decision, ts: Date.now() };
      this.lastError = null;
      this.emit('decision', result);
      return result;
    } catch (err) {
      this.lastError = err.message;
      this.emit('error', err);
      throw err;
    } finally {
      this.busy = false;
      this.emit('status', this.status());
    }
  }
}

export const engine = new Engine();
export default engine;
