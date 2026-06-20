import { defineStore } from 'pinia';

const API = '/api';
const PRICE_RENDER_INTERVAL_MS = 500;
const CHART_BAR_MS = { '15m': 15 * 60 * 1000, '1H': 60 * 60 * 1000 };
let wsClient = null;
let reconnectTimer = null;
let queuedPrice = null;
let priceTimer = null;
let lastPriceRenderAt = 0;

export const INST_LABELS = {
  'BTC-USDT-SWAP': 'BTC',
  'ETH-USDT-SWAP': 'ETH',
  'TRUMP-USDT-SWAP': 'TRUMP',
};

// 读取本地保存的管理 token，用于访问受保护的 API。
function adminHeaders() {
  const token = localStorage.getItem('adminToken') || '';
  return token ? { 'X-Admin-Token': token } : {};
}

async function get(path) {
  const res = await fetch(API + path, { headers: adminHeaders() });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${path} -> ${res.status}`);
  return json;
}

// 应用排队中的最新行情，避免高频 tick 连续触发界面重绘。
function flushQueuedPrice(store) {
  if (!queuedPrice) return;
  store.livePrice = queuedPrice;
  store.ticker = queuedPrice;
  store.lastKnownPrice = queuedPrice.last;
  ensureLiveChartCandle(store, queuedPrice);
  queuedPrice = null;
  priceTimer = null;
  lastPriceRenderAt = Date.now();
}

// 将 WebSocket 行情合并成固定节奏更新，降低价格和图表闪烁。
function queuePrice(store, price) {
  queuedPrice = price;
  const wait = PRICE_RENDER_INTERVAL_MS - (Date.now() - lastPriceRenderAt);
  if (wait <= 0) {
    if (priceTimer) clearTimeout(priceTimer);
    flushQueuedPrice(store);
    return;
  }
  if (!priceTimer) priceTimer = setTimeout(() => flushQueuedPrice(store), wait);
}

// 用最新价为分钟/小时图补一根当前周期 K 线，避免无历史数据时空图。
function ensureLiveChartCandle(store, price) {
  const barMs = CHART_BAR_MS[store.chartBar];
  if (!barMs || !price?.last) return;
  const ts = Math.floor((price.ts || Date.now()) / barMs) * barMs;
  const last = store.candles[store.candles.length - 1];
  if (last && last.ts >= ts) return;
  const candle = {
    inst_id: price.instId || store.config.instId,
    bar: store.chartBar,
    ts,
    open: price.last,
    high: price.last,
    low: price.last,
    close: price.last,
    vol: 0,
    vol_ccy: 0,
  };
  store.candles = [...store.candles, candle].slice(-100);
}

export const useTraderStore = defineStore('trader', {
  state: () => ({
    status: {},
    config: {},
    risk: {},
    candles: [],
    chartBar: '1D',
    ticker: null,
    lastKnownPrice: null,
    decisions: [],
    trades: [],
    positions: [],
    positionUsdt: 0,
    livePrice: null,
    feedStatus: 'idle',
    wsConnected: false,
    errors: [],
    adminToken: localStorage.getItem('adminToken') || '',
  }),

  getters: {
    isRunning: (s) => Boolean(s.status.running),
    isLive: (s) => Boolean(s.status.live),
    liveArmed: (s) => Boolean(s.status.liveArmed),
    lastDecision: (s) => s.decisions[0] || null,
  },

  actions: {
    async refreshAll() {
      await Promise.all([
        this.fetchStatus(),
        this.fetchTicker(),
        this.fetchCandles(),
        this.fetchDecisions(),
        this.fetchTrades(),
        this.fetchPositions(),
      ]);
    },
    async fetchStatus() {
      const r = await get('/status');
      this.status = r.status;
      this.config = r.config;
      this.risk = r.risk;
    },
    async fetchCandles(bar = this.chartBar, apply = true) {
      const candles = await get(`/candles?bar=${encodeURIComponent(bar)}`);
      if (candles.length && apply) {
        this.candles = candles;
        this.lastKnownPrice = candles[candles.length - 1].close;
      }
      return candles;
    },
    async fetchTicker() {
      const r = await get('/ticker');
      if (r.last != null) {
        const ticker = { ...r, ts: r.stale ? Date.now() : r.ts };
        this.ticker = ticker;
        this.lastKnownPrice = r.last;
        ensureLiveChartCandle(this, ticker);
      }
    },
    async fetchDecisions() {
      this.decisions = await get('/decisions?limit=50');
    },
    async fetchTrades() {
      this.trades = await get('/trades?limit=50');
    },
    async fetchPositions() {
      const r = await get('/positions');
      this.positions = r.positions || [];
      this.positionUsdt = r.positionUsdt || 0;
    },

    async startEngine() { this.status = await post('/engine/start'); },
    async stopEngine() { this.status = await post('/engine/stop'); },
    async decideNow() {
      const r = await post('/engine/decide');
      await Promise.all([this.fetchDecisions(), this.fetchTrades(), this.fetchPositions()]);
      return r;
    },
    async setInterval(ms) {
      await post('/engine/interval', { intervalMs: ms });
      await this.fetchStatus();
    },
    async setRisk(partial) {
      this.risk = await post('/risk', partial);
    },
    // 保存管理 token 到浏览器本地，后续 API 请求会自动携带。
    setAdminToken(token) {
      this.adminToken = String(token || '').trim();
      if (this.adminToken) localStorage.setItem('adminToken', this.adminToken);
      else localStorage.removeItem('adminToken');
    },
    // 切换图表 K 线粒度，并重新拉取对应周期的数据。
    async setChartBar(bar) {
      if (bar === this.chartBar) return;
      const candles = await this.fetchCandles(bar, false);
      if (!candles.length) {
        const price = this.livePrice || this.ticker || (this.lastKnownPrice
          ? { instId: this.config.instId, last: this.lastKnownPrice, ts: Date.now() }
          : null);
        this.chartBar = bar;
        this.candles = [];
        ensureLiveChartCandle(this, price);
        this.errors.unshift({ ts: Date.now(), message: `${bar} K线暂无数据，请检查 OKX REST 网络/代理` });
        this.errors = this.errors.slice(0, 20);
        return;
      }
      this.chartBar = bar;
      this.candles = candles;
      this.lastKnownPrice = candles[candles.length - 1].close;
    },
    async armLive(armed) {
      await post('/engine/arm-live', {
        armed,
        confirm: armed ? 'I_UNDERSTAND_LIVE_RISK' : undefined,
      });
      await this.fetchStatus();
    },
    async switchInstrument(instId) {
      if (instId === this.config.instId) return;
      const r = await post('/inst', { instId });
      this.config = { ...this.config, instId: r.instId, instOptions: r.instOptions || this.config.instOptions };
      this.livePrice = null;
      this.ticker = null;
      this.lastKnownPrice = null;
      if (priceTimer) clearTimeout(priceTimer);
      priceTimer = null;
      queuedPrice = null;
      this.feedStatus = 'connecting';
      this.candles = [];
      this.decisions = [];
      this.trades = [];
      this.positions = [];
      this.positionUsdt = 0;
      await Promise.all([
        this.fetchStatus(),
        this.fetchTicker(),
        this.fetchCandles(),
        this.fetchDecisions(),
        this.fetchTrades(),
        this.fetchPositions(),
      ]);
    },

    connectWs() {
      if (wsClient && [WebSocket.CONNECTING, WebSocket.OPEN].includes(wsClient.readyState)) return;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsClient = ws;
      ws.onopen = () => { this.wsConnected = true; };
      ws.onclose = () => {
        if (wsClient === ws) wsClient = null;
        this.wsConnected = false;
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            this.connectWs();
          }, 2000);
        }
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this.handleWs(msg);
      };
    },

    // 关闭页面行情连接，防止热更新或页面卸载后留下重复连接。
    disconnectWs() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (priceTimer) {
        clearTimeout(priceTimer);
        flushQueuedPrice(this);
      }
      if (wsClient) {
        const ws = wsClient;
        wsClient = null;
        ws.onclose = null;
        ws.close();
      }
      this.wsConnected = false;
    },

    handleWs(msg) {
      switch (msg.type) {
        case 'price':
          if (this.config.instId && msg.payload.instId && msg.payload.instId !== this.config.instId) return;
          queuePrice(this, msg.payload);
          break;
        case 'status':
          this.status = { ...this.status, ...msg.payload };
          if (msg.payload.instId) this.config = { ...this.config, instId: msg.payload.instId };
          break;
        case 'feedStatus':
          this.feedStatus = msg.payload.status;
          break;
        case 'instrument':
          this.config = { ...this.config, instId: msg.payload.instId };
          this.livePrice = null;
          this.ticker = null;
          this.lastKnownPrice = null;
          if (priceTimer) clearTimeout(priceTimer);
          priceTimer = null;
          queuedPrice = null;
          this.feedStatus = 'connecting';
          break;
        case 'decision':
          this.fetchDecisions();
          this.fetchPositions();
          break;
        case 'trade':
          this.fetchTrades();
          this.fetchPositions();
          break;
        case 'engineError':
          this.errors.unshift({ ts: Date.now(), message: msg.payload.message });
          this.errors = this.errors.slice(0, 20);
          break;
      }
    },
  },
});
