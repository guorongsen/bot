import crypto from 'node:crypto';
import config from '../config.js';

/**
 * OKX v5 REST client.
 *
 * - Public/market endpoints work without credentials.
 * - Private endpoints (account/trade) require API key + secret + passphrase
 *   and are signed per OKX spec (OK-ACCESS-SIGN = base64(hmacSHA256(secret,
 *   timestamp + method + requestPath + body))).
 * - When config.okx.simulated is true, sends `x-simulated-trading: 1`.
 */

function isoTimestamp() {
  // OKX expects ISO format like 2020-12-08T09:08:57.715Z
  return new Date().toISOString();
}

function sign(timestamp, method, requestPath, body, secret) {
  const prehash = timestamp + method.toUpperCase() + requestPath + body;
  return crypto.createHmac('sha256', secret).update(prehash).digest('base64');
}

async function request(method, requestPath, { params, body, signed } = {}) {
  let path = requestPath;
  if (params && Object.keys(params).length) {
    const qs = new URLSearchParams(params).toString();
    path += (path.includes('?') ? '&' : '?') + qs;
  }

  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = { 'Content-Type': 'application/json' };

  if (signed) {
    if (!config.okx.apiKey || !config.okx.apiSecret || !config.okx.passphrase) {
      throw new Error('缺少 OKX 交易密钥，无法访问签名接口：' + requestPath);
    }
    if (config.okx.simulated) headers['x-simulated-trading'] = '1';
    const ts = isoTimestamp();
    headers['OK-ACCESS-KEY'] = config.okx.apiKey;
    headers['OK-ACCESS-SIGN'] = sign(ts, method, path, bodyStr, config.okx.apiSecret);
    headers['OK-ACCESS-TIMESTAMP'] = ts;
    headers['OK-ACCESS-PASSPHRASE'] = config.okx.passphrase;
  }

  const url = config.okx.restBase + path;
  const res = await fetch(url, {
    method,
    headers,
    body: bodyStr || undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OKX 返回了非 JSON 响应（${res.status}）：${text.slice(0, 200)}`);
  }

  // OKX wraps everything as { code, msg, data }
  if (json.code && json.code !== '0') {
    const detail = Array.isArray(json.data) && json.data[0] ? JSON.stringify(json.data[0]) : '';
    throw new Error(`OKX 错误 ${json.code}：${json.msg} ${detail}`.trim());
  }
  return json;
}

export const okxRest = {
  // ---------- Public / market ----------

  /**
   * Candles. OKX returns newest-first arrays:
   * [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
   */
  async candles(instId, { bar = '1D', limit = 100 } = {}) {
    const json = await request('GET', '/api/v5/market/candles', {
      params: { instId, bar, limit: String(limit) },
    });
    return json.data.map((row) => ({
      inst_id: instId,
      bar,
      ts: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      vol: Number(row[5]),
      vol_ccy: Number(row[6]),
    }));
  },

  async ticker(instId) {
    const json = await request('GET', '/api/v5/market/ticker', { params: { instId } });
    return json.data[0];
  },

  async instrument(instId, instType = 'SWAP') {
    const json = await request('GET', '/api/v5/public/instruments', {
      params: { instType, instId },
    });
    return json.data[0];
  },

  // ---------- Private / account & trade (signed) ----------

  async balance(ccy = 'USDT') {
    const json = await request('GET', '/api/v5/account/balance', {
      params: { ccy },
      signed: true,
    });
    return json.data[0];
  },

  async positions(instId) {
    const json = await request('GET', '/api/v5/account/positions', {
      params: instId ? { instId } : { instType: 'SWAP' },
      signed: true,
    });
    return json.data;
  },

  async setLeverage(instId, lever, mgnMode = 'isolated', posSide) {
    const body = { instId, lever: String(lever), mgnMode };
    if (posSide) body.posSide = posSide;
    const json = await request('POST', '/api/v5/account/set-leverage', {
      body,
      signed: true,
    });
    return json.data;
  },

  /**
   * Place an order. For SWAP, `sz` is in contracts.
   * side: buy|sell, ordType: market|limit, tdMode: isolated|cross|cash
   */
  async placeOrder(order) {
    const json = await request('POST', '/api/v5/trade/order', {
      body: order,
      signed: true,
    });
    return json.data[0];
  },
};

export default okxRest;
