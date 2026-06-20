import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  return String(v).toLowerCase() === 'true' || String(v) === '1';
}

export const config = {
  port: num(process.env.PORT, 8787),
  adminToken: process.env.ADMIN_TOKEN || '',
  rootDir: resolve(__dirname, '..'),
  dataDir: process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(__dirname, '..', 'data'),

  instId: process.env.INST_ID || 'ETH-USDT-SWAP',
  instOptions: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'TRUMP-USDT-SWAP'],
  klineLimit: num(process.env.KLINE_LIMIT, 100),

  okx: {
    simulated: bool(process.env.OKX_SIMULATED, true),
    apiKey: process.env.OKX_API_KEY || '',
    apiSecret: process.env.OKX_API_SECRET || '',
    passphrase: process.env.OKX_API_PASSPHRASE || '',
    restBase: process.env.OKX_REST_BASE || 'https://www.okx.com',
    wsPublic: 'wss://ws.okx.com:8443/ws/v5/public',
  },

  ai: {
    provider: (process.env.AI_PROVIDER || 'openai').toLowerCase(),
    model: process.env.AI_MODEL || 'gpt-5.5',
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    },
  },

  engine: {
    decisionIntervalMs: num(process.env.DECISION_INTERVAL_MS, 3600000),
    autostart: bool(process.env.ENGINE_AUTOSTART, false),
  },

  risk: {
    maxOrderUsdt: num(process.env.RISK_MAX_ORDER_USDT, 100),
    maxPositionUsdt: num(process.env.RISK_MAX_POSITION_USDT, 500),
    stopLossPct: num(process.env.RISK_STOP_LOSS_PCT, 0.05),
    takeProfitPct: num(process.env.RISK_TAKE_PROFIT_PCT, 0.1),
    cooldownMs: num(process.env.RISK_COOLDOWN_MS, 1800000),
    minConfidence: num(process.env.RISK_MIN_CONFIDENCE, 0.6),
    leverage: num(process.env.RISK_LEVERAGE, 3),
  },
};

/** Whether OKX trading creds are present (market data works without them). */
export function hasOkxCreds() {
  return Boolean(config.okx.apiKey && config.okx.apiSecret && config.okx.passphrase);
}

/** Whether the configured AI provider has a usable key. */
export function hasAiCreds() {
  if (config.ai.provider === 'openai') return Boolean(config.ai.openai.apiKey);
  if (config.ai.provider === 'anthropic') return Boolean(config.ai.anthropic.apiKey);
  return false;
}

export default config;
