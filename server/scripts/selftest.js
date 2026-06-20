/**
 * Offline self-test — no network required.
 * Verifies SQLite persistence + indicator computation with synthetic candles.
 *
 * Run: node server/scripts/selftest.js
 */
import { resolve } from 'node:path';

process.env.DATA_DIR = resolve('.tmp', 'selftest-data');

const { candleDao, decisionDao, tradeDao, settingsDao } = await import('../db.js');
const { computeIndicators } = await import('../okx/market.js');
const { default: config } = await import('../config.js');

function synthCandles(n = 100) {
  const rows = [];
  const dayMs = 86400000;
  const startTs = Date.now() - n * dayMs;
  let price = 2000;
  for (let i = 0; i < n; i++) {
    // gentle uptrend + noise
    const drift = 1 + (0.002 + (Math.sin(i / 6) * 0.01));
    const open = price;
    const close = price * drift;
    const high = Math.max(open, close) * 1.01;
    const low = Math.min(open, close) * 0.99;
    const vol = 10000 + (i % 9 === 0 ? 25000 : 0) + Math.random() * 3000; // periodic spikes
    rows.push({
      inst_id: config.instId,
      ts: startTs + i * dayMs,
      open, high, low, close,
      vol,
      vol_ccy: vol * close,
    });
    price = close;
  }
  return rows;
}

function assert(cond, msg) {
  if (!cond) throw new Error('断言失败：' + msg);
}

function main() {
  console.log('\n=== 离线自检 ===\n');

  const rows = synthCandles(100);
  candleDao.upsertMany(rows);
  const stored = candleDao.recent(config.instId, 100);
  assert(stored.length === 100, `预期 100 根 K 线，实际 ${stored.length} 根`);
  assert(stored[0].ts < stored[stored.length - 1].ts, 'K 线必须按从旧到新排列');
  console.log(`✓ 数据库：已保存并读取 ${stored.length} 根 K 线（从旧到新）`);

  const ind = computeIndicators(stored);
  assert(['up', 'down', 'neutral'].includes(ind.trend), '趋势标签有效');
  assert(typeof ind.changePct1d === 'number', 'changePct1d 为数字');
  assert(ind.ma7 != null && ind.ma25 != null, '均线已计算');
  assert(ind.volSpike != null, '成交量放大倍数已计算');
  assert(ind.pricePosition >= 0 && ind.pricePosition <= 1, '价格位置在 [0,1] 内');
  console.log('✓ 指标已计算：');
  console.table(ind);

  // Decision + trade DAO round-trip
  const decId = decisionDao.insert({
    instId: config.instId, action: 'HOLD', confidence: 0.5, sizePct: 0,
    reason: '自检', provider: 'test', model: 'test', indicators: ind,
    riskAction: 'HOLD', riskNote: '无', executed: 0, simulated: 1,
  });
  assert(decId > 0, '决策已写入');
  assert(decisionDao.recent(1).length === 1, '决策可读取');
  decisionDao.updateExecution(decId, true);
  assert(decisionDao.recent(1)[0].executed === 1, '决策执行标记可更新');
  console.log(`✓ 决策 DAO 往返正常（id=${decId}）`);

  const tradeId = tradeDao.insert({
    instId: config.instId, side: 'buy', posSide: 'long', ordType: 'market',
    size: 1, px: ind.lastClose, notionalUsdt: 50, ok: 1, simulated: 1,
    decisionId: decId, raw: { test: true },
  });
  assert(tradeId > 0, '成交已写入');
  console.log(`✓ 成交 DAO 往返正常（id=${tradeId}）`);

  settingsDao.set('selftest', { ran: true });
  assert(settingsDao.get('selftest').ran === true, '设置读写往返正常');
  console.log('✓ 设置 DAO 往返正常');

  console.log('\n所有离线检查已通过。依赖网络的 OKX/AI 调用仍需要真实连通性。\n');
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error('\n' + err.message + '\n');
  process.exit(1);
}
