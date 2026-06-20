<script setup>
import { ref, onMounted, watch, onBeforeUnmount } from 'vue';
import { createChart } from 'lightweight-charts';

const props = defineProps({
  candles: { type: Array, default: () => [] },
  livePrice: { type: Object, default: null },
  bar: { type: String, default: '1D' },
});
const emit = defineEmits(['change-bar']);
const barOptions = [
  { value: '15m', label: '15分钟' },
  { value: '1H', label: '1小时' },
  { value: '1D', label: '1日' },
];

const chartEl = ref(null);
const volEl = ref(null);
let chart, candleSeries, volChart, volSeries;
let syncingRange = false;

function toSeconds(ms) {
  return Math.floor(ms / 1000);
}

function render() {
  if (!candleSeries) return;
  if (!props.candles.length) {
    candleSeries.setData([]);
    volSeries?.setData([]);
    return;
  }
  const liveLast = props.livePrice?.last;
  const data = props.candles.map((c, i) => {
    const close = liveLast != null && i === props.candles.length - 1 ? liveLast : c.close;
    return {
      time: toSeconds(c.ts),
      open: c.open,
      high: Math.max(c.high, close),
      low: Math.min(c.low, close),
      close,
    };
  });
  candleSeries.setData(data);

  const vols = props.candles.map((c) => ({
    time: toSeconds(c.ts),
    value: c.vol,
    color: c.close >= c.open ? 'rgba(46,160,67,0.6)' : 'rgba(218,54,51,0.6)',
  }));
  volSeries.setData(vols);
}

onMounted(() => {
  const common = {
    layout: { background: { color: 'transparent' }, textColor: '#8b949e' },
    grid: { vertLines: { color: '#1c2330' }, horzLines: { color: '#1c2330' } },
    rightPriceScale: { borderColor: '#2a3340' },
    timeScale: { borderColor: '#2a3340', timeVisible: props.bar !== '1D' },
    autoSize: true,
  };

  chart = createChart(chartEl.value, common);
  candleSeries = chart.addCandlestickSeries({
    upColor: '#2ea043', downColor: '#da3633',
    borderUpColor: '#2ea043', borderDownColor: '#da3633',
    wickUpColor: '#2ea043', wickDownColor: '#da3633',
    priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
  });

  volChart = createChart(volEl.value, { ...common, timeScale: { ...common.timeScale, visible: true } });
  volSeries = volChart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
  volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });

  // keep the two charts' time axes in sync
  chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
    if (!r || syncingRange) return;
    syncingRange = true;
    volChart.timeScale().setVisibleLogicalRange(r);
    syncingRange = false;
  });
  volChart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
    if (!r || syncingRange) return;
    syncingRange = true;
    chart.timeScale().setVisibleLogicalRange(r);
    syncingRange = false;
  });

  render();
});

watch(() => props.candles, render);

watch(() => props.bar, () => {
  const timeVisible = props.bar !== '1D';
  chart?.applyOptions({ timeScale: { timeVisible } });
  volChart?.applyOptions({ timeScale: { timeVisible, visible: true } });
});

watch(() => props.livePrice, (p) => {
  if (!p || !candleSeries || !props.candles.length) return;
  const last = props.candles[props.candles.length - 1];
  candleSeries.update({
    time: toSeconds(last.ts),
    open: last.open,
    high: Math.max(last.high, p.last),
    low: Math.min(last.low, p.last),
    close: p.last,
  });
});

onBeforeUnmount(() => {
  chart?.remove();
  volChart?.remove();
});
</script>

<template>
  <div class="panel">
    <div class="chart-header">
      <h2>价格 / 成交量 ({{ candles.length }} 根)</h2>
      <div class="segmented compact">
        <button
          v-for="option in barOptions"
          :key="option.value"
          :class="{ active: bar === option.value }"
          @click="emit('change-bar', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
    <div ref="chartEl" class="chart"></div>
    <div ref="volEl" class="vol-chart"></div>
  </div>
</template>
