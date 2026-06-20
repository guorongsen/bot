import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import config from './config.js';

mkdirSync(config.dataDir, { recursive: true });
const dbPath = resolve(config.dataDir, 'trader.sqlite');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS candles (
    inst_id   TEXT NOT NULL,
    bar       TEXT NOT NULL DEFAULT '1D',
    ts        INTEGER NOT NULL,   -- open time, ms
    open      REAL NOT NULL,
    high      REAL NOT NULL,
    low       REAL NOT NULL,
    close     REAL NOT NULL,
    vol       REAL NOT NULL,      -- base ccy volume
    vol_ccy   REAL NOT NULL,      -- quote ccy volume
    PRIMARY KEY (inst_id, bar, ts)
  );

  CREATE TABLE IF NOT EXISTS decisions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           INTEGER NOT NULL,
    inst_id      TEXT NOT NULL,
    action       TEXT NOT NULL,        -- BUY | SELL | HOLD
    confidence   REAL NOT NULL,
    size_pct     REAL NOT NULL,
    reason       TEXT,
    provider     TEXT,
    model        TEXT,
    indicators   TEXT,                 -- JSON snapshot fed to AI
    risk_action  TEXT,                 -- final action after risk gate
    risk_note    TEXT,                 -- why risk altered/blocked it
    executed     INTEGER DEFAULT 0,    -- 0/1
    simulated    INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS trades (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           INTEGER NOT NULL,
    decision_id  INTEGER,
    inst_id      TEXT NOT NULL,
    side         TEXT NOT NULL,        -- buy | sell
    pos_side     TEXT,                 -- long | short | net
    ord_type     TEXT,
    size         REAL,
    px           REAL,
    notional_usdt REAL,
    ok           INTEGER DEFAULT 0,
    cl_ord_id    TEXT,
    ord_id       TEXT,
    simulated    INTEGER DEFAULT 1,
    raw          TEXT                  -- raw OKX response
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

const candleColumns = db.prepare(`PRAGMA table_info(candles)`).all().map((c) => c.name);
if (!candleColumns.includes('bar')) {
  db.exec(`
    CREATE TABLE candles_next (
      inst_id   TEXT NOT NULL,
      bar       TEXT NOT NULL DEFAULT '1D',
      ts        INTEGER NOT NULL,
      open      REAL NOT NULL,
      high      REAL NOT NULL,
      low       REAL NOT NULL,
      close     REAL NOT NULL,
      vol       REAL NOT NULL,
      vol_ccy   REAL NOT NULL,
      PRIMARY KEY (inst_id, bar, ts)
    );
    INSERT INTO candles_next (inst_id, bar, ts, open, high, low, close, vol, vol_ccy)
      SELECT inst_id, '1D', ts, open, high, low, close, vol, vol_ccy FROM candles;
    DROP TABLE candles;
    ALTER TABLE candles_next RENAME TO candles;
  `);
}

// ---------- Candles ----------
const upsertCandleStmt = db.prepare(`
  INSERT INTO candles (inst_id, bar, ts, open, high, low, close, vol, vol_ccy)
  VALUES (@inst_id, @bar, @ts, @open, @high, @low, @close, @vol, @vol_ccy)
  ON CONFLICT(inst_id, bar, ts) DO UPDATE SET
    open=excluded.open, high=excluded.high, low=excluded.low,
    close=excluded.close, vol=excluded.vol, vol_ccy=excluded.vol_ccy
`);

export const candleDao = {
  upsertMany(rows) {
    const tx = db.transaction((items) => {
      for (const r of items) upsertCandleStmt.run({ ...r, bar: r.bar || '1D' });
    });
    tx(rows);
  },
  recent(instId, limit, bar = '1D') {
    return db
      .prepare(`SELECT * FROM candles WHERE inst_id = ? AND bar = ? ORDER BY ts DESC LIMIT ?`)
      .all(instId, bar, limit)
      .reverse();
  },
};

// ---------- Decisions ----------
const insertDecisionStmt = db.prepare(`
  INSERT INTO decisions
    (ts, inst_id, action, confidence, size_pct, reason, provider, model,
     indicators, risk_action, risk_note, executed, simulated)
  VALUES
    (@ts, @inst_id, @action, @confidence, @size_pct, @reason, @provider, @model,
     @indicators, @risk_action, @risk_note, @executed, @simulated)
`);

export const decisionDao = {
  insert(d) {
    const info = insertDecisionStmt.run({
      ts: d.ts ?? Date.now(),
      inst_id: d.instId,
      action: d.action,
      confidence: d.confidence,
      size_pct: d.sizePct,
      reason: d.reason ?? '',
      provider: d.provider ?? '',
      model: d.model ?? '',
      indicators: d.indicators ? JSON.stringify(d.indicators) : null,
      risk_action: d.riskAction ?? null,
      risk_note: d.riskNote ?? null,
      executed: d.executed ? 1 : 0,
      simulated: d.simulated ? 1 : 0,
    });
    return info.lastInsertRowid;
  },
  /** 更新决策是否最终成交，保证成交记录能先拿到 decision_id。 */
  updateExecution(id, executed) {
    db.prepare(`UPDATE decisions SET executed = ? WHERE id = ?`).run(executed ? 1 : 0, id);
  },
  recent(limit = 50, instId = null) {
    if (instId) {
      return db.prepare(`SELECT * FROM decisions WHERE inst_id = ? ORDER BY ts DESC LIMIT ?`).all(instId, limit);
    }
    return db.prepare(`SELECT * FROM decisions ORDER BY ts DESC LIMIT ?`).all(limit);
  },
  lastExecuted() {
    return db
      .prepare(`SELECT * FROM decisions WHERE executed = 1 ORDER BY ts DESC LIMIT 1`)
      .get();
  },
};

// ---------- Trades ----------
const insertTradeStmt = db.prepare(`
  INSERT INTO trades
    (ts, decision_id, inst_id, side, pos_side, ord_type, size, px,
     notional_usdt, ok, cl_ord_id, ord_id, simulated, raw)
  VALUES
    (@ts, @decision_id, @inst_id, @side, @pos_side, @ord_type, @size, @px,
     @notional_usdt, @ok, @cl_ord_id, @ord_id, @simulated, @raw)
`);

export const tradeDao = {
  insert(t) {
    const info = insertTradeStmt.run({
      ts: t.ts ?? Date.now(),
      decision_id: t.decisionId ?? null,
      inst_id: t.instId,
      side: t.side,
      pos_side: t.posSide ?? null,
      ord_type: t.ordType ?? 'market',
      size: t.size ?? null,
      px: t.px ?? null,
      notional_usdt: t.notionalUsdt ?? null,
      ok: t.ok ? 1 : 0,
      cl_ord_id: t.clOrdId ?? null,
      ord_id: t.ordId ?? null,
      simulated: t.simulated ? 1 : 0,
      raw: t.raw ? JSON.stringify(t.raw) : null,
    });
    return info.lastInsertRowid;
  },
  recent(limit = 50, instId = null) {
    if (instId) {
      return db.prepare(`SELECT * FROM trades WHERE inst_id = ? ORDER BY ts DESC LIMIT ?`).all(instId, limit);
    }
    return db.prepare(`SELECT * FROM trades ORDER BY ts DESC LIMIT ?`).all(limit);
  },
};

// ---------- Settings (runtime overrides persisted across restarts) ----------
export const settingsDao = {
  get(key, fallback = null) {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  },
  set(key, value) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, JSON.stringify(value));
  },
  all() {
    const rows = db.prepare(`SELECT key, value FROM settings`).all();
    const out = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        out[r.key] = r.value;
      }
    }
    return out;
  },
};

/** 读取当前界面选择的交易标的，默认回落到配置里的主标的。 */
export function getSelectedInstId() {
  return settingsDao.get('selectedInstId', config.instId);
}

/** 保存当前界面选择的交易标的。 */
export function setSelectedInstId(instId) {
  settingsDao.set('selectedInstId', instId);
  return instId;
}

export default db;
