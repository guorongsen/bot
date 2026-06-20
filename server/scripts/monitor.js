/**
 * Stage 1 smoke test — read-only monitoring.
 * Pulls daily candles from OKX (no API key needed), persists to SQLite,
 * computes indicators, and prints them. Then streams live price for ~15s.
 *
 * Run: npm run monitor
 */
import config from '../config.js';
import { configureProxy } from '../net.js';
import { getMarketSnapshot } from '../okx/market.js';
import OkxPriceFeed from '../okx/ws.js';

configureProxy();

/** 等待实时行情首条价格，用于确认 OKX WS 真的可用。 */
function waitForFirstPrice(feed, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      feed.off('price', onPrice);
      reject(new Error(`${timeoutMs / 1000} 秒内未收到实时价格`));
    }, timeoutMs);
    const onPrice = (price) => {
      clearTimeout(timer);
      feed.off('price', onPrice);
      resolve(price);
    };
    feed.on('price', onPrice);
  });
}

async function main() {
  console.log(`\n=== OKX AI 交易助手 — 只读监控 ===`);
  console.log(`合约：${config.instId}`);
  console.log(`模式：${config.okx.simulated ? '模拟盘' : '实盘'}（行情数据始终为公开数据）\n`);

  console.log('正在拉取日线 K 线并计算指标...');
  const { candles, indicators, stale } = await getMarketSnapshot();
  if (stale) {
    throw new Error('OKX REST 刷新失败，仅使用缓存 K 线');
  }
  console.log(`已保存 ${candles.length} 根 K 线。最新指标：\n`);
  console.table(indicators);

  console.log('\n正在订阅实时价格（15 秒）...');
  const feed = new OkxPriceFeed(config.instId);
  feed.on('status', (s) => console.log(`[ws] ${s}`));
  feed.on('price', (p) =>
    console.log(`[price] ${p.instId} = ${p.last} @ ${new Date(p.ts).toISOString()}`)
  );
  feed.start();

  try {
    await waitForFirstPrice(feed);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.log('\n完成。只读监控运行正常。\n');
  } finally {
    feed.stop();
  }
}

main().catch((err) => {
  console.error('\n监控失败：', err.message);
  process.exit(1);
});
