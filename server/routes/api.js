import { Router } from 'express';
import config, { hasOkxCreds, hasAiCreds } from '../config.js';
import { candleDao, decisionDao, tradeDao } from '../db.js';
import { getSelectedInstId, setSelectedInstId } from '../db.js';
import { getRiskParams, setRiskParams } from '../engine/risk.js';
import { engine } from '../engine/scheduler.js';
import okxRest from '../okx/rest.js';
import { refreshCandles, getSupportedInstIds } from '../okx/market.js';
import { getPositionUsdt } from '../engine/trader.js';

const router = Router();
const CANDLE_BARS = ['15m', '1H', '1D'];
const PUBLIC_GETS = new Set(['/status', '/candles', '/ticker', '/inst']);

// 校验管理接口 token，避免外部请求直接修改交易状态或读取敏感账户数据。
function requireAdminToken(req, res, next) {
  if (!config.adminToken) return next();
  if (req.method === 'GET' && PUBLIC_GETS.has(req.path)) return next();
  const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const token = req.get('x-admin-token') || bearer;
  if (token === config.adminToken) return next();
  return res.status(401).json({ error: '需要管理令牌' });
}

router.use(requireAdminToken);

router.get('/status', (req, res) => {
  const instId = getSelectedInstId();
  res.json({
    ok: true,
    status: engine.status(),
    risk: getRiskParams(),
    config: {
      instId,
      instOptions: getSupportedInstIds(),
      klineLimit: config.klineLimit,
      simulated: config.okx.simulated,
      aiProvider: config.ai.provider,
      aiModel: config.ai.model,
      hasOkxCreds: hasOkxCreds(),
      hasAiCreds: hasAiCreds(),
    },
  });
});

router.get('/candles', async (req, res) => {
  const limit = Number(req.query.limit) || config.klineLimit;
  const instId = req.query.instId || getSelectedInstId();
  const bar = CANDLE_BARS.includes(req.query.bar) ? req.query.bar : '1D';
  try {
    res.json(await refreshCandles(instId, limit, bar));
  } catch (e) {
    res.json(candleDao.recent(instId, limit, bar));
  }
});

router.get('/ticker', async (req, res) => {
  const instId = req.query.instId || getSelectedInstId();
  try {
    const t = await okxRest.ticker(instId);
    res.json({
      instId: t.instId,
      last: Number(t.last),
      open24h: Number(t.open24h),
      high24h: Number(t.high24h),
      low24h: Number(t.low24h),
      ts: Number(t.ts),
    });
  } catch (e) {
    const cached = candleDao.recent(instId, 1, '1D')[0];
    if (!cached) return res.status(200).json({ error: e.message });
    res.status(200).json({
      instId,
      last: cached.close,
      open24h: null,
      high24h: null,
      low24h: null,
      ts: cached.ts,
      stale: true,
      error: e.message,
    });
  }
});

router.get('/inst', (req, res) => {
  res.json({ instId: getSelectedInstId(), instOptions: getSupportedInstIds() });
});

router.post('/inst', (req, res) => {
  const instId = String(req.body?.instId || '');
  if (!getSupportedInstIds().includes(instId)) {
    return res.status(400).json({ error: '不支持的合约' });
  }
  if (engine.running || engine.busy) {
    return res.status(409).json({ error: '切换合约前请先停止引擎' });
  }
  setSelectedInstId(instId);
  engine.emit('instrument', { instId });
  engine.emit('status', engine.status());
  res.json({ instId, instOptions: getSupportedInstIds() });
});

router.get('/decisions', (req, res) => {
  const limit = Number(req.query.limit) || 50;
  res.json(decisionDao.recent(limit, getSelectedInstId()));
});

router.get('/trades', (req, res) => {
  const limit = Number(req.query.limit) || 50;
  res.json(tradeDao.recent(limit, getSelectedInstId()));
});

router.get('/positions', async (req, res) => {
  try {
    const data = await getPositionUsdt(getSelectedInstId());
    res.json(data);
  } catch (e) {
    res.status(200).json({ positionUsdt: 0, positions: [], error: e.message });
  }
});

router.get('/balance', async (req, res) => {
  if (!hasOkxCreds()) return res.json({ error: '未配置 OKX 交易密钥', details: null });
  try {
    res.json(await okxRest.balance('USDT'));
  } catch (e) {
    res.status(200).json({ error: e.message });
  }
});

// ---------- Engine control ----------
router.post('/engine/start', (req, res) => res.json(engine.start()));
router.post('/engine/stop', (req, res) => res.json(engine.stop()));

router.post('/engine/decide', async (req, res) => {
  try {
    const result = await engine.runOnce();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/engine/interval', (req, res) => {
  const ms = Number(req.body?.intervalMs);
  if (!Number.isFinite(ms) || ms < 10000) {
    return res.status(400).json({ error: '决策间隔必须不少于 10 秒' });
  }
  res.json({ intervalMs: engine.setInterval(ms) });
});

// Arming live trading — requires explicit confirm flag
router.post('/engine/arm-live', (req, res) => {
  const { armed, confirm } = req.body || {};
  if (armed && confirm !== 'I_UNDERSTAND_LIVE_RISK') {
    return res.status(400).json({
      error: '解锁实盘交易需要确认参数："I_UNDERSTAND_LIVE_RISK"',
    });
  }
  res.json({ liveArmed: engine.setLiveArmed(Boolean(armed)) });
});

// ---------- Risk params ----------
router.get('/risk', (req, res) => res.json(getRiskParams()));
router.post('/risk', (req, res) => {
  const allowed = [
    'maxOrderUsdt', 'maxPositionUsdt', 'stopLossPct', 'takeProfitPct',
    'cooldownMs', 'minConfidence', 'leverage',
  ];
  const partial = {};
  for (const k of allowed) {
    if (req.body?.[k] !== undefined) {
      const v = Number(req.body[k]);
      if (Number.isFinite(v)) partial[k] = v;
    }
  }
  res.json(setRiskParams(partial));
});

export default router;
