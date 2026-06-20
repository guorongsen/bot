<script setup>
import { decisionActionText, displayMessageText, modelText, providerText } from '../i18n.js';

defineProps({ decisions: { type: Array, default: () => [] } });

function fmtTime(ts) {
  return new Date(ts).toLocaleString('zh-CN');
}
function pct(v) {
  return (v * 100).toFixed(0) + '%';
}
</script>

<template>
  <div class="panel">
    <h2>AI 决策日志</h2>
    <div class="log">
      <div v-if="!decisions.length" class="muted">暂无决策。点击「立即决策」或启动引擎。</div>
      <div v-for="d in decisions" :key="d.id" class="log-item">
        <div class="row">
          <span :class="'action-' + d.action">{{ decisionActionText(d.action) }}</span>
          <span class="badge" :class="d.confidence >= 0.6 ? 'green' : 'amber'">
            置信 {{ pct(d.confidence) }}
          </span>
          <span class="badge blue" v-if="d.size_pct > 0">仓位 {{ pct(d.size_pct) }}</span>
          <span class="spacer"></span>
          <span class="muted">{{ providerText(d.provider) }}/{{ modelText(d.model) }}</span>
        </div>
        <div style="margin-top: 4px">{{ displayMessageText(d.reason, '暂无理由') }}</div>
        <div class="row" style="margin-top: 4px" v-if="d.risk_action !== d.action || d.risk_note">
          <span class="badge amber">风控 → {{ decisionActionText(d.risk_action) }}</span>
          <span class="muted" v-if="d.risk_note">{{ displayMessageText(d.risk_note) }}</span>
        </div>
        <div class="muted" style="margin-top: 4px; font-size: 11px">
          {{ fmtTime(d.ts) }}
          <span v-if="d.executed"> · 已执行</span>
          <span v-else> · 未执行</span>
          <span v-if="d.simulated"> · 模拟盘</span>
          <span v-else class="down"> · 实盘</span>
        </div>
      </div>
    </div>
  </div>
</template>
