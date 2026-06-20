import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { HttpsProxyAgent } from 'https-proxy-agent';
import config from '../config.js';

/**
 * OKX public WebSocket — subscribes to the `tickers` channel for live price.
 * Emits `price` ({ instId, last, ts }) and `status` events. Auto-reconnects
 * with backoff and sends periodic 'ping' to keep the socket alive.
 */
export class OkxPriceFeed extends EventEmitter {
  constructor(instId = config.instId) {
    super();
    this.instId = instId;
    this.ws = null;
    this.reconnectDelay = 1000;
    this.pingTimer = null;
    this.last = null;
    this.stopped = false;
    this.proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || '';
  }

  start() {
    this.stopped = false;
    this._connect();
    return this;
  }

  /** 切换订阅的合约，并重新连接到对应 OKX 行情流。 */
  setInstId(instId) {
    if (instId === this.instId) return this.instId;
    this.instId = instId;
    this.last = null;
    if (this.ws) {
      this.stopped = true;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.stopped = false;
    this._connect();
    return this.instId;
  }

  stop() {
    this.stopped = true;
    this._clearPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  _connect() {
    this.emit('status', 'connecting');
    const options = this.proxy ? { agent: new HttpsProxyAgent(this.proxy) } : {};
    const ws = new WebSocket(config.okx.wsPublic, options);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectDelay = 1000;
      this.emit('status', 'open');
      ws.send(
        JSON.stringify({
          op: 'subscribe',
          args: [{ channel: 'tickers', instId: this.instId }],
        })
      );
      this._startPing();
    });

    ws.on('message', (raw) => {
      const text = raw.toString();
      if (text === 'pong') return;
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.event) {
        this.emit('status', msg.event === 'error' ? `error:${msg.msg}` : msg.event);
        return;
      }
      if (msg.arg?.channel === 'tickers' && Array.isArray(msg.data)) {
        const d = msg.data[0];
        const price = {
          instId: d.instId,
          last: Number(d.last),
          open24h: Number(d.open24h),
          high24h: Number(d.high24h),
          low24h: Number(d.low24h),
          ts: Number(d.ts),
        };
        this.last = price;
        this.emit('price', price);
      }
    });

    ws.on('close', () => {
      this._clearPing();
      this.emit('status', 'closed');
      if (!this.stopped) this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.emit('status', `error:${err.message}`);
      // 'close' will follow and trigger reconnect.
    });
  }

  _scheduleReconnect() {
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    setTimeout(() => {
      if (!this.stopped) this._connect();
    }, delay);
  }

  _startPing() {
    this._clearPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('ping');
    }, 25000);
  }

  _clearPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

export default OkxPriceFeed;
