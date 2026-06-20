import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { configureProxy } from './net.js';
import config from './config.js';
import apiRouter from './routes/api.js';
import { engine } from './engine/scheduler.js';
import OkxPriceFeed from './okx/ws.js';
import { getSelectedInstId } from './db.js';

const proxy = configureProxy();
const app = express();
app.use(express.json());

// CORS for the Vite dev server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Token,Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', apiRouter);
app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Serve built frontend if present
const webDist = resolve(config.rootDir, 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res) => res.sendFile(resolve(webDist, 'index.html')));
}

const server = createServer(app);

// ---------- WebSocket: push live price + engine events to clients ----------
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

let latestFeedStatus = 'idle';
let latestPrice = null;

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'status', payload: engine.status(), ts: Date.now() }));
  ws.send(JSON.stringify({ type: 'feedStatus', payload: { status: latestFeedStatus }, ts: Date.now() }));
  if (latestPrice) ws.send(JSON.stringify({ type: 'price', payload: latestPrice, ts: Date.now() }));
});

// Bridge engine events → clients
engine.on('decision', (d) => broadcast('decision', d));
engine.on('trade', (t) => broadcast('trade', t));
engine.on('status', (s) => broadcast('status', s));
engine.on('tick', (t) => broadcast('tick', t));
engine.on('error', (e) => broadcast('engineError', { message: e.message }));
engine.on('instrument', ({ instId }) => {
  latestPrice = null;
  feed.setInstId(instId);
  broadcast('instrument', { instId });
});

// Live price feed → clients
const feed = new OkxPriceFeed(getSelectedInstId());
feed.on('price', (p) => {
  latestPrice = p;
  broadcast('price', p);
});
feed.on('status', (s) => {
  latestFeedStatus = s;
  broadcast('feedStatus', { status: s });
});
feed.start();

server.listen(config.port, () => {
  const instId = getSelectedInstId();
  console.log(`\nOKX AI 交易助手服务：http://localhost:${config.port}`);
  console.log(`  合约       : ${instId}`);
  console.log(`  模式       : ${config.okx.simulated ? '模拟盘' : '实盘'}`);
  console.log(`  AI         : ${config.ai.provider} / ${config.ai.model}`);
  if (proxy) console.log(`  代理       : ${proxy}`);
  console.log(`  页面通道   : ws://localhost:${config.port}/ws`);
  if (config.engine.autostart) {
    console.log('  引擎       : 已开启自动启动');
    engine.start();
  } else {
    console.log('  引擎       : 空闲（POST /api/engine/start 可启动）');
  }
  console.log('');
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n收到 ${sig}，正在关闭...`);
    engine.stop();
    feed.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  });
}
