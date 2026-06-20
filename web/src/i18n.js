const ACTION_LABELS = {
  BUY: '买入',
  SELL: '卖出',
  HOLD: '观望',
};

const TRADE_SIDE_LABELS = {
  buy: '买入',
  sell: '卖出',
};

const POSITION_SIDE_LABELS = {
  long: '多头',
  short: '空头',
  net: '净持仓',
};

const PROVIDER_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  'rule-based': '内置规则',
  risk: '风控',
};

const MODEL_LABELS = {
  builtin: '内置模型',
  'stop-take-profit': '止损/止盈',
};

const FEED_STATUS_LABELS = {
  idle: '未连接',
  connecting: '连接中',
  open: '行情正常',
  closed: '已断开',
  subscribe: '订阅中',
};

const MESSAGE_REPLACEMENTS = [
  [/uptrend \+ golden cross/g, '上涨趋势 + 均线金叉'],
  [/downtrend \+ dead cross/g, '下跌趋势 + 均线死叉'],
  [/volume expansion/g, '成交量放大'],
  [/mixed signals/g, '信号混合，暂不行动'],
  [/price near range high \(caution\)/g, '价格接近区间高位，谨慎'],
  [/confidence ([\d.]+) < threshold ([\d.]+) → HOLD/g, '置信度 $1 低于阈值 $2 → 观望'],
  [/cooldown active, (\d+)s remaining → HOLD/g, '冷却中，剩余 $1 秒 → 观望'],
  [/LIVE mode not armed by user → blocked/g, '实盘未由用户解锁 → 已拦截'],
  [/approved but no OKX creds → not executed \(paper signal only\)/g, '信号已通过，但未配置 OKX 交易密钥 → 未下单（仅纸面信号）'],
  [/order capped to maxOrderUsdt ([\d.]+)/g, '单笔金额超过上限，已按 $1 USDT 限制'],
  [/position cap ([\d.]+) → order trimmed to ([\d.]+) USDT/g, '总仓位上限 $1 USDT → 订单缩减至 $2 USDT'],
  [/computed size <= 0 → HOLD/g, '计算仓位小于等于 0 → 观望'],
  [/stop loss triggered \(([-\d.]+%)\)/g, '触发止损（$1）'],
  [/take profit triggered \(([-\d.]+%)\)/g, '触发止盈（$1）'],
  [/AI decide failed, using rule-based:/g, 'AI 决策失败，改用内置规则：'],
  [/market data is stale; skipping decision/g, '行情数据已过期，跳过本次决策'],
  [/position query failed; skipping decision:/g, '持仓查询失败，跳过本次决策：'],
  [/order execution failed:/g, '下单失败：'],
  [/position exit failed:/g, '平仓失败：'],
  [/action is not BUY\/SELL/g, '操作不是买入/卖出'],
  [/OKX credentials required to place orders/g, '需要配置 OKX 交易密钥才能下单'],
  [/OKX credentials required to close positions/g, '需要配置 OKX 交易密钥才能平仓'],
  [/size ([\d.]+) USDT below min contract ([\d.]+)/g, '名义金额 $1 USDT 低于最小合约数量 $2'],
  [/position size below min contract ([\d.]+)/g, '持仓数量低于最小合约数量 $1'],
  [/empty position/g, '空持仓'],
  [/admin token required/g, '需要管理令牌'],
  [/unsupported instId/g, '不支持的合约'],
  [/stop engine before switching instrument/g, '切换合约前请先停止引擎'],
  [/no OKX creds/g, '未配置 OKX 交易密钥'],
  [/intervalMs must be >= 10000/g, '决策间隔必须不少于 10 秒'],
  [/live arming requires confirm: "I_UNDERSTAND_LIVE_RISK"/g, '解锁实盘交易需要确认参数："I_UNDERSTAND_LIVE_RISK"'],
  [/OKX credentials missing — required for signed endpoint/g, '缺少 OKX 交易密钥，无法访问签名接口'],
  [/OKX non-JSON response/g, 'OKX 返回了非 JSON 响应'],
  [/OKX error/g, 'OKX 错误'],
  [/AI provider "([^"]+)" has no API key configured/g, 'AI 提供方 "$1" 未配置 API key'],
  [/Unknown AI provider:/g, '未知 AI 提供方：'],
  [/empty AI response/g, 'AI 返回为空'],
  [/no JSON object in AI response:/g, 'AI 返回中没有 JSON 对象：'],
  [/AI returned non-object/g, 'AI 返回的不是对象'],
  [/OPENAI_API_KEY missing/g, '缺少 OPENAI_API_KEY'],
  [/ANTHROPIC_API_KEY missing/g, '缺少 ANTHROPIC_API_KEY'],
  [/OpenAI (\d+):/g, 'OpenAI 请求失败 $1：'],
  [/Anthropic (\d+):/g, 'Anthropic 请求失败 $1：'],
  [/\bn\/a\b/g, '无'],
];

// 将交易决策枚举转换为中文展示文案。
export function decisionActionText(action) {
  return ACTION_LABELS[action] || action || '—';
}

// 将成交方向转换为中文展示文案。
export function tradeSideText(side) {
  return TRADE_SIDE_LABELS[side] || side || '—';
}

// 将持仓方向转换为中文展示文案。
export function positionSideText(side) {
  return POSITION_SIDE_LABELS[side] || side || '—';
}

// 将成交状态转换为中文展示文案。
export function tradeStatusText(ok) {
  return ok ? '成功' : '失败';
}

// 将行情连接状态转换为中文展示文案。
export function feedStatusText(status) {
  const value = String(status || 'idle');
  if (value.startsWith('error:')) return `行情异常：${displayMessageText(value.slice(6), '未知错误')}`;
  return FEED_STATUS_LABELS[value] || value;
}

// 将 AI/规则提供方转换为中文展示文案。
export function providerText(provider) {
  return PROVIDER_LABELS[provider] || provider || '未知来源';
}

// 将模型名称转换为中文展示文案。
export function modelText(model) {
  return MODEL_LABELS[model] || model || '未知模型';
}

// 将日志、错误和旧数据里的英文短语尽量转换为中文展示。
export function displayMessageText(text, emptyText = '-') {
  const source = String(text ?? '').trim();
  if (!source) return emptyText;

  let result = source;
  for (const [pattern, replacement] of MESSAGE_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result
    .replace(/\bBUY\b/g, ACTION_LABELS.BUY)
    .replace(/\bSELL\b/g, ACTION_LABELS.SELL)
    .replace(/\bHOLD\b/g, ACTION_LABELS.HOLD);
}
