import okxRest from '../okx/rest.js';
import config, { hasOkxCreds } from '../config.js';
import { tradeDao } from '../db.js';

/**
 * Order execution layer. Converts a risk-approved decision into an OKX
 * SWAP market order. Honors simulated vs live via the REST client header.
 *
 * Contract sizing: OKX SWAP orders are in contracts. We derive contract count
 * from USDT notional / (contractValue * price). Instrument metadata (ctVal,
 * lotSz, minSz) is cached.
 */

let instMetaCache = null;

async function getInstrumentMeta(instId = config.instId) {
  if (instMetaCache && instMetaCache.instId === instId) return instMetaCache;
  const inst = await okxRest.instrument(instId, 'SWAP');
  instMetaCache = {
    instId,
    ctVal: Number(inst.ctVal),       // contract value in ctValCcy
    ctValCcy: inst.ctValCcy,         // usually base ccy (e.g. ETH)
    lotSz: Number(inst.lotSz),       // contract size step
    minSz: Number(inst.minSz),       // min contracts
    tickSz: Number(inst.tickSz),
  };
  return instMetaCache;
}

function roundToStep(value, step) {
  if (!step || step <= 0) return value;
  return Math.floor(value / step) * step;
}

/**
 * Convert USDT notional → number of contracts for a SWAP.
 * notional ≈ contracts * ctVal * price  (when ctValCcy is the base coin)
 */
export async function notionalToContracts(notionalUsdt, price, instId = config.instId) {
  const meta = await getInstrumentMeta(instId);
  const rawContracts = notionalUsdt / (meta.ctVal * price);
  let sz = roundToStep(rawContracts, meta.lotSz);
  if (sz < meta.minSz) sz = 0; // below tradable minimum
  return { sz, meta };
}

/**
 * Execute a risk-approved decision.
 * @param {object} args
 *   action 'BUY'|'SELL', sizeUsdt, price, decisionId, posSide?
 * @returns {object} trade record (also persisted)
 */
export async function executeOrder({ action, sizeUsdt, price, decisionId, posSide, leverage = config.risk.leverage, instId = config.instId }) {
  if (action !== 'BUY' && action !== 'SELL') {
    return { skipped: true, reason: '操作不是买入/卖出' };
  }
  if (!hasOkxCreds()) {
    throw new Error('需要配置 OKX 交易密钥才能下单');
  }

  const side = action === 'BUY' ? 'buy' : 'sell';
  const resolvedPosSide = posSide || (action === 'BUY' ? 'long' : 'short');
  const { sz, meta } = await notionalToContracts(sizeUsdt, price, instId);

  if (sz <= 0) {
    const rec = {
      decisionId, instId, side, posSide: resolvedPosSide,
      ordType: 'market', size: 0, px: price, notionalUsdt: sizeUsdt,
      ok: 0, simulated: config.okx.simulated, raw: { error: 'size below minSz', meta },
    };
    tradeDao.insert(rec);
    return { ...rec, skipped: true, reason: `名义金额 ${sizeUsdt} USDT 低于最小合约数量 ${meta.minSz}` };
  }

  const clOrdId = 'ai' + Date.now().toString(36);
  const order = {
    instId,
    tdMode: 'isolated',
    side,
    posSide: resolvedPosSide,
    ordType: 'market',
    sz: String(sz),
    clOrdId,
  };

  let raw, ok = false, ordId = null;
  try {
    // best-effort leverage set (ignore if already set)
    try {
      await okxRest.setLeverage(instId, leverage, 'isolated', resolvedPosSide);
    } catch {}
    raw = await okxRest.placeOrder(order);
    ok = raw?.sCode === '0';
    ordId = raw?.ordId ?? null;
  } catch (err) {
    raw = { error: err.message };
  }

  const rec = {
    decisionId, instId, side, posSide: resolvedPosSide,
    ordType: 'market', size: sz, px: price, notionalUsdt: sizeUsdt,
    ok, clOrdId, ordId, simulated: config.okx.simulated, raw,
  };
  const id = tradeDao.insert(rec);
  return { id, ...rec };
}

/** 用当前 OKX 持仓数量提交 reduce-only 市价平仓单。 */
export async function closePosition({ position, price, decisionId, leverage = config.risk.leverage, reason = '' }) {
  if (!hasOkxCreds()) {
    throw new Error('需要配置 OKX 交易密钥才能平仓');
  }

  const instId = position.instId || config.instId;
  const pos = Number(position.pos);
  if (!Number.isFinite(pos) || pos === 0) {
    return { skipped: true, reason: '空持仓' };
  }

  const posSide = position.posSide || 'net';
  const side = posSide === 'short' || pos < 0 ? 'buy' : 'sell';
  const meta = await getInstrumentMeta(instId);
  const sz = roundToStep(Math.abs(pos), meta.lotSz);

  if (sz < meta.minSz) {
    const rec = {
      decisionId, instId, side, posSide, ordType: 'market', size: 0, px: price,
      notionalUsdt: Math.abs(Number(position.notionalUsd ?? 0)),
      ok: 0, simulated: config.okx.simulated, raw: { error: 'position size below minSz', reason, meta },
    };
    tradeDao.insert(rec);
    return { ...rec, skipped: true, reason: `持仓数量低于最小合约数量 ${meta.minSz}` };
  }

  const clOrdId = 'aiclose' + Date.now().toString(36);
  const order = {
    instId,
    tdMode: position.mgnMode || 'isolated',
    side,
    ordType: 'market',
    sz: String(sz),
    reduceOnly: 'true',
    clOrdId,
  };
  if (posSide !== 'net') order.posSide = posSide;

  let raw, ok = false, ordId = null;
  try {
    try {
      await okxRest.setLeverage(instId, leverage, order.tdMode, posSide !== 'net' ? posSide : undefined);
    } catch {}
    raw = await okxRest.placeOrder(order);
    ok = raw?.sCode === '0';
    ordId = raw?.ordId ?? null;
  } catch (err) {
    raw = { error: err.message };
  }

  const rec = {
    decisionId, instId, side, posSide, ordType: 'market', size: sz, px: price,
    notionalUsdt: Math.abs(Number(position.notionalUsd ?? sz * meta.ctVal * price)),
    ok, clOrdId, ordId, simulated: config.okx.simulated, raw: { reason, response: raw },
  };
  const id = tradeDao.insert(rec);
  return { id, ...rec };
}

/** Read current position notional (USDT) for the configured instrument. */
export async function getPositionUsdt(instId = config.instId) {
  if (!hasOkxCreds()) return { positionUsdt: 0, positions: [] };
  const positions = await okxRest.positions(instId);
  let positionUsdt = 0;
  for (const p of positions) {
    const notional = Number(p.notionalUsd ?? 0);
    if (Number.isFinite(notional)) positionUsdt += Math.abs(notional);
  }
  return { positionUsdt, positions };
}

export default { closePosition, executeOrder, getPositionUsdt, notionalToContracts };
