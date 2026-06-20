# OKX AI Trader — 项目目标与路线图

> ⚠️ **免责声明**：AI 不具备稳定盈利能力。本项目是一个**技术工具**，不构成任何投资建议。加密合约交易风险极高，可能导致本金全部损失。请务必先在**模拟盘**充分验证。

## 项目目标

一个 Node.js 应用，实时监测 OKX 指定永续合约（默认 `ETH-USDT-SWAP`），用近 100 天的日线成交量与涨跌趋势喂给 AI（GPT / Claude / 可扩展）做买卖决策，经**确定性风控护栏**后在模拟盘/实盘（可切换）执行，并提供 Vue 3 可视化界面。

## 技术栈

- **后端**：Node.js + Express + WebSocket(ws)，SQLite(better-sqlite3)
- **OKX**：REST（行情/下单/账户）+ WebSocket（实时价格），模拟盘走 `x-simulated-trading: 1` header
- **AI**：统一 Provider 接口，内置 OpenAI、Anthropic 适配器，可扩展（OpenAI 兼容端点）
- **前端**：Vue 3 + Vite + Pinia + 轻量图表(lightweight-charts)

## 目录结构

```
okx-ai-trader/
├── server/
│   ├── index.js              # Express + WS 启动
│   ├── config.js             # 配置加载 (.env)
│   ├── db.js                 # SQLite 初始化与 DAO
│   ├── okx/
│   │   ├── rest.js           # REST 客户端(签名、模拟/实盘 header)
│   │   ├── ws.js             # WebSocket 行情订阅
│   │   └── market.js         # 拉取 100 天日线、算成交量/趋势指标
│   ├── ai/
│   │   ├── index.js          # Provider 工厂
│   │   ├── openai.js         # GPT 适配器
│   │   ├── anthropic.js      # Claude 适配器
│   │   └── prompt.js         # 决策 prompt + 结构化 JSON schema
│   ├── engine/
│   │   ├── scheduler.js      # 可配置间隔调度
│   │   ├── decision.js       # 组装指标→调AI→得建议
│   │   └── risk.js           # 风控护栏(核心)
│   └── routes/api.js         # REST API 给前端
├── web/                      # Vue 3 + Vite 前端
│   └── src/
│       ├── views/Dashboard.vue
│       ├── components/{PriceChart,DecisionLog,Positions,Controls,Settings}.vue
│       └── store/
├── .env.example
└── README.md
```

## 核心逻辑

### 1. 数据与指标 (market.js)
拉取 100 根日线，计算：每日成交量及其移动均值/放量倍数、连续涨跌天数、涨跌幅、短/长均线关系、近期趋势方向。把这些**结构化指标**（而非原始数字）喂给 AI，效果更好也省 token。

### 2. AI 决策 (decision.js + prompt.js)
强制 AI 返回结构化 JSON：`{ action: BUY|SELL|HOLD, confidence: 0-1, sizePct, reason }`。多模型通过统一接口切换。

### 3. 风控护栏 (risk.js，标准级别)
AI 建议只是输入，最终由**确定性规则**决定：
- 单笔最大金额 + 总仓位上限
- 强制止损 / 止盈百分比
- 决策冷却时间（防频繁交易）
- 置信度阈值（低于阈值不执行）
- 实盘模式额外二次校验

### 4. 模拟/实盘开关
默认模拟盘。切换实盘需要在 UI 显式确认（防误操作），后端根据开关注入对应 OKX header 和 API key。

### 5. 前端
仪表盘展示：实时价格图、100天成交量/趋势、AI 决策日志（含理由与置信度）、当前持仓与盈亏、成交记录、控制面板（启停引擎、调间隔、切模拟/实盘、风控参数）。

## 安全要点
- API key 只放 `.env`，绝不进代码/日志/前端，`.gitignore` 排除
- 默认模拟盘，实盘需显式确认
- 提现权限不开；密钥仅交易权限
- UI 和 README 明确标注：AI 不具备稳定盈利能力，这是工具不是投资建议

## 交付分阶段

- [x] **阶段 1**：后端骨架 + OKX 行情拉取 + SQLite（可跑通"只读监测"）
- [x] **阶段 2**：AI 决策模块 + 风控护栏
- [x] **阶段 3**：调度引擎 + 模拟盘下单
- [x] **阶段 4**：Vue 前端仪表盘
- [x] **阶段 5**：实盘开关 + 文档

> 先把 1-3 跑通验证，再做前端。需要 OKX API key（模拟盘）和至少一个 AI 模型的 key 才能实测；代码骨架不需要 key 也能搭好。
