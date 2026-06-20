# OKX AI Trader

> ⚠️ **免责声明 / Disclaimer**：AI 不具备稳定盈利能力。本项目是一个**技术工具与研究框架**，**不构成任何投资建议**。加密货币永续合约交易带有极高风险，可能导致本金全部损失。请务必先在 **OKX 模拟盘**充分验证，自行承担一切后果。

实时监测 OKX 指定永续合约（默认 `ETH-USDT-SWAP`），用近 100 天的日线成交量与涨跌趋势喂给 AI（GPT / Claude / 可扩展）做买卖决策，经**确定性风控护栏**后在模拟盘/实盘执行，并提供 Vue 3 可视化仪表盘。

完整目标与设计见 [GOALS.md](GOALS.md)。

## 架构

```
后端 (Node.js + Express + ws + SQLite)
  okx/      行情拉取(REST)、实时价格(WS)、指标计算
  ai/       OpenAI / Anthropic 适配器 + 统一 Provider 接口 + prompt/schema
  engine/   decision(组装→调AI) · risk(确定性护栏) · trader(下单) · scheduler(调度)
  routes/   给前端的 REST API
前端 (Vue 3 + Vite + Pinia + lightweight-charts)
  价格/成交量图 · AI 决策日志 · 持仓与成交 · 控制面板 · 风控参数
```

数据流：`日线 → 结构化指标 → AI 决策(JSON) → 风控护栏 → (模拟/实盘)下单 → 持久化 → 前端`

## 快速开始

### 1. 后端

```bash
npm install
cp .env.example .env      # 按需填写 key（不填也能跑：只读 + 规则决策）
npm start                 # http://localhost:8787
```

无任何 key 也能运行：
- 行情/指标：OKX 公共接口，**无需 key**
- AI：未配置 key 时自动回退到**内置规则决策**（趋势 + 均线 + 放量）
- 下单：未配置 OKX key 时只产出信号、**不下单**

### 2. 前端

开发模式（热更新，代理到后端）：
```bash
cd web
npm install
npm run dev               # http://localhost:5173
```

生产模式（后端直接托管打包产物）：
```bash
cd web && npm run build   # 产出 web/dist
# 回到根目录 npm start，访问 http://localhost:8787
```

## 配置 (.env)

| 变量 | 说明 | 默认 |
|---|---|---|
| `ADMIN_TOKEN` | 可选管理 token；设置后敏感 API 需带 `X-Admin-Token` | 空 |
| `INST_ID` | 交易标的 | `ETH-USDT-SWAP` |
| `KLINE_LIMIT` | 日线根数 | `100` |
| `OKX_SIMULATED` | 1=模拟盘 / 0=实盘 | `1` |
| `OKX_API_KEY/SECRET/PASSPHRASE` | OKX 交易密钥（仅交易权限，**不开提现**） | 空 |
| `AI_PROVIDER` | `openai` / `anthropic` | `openai` |
| `AI_MODEL` | 模型名 | `gpt-5.5` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | AI 密钥 | 空 |
| `OPENAI_BASE_URL` | OpenAI 兼容端点（可接其他厂商） | 官方 |
| `DECISION_INTERVAL_MS` | 决策间隔 | `3600000`（1h） |
| `ENGINE_AUTOSTART` | 启动即跑引擎 | `false` |
| `RISK_*` | 风控参数（见下） | — |

### 风控护栏（核心）

AI 建议只是输入，**最终由确定性规则决定**是否/如何执行：

| 参数 | 含义 |
|---|---|
| `RISK_MAX_ORDER_USDT` | 单笔最大下单名义 |
| `RISK_MAX_POSITION_USDT` | 总仓位上限 |
| `RISK_STOP_LOSS_PCT` / `RISK_TAKE_PROFIT_PCT` | 止损/止盈百分比（持仓触发后提交 reduce-only 平仓单） |
| `RISK_COOLDOWN_MS` | 决策冷却（防频繁交易） |
| `RISK_MIN_CONFIDENCE` | 置信度阈值，低于不执行 |
| `RISK_LEVERAGE` | 合约杠杆 |

护栏检查顺序：持仓止损/止盈 → 置信度 → 冷却 → 实盘是否解锁 → 单笔上限 → 总仓位上限 → 计算手数。任何一步不过即降级为 `HOLD`。这些参数也可在前端「风控参数」面板实时调整（持久化到 SQLite）。成交记录会关联触发它的决策 ID，方便后续审计。

## 模拟盘 / 实盘切换

1. 默认 `OKX_SIMULATED=1`（模拟盘），REST 自动带 `x-simulated-trading: 1` header。
2. 切实盘：设 `OKX_SIMULATED=0` 并填入**实盘**密钥后重启。
3. **即使在实盘模式，引擎默认也不会下单**，必须在 UI 点击「🔒 解锁实盘交易」并二次确认（后端要求 `confirm: "I_UNDERSTAND_LIVE_RISK"`）。这是双保险，防误操作。

## API 速览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/status` | 引擎状态 + 配置 + 风控 |
| GET | `/api/candles` `/decisions` `/trades` `/positions` `/balance` | 数据查询 |
| POST | `/api/engine/start` `/stop` `/decide` | 启停 / 立即决策一次 |
| POST | `/api/engine/interval` | 改决策间隔 `{intervalMs}` |
| POST | `/api/engine/arm-live` | 解锁实盘 `{armed, confirm}` |
| GET/POST | `/api/risk` | 读/改风控参数 |
| WS | `/ws` | 实时价格 + 引擎事件推送 |

## 自检脚本

```bash
node server/scripts/selftest.js   # SQLite + 指标计算（合成数据）
node server/scripts/risktest.js   # 风控护栏 + 规则决策 + JSON 解析
node server/scripts/monitor.js    # 联网拉真实行情 + 实时价格
```

## 安全要点

- API key 只放 `.env`，已被 `.gitignore` 排除；不进代码/日志/前端响应。
- 默认模拟盘；实盘需 UI 显式二次确认。
- OKX 密钥**仅授予交易权限，不开提现**。
- 决策与风控全程持久化到 SQLite（`data/trader.sqlite`），可审计。

## 交付状态与进度

更新时间：2026-06-18。

| 阶段 | 状态 | 当前进度 |
|---|---|---|
| 阶段 1：后端骨架 + OKX 行情 + SQLite | 已完成 | Express/WS 服务、OKX REST/WS 行情、K 线持久化、离线指标计算已实现。 |
| 阶段 2：AI 决策模块 + 风控护栏 | 已完成 | OpenAI/Anthropic 适配器、内置规则 fallback、结构化 JSON 解析、置信度/冷却/仓位/实盘解锁/止损止盈护栏已实现。 |
| 阶段 3：调度引擎 + 模拟盘下单 | 已完成 | 引擎周期调度、立即决策、运行时决策间隔、模拟/实盘 header、合约手数换算、成交与决策关联已实现。 |
| 阶段 4：Vue 前端仪表盘 | 已完成 | 价格/成交量图、实时价 WS、决策日志、持仓/成交、控制面板、风控参数保存已实现并可打包。 |
| 阶段 5：实盘开关 + 文档 | 已完成 | `.env` 切换实盘、UI/API 二次解锁、风险免责声明、配置说明、API 说明和当前进度记录已补齐。 |

### 已验证

- `node server/scripts/selftest.js`：SQLite、K 线指标、决策/成交 DAO、决策执行状态更新。
- `node server/scripts/risktest.js`：AI JSON 解析、规则决策、风控阈值、冷却、仓位上限、实盘解锁、止损/止盈触发。
- `npm run build`（`web/`）：Vue 3 仪表盘生产构建通过。
- `server/engine/scheduler.js`、`server/engine/trader.js`、`server/engine/risk.js`、`server/db.js` 已分别通过 `node --check` 语法检查。

### 外部依赖实测项

- OKX 公共行情与实时 WS：用 `node server/scripts/monitor.js` 验证；当前环境访问 `www.okx.com` DNS/WS 失败，脚本已改为失败时返回非 0，不再误报通过。
- OKX 模拟盘/实盘真实下单：需要配置有效 OKX 交易密钥后验证；实盘仍必须在 UI/API 二次解锁。
- OpenAI/Anthropic 实际模型调用：需要配置对应 API key 后验证；未配置时会自动使用内置规则决策。
