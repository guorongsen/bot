<script setup>
import { ref, watch } from 'vue';
import { useTraderStore } from '../store/trader.js';

const store = useTraderStore();
const form = ref({ ...store.risk });
const adminToken = ref(store.adminToken);
const saved = ref(false);
const tokenSaved = ref(false);

watch(() => store.risk, (r) => { form.value = { ...r }; });

async function save() {
  await store.setRisk({
    maxOrderUsdt: Number(form.value.maxOrderUsdt),
    maxPositionUsdt: Number(form.value.maxPositionUsdt),
    stopLossPct: Number(form.value.stopLossPct),
    takeProfitPct: Number(form.value.takeProfitPct),
    cooldownMs: Number(form.value.cooldownMs),
    minConfidence: Number(form.value.minConfidence),
    leverage: Number(form.value.leverage),
  });
  saved.value = true;
  setTimeout(() => (saved.value = false), 1500);
}

// 保存管理 token，供后续受保护 API 请求自动带上。
function saveToken() {
  store.setAdminToken(adminToken.value);
  tokenSaved.value = true;
  setTimeout(() => (tokenSaved.value = false), 1500);
}
</script>

<template>
  <div class="panel">
    <h2>风控参数</h2>
    <div class="field">
      <label>单笔最大金额 (USDT)</label>
      <input type="number" v-model.number="form.maxOrderUsdt" />
    </div>
    <div class="field">
      <label>总仓位上限 (USDT)</label>
      <input type="number" v-model.number="form.maxPositionUsdt" />
    </div>
    <div class="row">
      <div class="field" style="flex: 1">
        <label>止损 (%)</label>
        <input type="number" step="0.01" v-model.number="form.stopLossPct" />
      </div>
      <div class="field" style="flex: 1">
        <label>止盈 (%)</label>
        <input type="number" step="0.01" v-model.number="form.takeProfitPct" />
      </div>
    </div>
    <div class="row">
      <div class="field" style="flex: 1">
        <label>置信度阈值</label>
        <input type="number" step="0.05" min="0" max="1" v-model.number="form.minConfidence" />
      </div>
      <div class="field" style="flex: 1">
        <label>杠杆</label>
        <input type="number" min="1" v-model.number="form.leverage" />
      </div>
    </div>
    <div class="field">
      <label>决策冷却 (毫秒)</label>
      <input type="number" v-model.number="form.cooldownMs" />
    </div>
    <div class="row">
      <button class="primary" @click="save">保存风控</button>
      <span v-if="saved" class="badge green">已保存</span>
    </div>
    <p class="muted" style="font-size: 11px; margin-top: 10px">
      止损/止盈以小数表示（0.05 = 5%）。这些是确定性护栏，AI 建议必须经过它们才会执行。
    </p>
    <div class="field" style="margin-top: 12px">
      <label>管理令牌</label>
      <div class="row">
        <input type="password" v-model="adminToken" autocomplete="off" />
        <button @click="saveToken">保存</button>
        <span v-if="tokenSaved" class="badge green">已保存</span>
      </div>
    </div>
  </div>
</template>
