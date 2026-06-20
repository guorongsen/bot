<script setup>
import { ref, watch } from 'vue';
import { useTraderStore } from '../store/trader.js';

const store = useTraderStore();
const intervalSec = ref(60);
const deciding = ref(false);

// 同步后端毫秒间隔到秒级输入框。
function syncIntervalSec(ms) {
  if (ms) intervalSec.value = Math.max(10, Math.round(ms / 1000));
}

watch(
  () => store.status.intervalMs,
  syncIntervalSec,
  { immediate: true }
);

async function toggleEngine() {
  if (store.isRunning) await store.stopEngine();
  else await store.startEngine();
}

async function decideNow() {
  deciding.value = true;
  try {
    await store.decideNow();
  } catch (e) {
    store.errors.unshift({ ts: Date.now(), message: e.message });
  } finally {
    deciding.value = false;
  }
}

async function applyInterval() {
  await store.setInterval(Math.max(10, intervalSec.value) * 1000);
}

async function toggleLive() {
  const arm = !store.liveArmed;
  if (arm) {
    const ok = confirm(
      '⚠️ 实盘交易将使用真实资金，可能造成亏损。\n确认要解锁实盘交易吗？'
    );
    if (!ok) return;
  }
  await store.armLive(arm);
}
</script>

<template>
  <div class="panel">
    <h2>控制面板</h2>
    <div class="row" style="margin-bottom: 12px">
      <button :class="store.isRunning ? 'danger' : 'primary'" @click="toggleEngine">
        {{ store.isRunning ? '停止引擎' : '启动引擎' }}
      </button>
      <button @click="decideNow" :disabled="deciding">
        {{ deciding ? '决策中…' : '立即决策' }}
      </button>
      <span class="spacer"></span>
      <span class="badge" :class="store.isRunning ? 'green' : 'amber'">
        <span class="dot"></span>{{ store.isRunning ? '运行中' : '已停止' }}
      </span>
    </div>

    <div class="field">
      <label>决策间隔（秒）</label>
      <div class="row">
        <input type="number" min="10" v-model.number="intervalSec" style="max-width: 120px" />
        <button @click="applyInterval">应用</button>
        <span class="muted">当前 {{ Math.round((store.status.intervalMs || 0) / 1000) }} 秒</span>
      </div>
    </div>

    <div class="field">
      <label>交易模式</label>
      <div class="row">
        <span class="badge" :class="store.isLive ? 'red' : 'blue'">
          {{ store.isLive ? '实盘交易' : '模拟盘' }}
        </span>
        <button v-if="store.isLive" :class="store.liveArmed ? 'danger' : 'ghost'" @click="toggleLive">
          {{ store.liveArmed ? '🔓 实盘已解锁（点击锁定）' : '🔒 解锁实盘交易' }}
        </button>
        <span v-else class="muted">模拟盘模式（在 .env 中切换 OKX_SIMULATED）</span>
      </div>
    </div>

    <div class="field" v-if="!store.config.hasAiCreds">
      <span class="badge amber">未配置 AI 密钥 — 使用内置规则决策</span>
    </div>
    <div class="field" v-if="!store.config.hasOkxCreds">
      <span class="badge amber">未配置 OKX 交易密钥 — 行情可用，但不会下单</span>
    </div>
    <p class="muted" style="font-size: 11px; margin-top: 10px">
      行情刷新：OKX 实时推送价格，行情概览每 10 秒轮询，K 线每 60 秒轮询；决策间隔当前 {{ Math.round((store.status.intervalMs || 0) / 1000) }} 秒。
    </p>
  </div>
</template>
