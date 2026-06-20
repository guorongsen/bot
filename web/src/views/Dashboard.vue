<script setup>
import { computed } from 'vue';
import { useTraderStore } from '../store/trader.js';
import PriceChart from '../components/PriceChart.vue';
import DecisionLog from '../components/DecisionLog.vue';
import Positions from '../components/Positions.vue';
import Controls from '../components/Controls.vue';
import Settings from '../components/Settings.vue';
import { decisionActionText } from '../i18n.js';

const store = useTraderStore();

const lastClose = computed(() => {
  const c = store.candles;
  return c.length ? c[c.length - 1].close : null;
});
const livePx = computed(() => store.livePrice?.last ?? store.ticker?.last ?? store.lastKnownPrice ?? lastClose.value);
const change1d = computed(() => {
  const t = store.livePrice || store.ticker;
  if (t?.last && t?.open24h) return (t.last - t.open24h) / t.open24h;
  const c = store.candles;
  if (c.length < 2) return null;
  const prev = c[c.length - 2].close;
  return (c[c.length - 1].close - prev) / prev;
});

function fmt(v, d = 2) {
  return v == null ? '-' : Number(v).toFixed(d);
}
function pct(v) {
  return v == null ? '-' : (v * 100).toFixed(2) + '%';
}
</script>

<template>
  <div class="kpis" style="margin-bottom: 16px">
    <div class="kpi">
      <div class="label">{{ store.config.instId || 'ETH-USDT-SWAP' }} 实时价</div>
      <div class="value">{{ fmt(livePx, 4) }}</div>
    </div>
    <div class="kpi">
      <div class="label">24h 涨跌</div>
      <div class="value" :class="change1d >= 0 ? 'up' : 'down'">{{ pct(change1d) }}</div>
    </div>
    <div class="kpi">
      <div class="label">持仓名义 (USDT)</div>
      <div class="value">{{ fmt(store.positionUsdt, 2) }}</div>
    </div>
    <div class="kpi">
      <div class="label">最近决策</div>
      <div class="value" :class="'action-' + (store.lastDecision?.action || 'HOLD')">
        {{ decisionActionText(store.lastDecision?.action) }}
      </div>
    </div>
  </div>

  <div class="grid">
    <div class="col">
      <PriceChart
        :candles="store.candles"
        :live-price="store.livePrice"
        :bar="store.chartBar"
        @change-bar="store.setChartBar"
      />
      <DecisionLog :decisions="store.decisions" />
    </div>
    <div class="col">
      <Controls />
      <Positions
        :positions="store.positions"
        :position-usdt="store.positionUsdt"
        :trades="store.trades"
      />
      <Settings />
    </div>
  </div>
</template>
