<script setup>
import { computed } from 'vue';
import { INST_LABELS, useTraderStore } from '../store/trader.js';

const store = useTraderStore();
const options = computed(() => store.config.instOptions || Object.keys(INST_LABELS));

/** 切换当前监控合约，并把错误显示在页面日志。 */
async function select(instId) {
  try {
    await store.switchInstrument(instId);
  } catch (e) {
    store.errors.unshift({ ts: Date.now(), message: e.message });
  }
}
</script>

<template>
  <div class="segmented" aria-label="币种切换">
    <button
      v-for="instId in options"
      :key="instId"
      :class="{ active: store.config.instId === instId }"
      :disabled="store.isRunning || store.status.busy"
      @click="select(instId)"
    >
      {{ INST_LABELS[instId] || instId }}
    </button>
  </div>
</template>
