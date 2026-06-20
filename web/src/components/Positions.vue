<script setup>
import { positionSideText, tradeSideText, tradeStatusText } from '../i18n.js';

defineProps({
  positions: { type: Array, default: () => [] },
  positionUsdt: { type: Number, default: 0 },
  trades: { type: Array, default: () => [] },
});

function num(v, d = 2) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : '-';
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('zh-CN');
}
</script>

<template>
  <div class="panel">
    <h2>持仓 (名义 {{ num(positionUsdt) }} USDT)</h2>
    <table v-if="positions.length">
      <thead>
        <tr><th>合约</th><th>方向</th><th>数量</th><th>开仓价</th><th>未实现盈亏</th></tr>
      </thead>
      <tbody>
        <tr v-for="(p, i) in positions" :key="i">
          <td>{{ p.instId }}</td>
          <td>{{ positionSideText(p.posSide) }}</td>
          <td>{{ p.pos }}</td>
          <td>{{ num(p.avgPx) }}</td>
          <td :class="Number(p.upl) >= 0 ? 'up' : 'down'">{{ num(p.upl) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="muted">无持仓（或未配置 OKX 密钥）。</div>

    <h2 style="margin-top: 16px">成交记录</h2>
    <table v-if="trades.length">
      <thead>
        <tr><th>时间</th><th>方向</th><th>数量</th><th>价格</th><th>名义</th><th>状态</th></tr>
      </thead>
      <tbody>
        <tr v-for="t in trades" :key="t.id">
          <td>{{ fmtTime(t.ts) }}</td>
          <td :class="t.side === 'buy' ? 'up' : 'down'">{{ tradeSideText(t.side) }}</td>
          <td>{{ t.size }}</td>
          <td>{{ num(t.px) }}</td>
          <td>{{ num(t.notional_usdt) }}</td>
          <td>
            <span class="badge" :class="t.ok ? 'green' : 'red'">{{ tradeStatusText(t.ok) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="muted">暂无成交。</div>
  </div>
</template>
