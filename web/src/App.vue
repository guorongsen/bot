<script setup>
import { onBeforeUnmount, onMounted, computed } from 'vue';
import { useTraderStore } from './store/trader.js';
import Dashboard from './views/Dashboard.vue';
import InstrumentSwitch from './components/InstrumentSwitch.vue';
import { displayMessageText, feedStatusText, modelText, providerText } from './i18n.js';

const store = useTraderStore();
const timers = [];

onMounted(async () => {
  store.connectWs();
  try {
    await store.refreshAll();
  } catch (e) {
    store.errors.unshift({ ts: Date.now(), message: e.message });
  }
  timers.push(setInterval(() => store.fetchTicker().catch(() => {}), 10000));
  timers.push(setInterval(() => store.fetchCandles().catch(() => {}), 60000));
});

onBeforeUnmount(() => {
  for (const timer of timers) clearInterval(timer);
  store.disconnectWs();
});

const modeBadge = computed(() =>
  store.isLive ? { cls: 'red', text: '实盘交易' } : { cls: 'blue', text: '模拟盘' }
);
const okxBadge = computed(() =>
  store.feedStatus === 'open' || store.livePrice
    ? { cls: 'green', text: 'OKX 行情正常' }
    : { cls: 'amber', text: `OKX ${feedStatusText(store.feedStatus)}` }
);
</script>

<template>
  <div class="app">
    <div class="topbar">
      <div class="brand">
        <h1>🤖 OKX AI 交易助手</h1>
        <span class="badge" :class="modeBadge.cls">{{ modeBadge.text }}</span>
        <span class="badge" :class="store.wsConnected ? 'green' : 'amber'">
          <span class="dot"></span>{{ store.wsConnected ? '页面通道已连接' : '页面通道连接中' }}
        </span>
        <span class="badge" :class="okxBadge.cls">
          <span class="dot"></span>{{ okxBadge.text }}
        </span>
      </div>
      <div class="row">
        <InstrumentSwitch />
        <span class="badge">{{ providerText(store.config.aiProvider) }}/{{ modelText(store.config.aiModel) }}</span>
      </div>
    </div>

    <Dashboard />

    <div v-if="store.errors.length" class="panel" style="margin-top: 16px; border-color: var(--red)">
      <h2>错误日志</h2>
      <div v-for="(e, i) in store.errors" :key="i" class="muted" style="font-size: 12px">
        {{ new Date(e.ts).toLocaleTimeString('zh-CN') }} — {{ displayMessageText(e.message, '未知错误') }}
      </div>
    </div>
  </div>
</template>
