import okxRest from './rest.js';
import { candleDao } from '../db.js';
import config from '../config.js';

/** Simple moving average over the last `period` values ending at index `i`. */
function sma(values, i, period) {
  if (i + 1 < period) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) sum += values[k];
  return sum / period;
}

/**
 * Fetch latest candles from OKX, persist them, and return the recent window.
 */
export async function refreshCandles(instId = config.instId, limit = config.klineLimit, bar = '1D') {
  const fresh = await okxRest.candles(instId, { bar, limit });
  candleDao.upsertMany(fresh);
  return candleDao.recent(instId, limit, bar);
}

/**
 * Compute structured indicators from oldest-first candles. We feed these
 * (not raw OHLCV) to the AI: cheaper on tokens and more decision-relevant.
 */
export function computeIndicators(candles) {
  if (!candles || candles.length < 20) {
    throw new Error(`Not enough candles for indicators (have ${candles?.length ?? 0}, need >= 20)`);
  }

  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.vol);
  const n = candles.length;
  const last = candles[n - 1];
  const prev = candles[n - 2];

  // --- Returns / change ---
  const changePct1d = (last.close - prev.close) / prev.close;
  const change7d =
    n >= 8 ? (last.close - candles[n - 8].close) / candles[n - 8].close : null;
  const change30d =
    n >= 31 ? (last.close - candles[n - 31].close) / candles[n - 31].close : null;

  // --- Consecutive up/down streak ---
  let streak = 0;
  for (let i = n - 1; i > 0; i--) {
    const up = candles[i].close >= candles[i - 1].close;
    if (i === n - 1) {
      streak = up ? 1 : -1;
    } else {
      const sameDir = up === (streak > 0);
      if (sameDir) streak += up ? 1 : -1;
      else break;
    }
  }

  // --- Moving averages (close) ---
  const ma7 = sma(closes, n - 1, 7);
  const ma25 = sma(closes, n - 1, 25);
  const ma99 = sma(closes, n - 1, Math.min(99, n));

  // --- Volume: current vs average, volume spike multiple ---
  const volAvg20 = sma(vols, n - 1, 20);
  const volAvg7 = sma(vols, n - 1, 7);
  const volSpike = volAvg20 ? last.vol / volAvg20 : null;

  // --- Volatility: stdev of daily returns over last 20 ---
  let volatility20 = null;
  if (n >= 21) {
    const rets = [];
    for (let i = n - 20; i < n; i++) rets.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    volatility20 = Math.sqrt(variance);
  }

  // --- 52d-ish high/low position (use available window) ---
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  const pricePosition = high > low ? (last.close - low) / (high - low) : null;

  // --- Trend label from MA structure + slope ---
  let trend = 'neutral';
  if (ma7 != null && ma25 != null) {
    if (ma7 > ma25 && last.close > ma7) trend = 'up';
    else if (ma7 < ma25 && last.close < ma7) trend = 'down';
  }

  const round = (v, d = 4) => (v == null ? null : Number(v.toFixed(d)));

  return {
    instId: last.inst_id,
    asOf: last.ts,
    window: n,
    lastClose: last.close,
    changePct1d: round(changePct1d),
    change7d: round(change7d),
    change30d: round(change30d),
    consecutiveStreak: streak, // +N up days / -N down days
    ma7: round(ma7, 2),
    ma25: round(ma25, 2),
    ma99: round(ma99, 2),
    maCross: ma7 != null && ma25 != null ? (ma7 > ma25 ? 'golden' : 'dead') : null,
    lastVol: round(last.vol, 2),
    volAvg7: round(volAvg7, 2),
    volAvg20: round(volAvg20, 2),
    volSpike: round(volSpike, 2), // >1.5 ~ notable volume expansion
    volatility20: round(volatility20),
    high,
    low,
    pricePosition: round(pricePosition), // 0=at low, 1=at high
    trend,
  };
}

/**
 * Convenience: refresh + compute in one call. If the network refresh fails
 * (e.g. offline), fall back to candles already persisted in SQLite so the
 * pipeline can still run on the last known data.
 */
export async function getMarketSnapshot(instId = config.instId, limit = config.klineLimit) {
  let candles;
  let stale = false;
  try {
    candles = await refreshCandles(instId, limit);
  } catch (err) {
    candles = candleDao.recent(instId, limit, '1D');
    stale = true;
    if (!candles.length) {
      throw new Error(`candle refresh failed and no cached candles: ${err.message}`);
    }
  }
  const indicators = computeIndicators(candles);
  indicators.stale = stale;
  return { candles, indicators, stale };
}

/** 获取当前支持的交易标的列表。 */
export function getSupportedInstIds() {
  return config.instOptions;
}

export default { refreshCandles, computeIndicators, getMarketSnapshot };
