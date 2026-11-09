/**
 * charts.js — Fabrique de graphiques Chart.js aux couleurs du design system.
 * - Chart.js (vendor/chart.umd.js, licence MIT) est chargé à la première utilisation.
 * - Les couleurs sont lues dans les variables CSS : les graphiques suivent le thème clair / sombre.
 * - Les montants sont fournis en centimes et affichés au format français.
 */
import { formatMoney as fm, formatPercent as fp } from '../core/money.js';

// Le texte dessiné dans un canvas n'a pas toujours le glyphe de l'espace fine insécable : espaces simples.
const plain = (str) => str.replace(/[\u202F\u00A0]/g, ' ');
const formatMoney = (...a) => plain(fm(...a));
const formatPercent = (...a) => plain(fp(...a));

let loading = null;

/** Charge Chart.js une seule fois. */
export function loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/chart.umd.js', import.meta.url).href;
    s.onload = () => resolve(window.Chart);
    s.onerror = () => { loading = null; reject(new Error('Impossible de charger la bibliothèque de graphiques.')); };
    document.head.append(s);
  });
  return loading;
}

/** Couleur calculée d'une variable CSS (« --accent » ou « var(--accent) » ou hexadécimal). */
export function cssColor(value) {
  if (!value) return '#888';
  if (value.startsWith('#') || value.startsWith('rgb')) return value;
  const name = value.replace(/^var\((--[^)]+)\)$/, '$1');
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

/** Ajoute une transparence à une couleur hexadécimale. */
export function withAlpha(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

const money = (euros) => formatMoney(Math.round(euros * 100));
const moneyCompact = (euros) => formatMoney(Math.round(euros) * 100, { compact: true });

function baseOptions() {
  const ink2 = cssColor('--ink-2');
  const ink3 = cssColor('--ink-3');
  const border = cssColor('--border');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 400 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 4 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cssColor('--ink'),
        titleColor: cssColor('--bg'),
        bodyColor: cssColor('--bg'),
        borderWidth: 0,
        padding: 10,
        cornerRadius: 8,
        boxPadding: 4,
        titleFont: { family: 'Inter', weight: '600' },
        bodyFont: { family: 'Inter' },
        callbacks: { label: (ctx) => ` ${ctx.dataset.label} : ${ctx.raw === null ? '—' : money(ctx.raw)}` },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: border }, ticks: { color: ink3, font: { family: 'Inter', size: 11 } } },
      y: {
        grid: { color: border, drawTicks: false }, border: { display: false },
        ticks: { color: ink3, font: { family: 'Inter', size: 11 }, padding: 8, maxTicksLimit: 6, callback: (v) => moneyCompact(v) },
      },
    },
    color: ink2,
  };
}

/**
 * Crée un graphique dans un conteneur, et le recrée au changement de thème.
 * @param {HTMLElement} container élément vide de hauteur fixée par CSS
 * @param {() => object} build fonction qui retourne la configuration (appelée à chaque thème)
 * @returns {{ destroy: () => void, chart: () => any, toImage: () => string }}
 */
export function mountChart(container, build) {
  let chart = null;
  let destroyed = false;
  const canvas = document.createElement('canvas');
  container.replaceChildren(canvas);
  const draw = async () => {
    const Chart = await loadChartJs();
    if (destroyed) return;
    chart?.destroy();
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    chart = new Chart(canvas, build(baseOptions()));
  };
  const onTheme = () => { requestAnimationFrame(draw); };
  window.addEventListener('pfm:theme', onTheme);
  draw().catch((err) => {
    container.replaceChildren(Object.assign(document.createElement('p'), { className: 'subtle fs-13', textContent: err.message }));
  });
  return {
    destroy() { destroyed = true; window.removeEventListener('pfm:theme', onTheme); chart?.destroy(); chart = null; },
    chart: () => chart,
    toImage: () => chart?.toBase64Image('image/png', 1) ?? null,
  };
}

/** Graphique en barres groupées revenus / dépenses (valeurs en centimes). */
export function incomeExpenseChart(container, { labels, income, expenses }) {
  return mountChart(container, (opt) => ({
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Revenus', data: income.map((c) => c / 100), backgroundColor: cssColor('--positive'), borderRadius: 5, maxBarThickness: 26, categoryPercentage: 0.7, barPercentage: 0.9 },
        { label: 'Dépenses', data: expenses.map((c) => c / 100), backgroundColor: withAlpha(cssColor('--ink-3'), 0.55), borderRadius: 5, maxBarThickness: 26, categoryPercentage: 0.7, barPercentage: 0.9 },
      ],
    },
    options: opt,
  }));
}

/** Donut de répartition (valeurs en centimes, couleurs CSS). */
export function donutChart(container, { labels, values, colors, percents, centerLabel }) {
  return mountChart(container, (opt) => ({
    type: 'doughnut',
    data: { labels, datasets: [{ data: values.map((c) => c / 100), backgroundColor: colors.map(cssColor), borderColor: cssColor('--surface'), borderWidth: 2, hoverOffset: 4 }] },
    options: {
      ...opt,
      scales: {},
      cutout: '68%',
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        ...opt.plugins,
        tooltip: { ...opt.plugins.tooltip, callbacks: { label: (ctx) => ` ${ctx.label} : ${money(ctx.raw)} (${formatPercent(percents[ctx.dataIndex])})` } },
      },
    },
    plugins: [{
      id: 'center',
      afterDraw(chart) {
        const { ctx, chartArea: a } = chart;
        if (!a) return;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = cssColor('--ink-3');
        ctx.font = '500 11px Inter, sans-serif';
        ctx.fillText(plain(centerLabel[0]), (a.left + a.right) / 2, (a.top + a.bottom) / 2 - 6);
        ctx.fillStyle = cssColor('--ink');
        ctx.font = '600 15px Inter, sans-serif';
        ctx.fillText(plain(centerLabel[1]), (a.left + a.right) / 2, (a.top + a.bottom) / 2 + 13);
        ctx.restore();
      },
    }],
  }));
}

/** Courbes (valeurs en centimes ; null = pas de donnée). */
export function lineChart(container, { labels, series }) {
  return mountChart(container, (opt) => ({
    type: 'line',
    data: {
      labels,
      datasets: series.map((s, i) => {
        const color = cssColor(s.color);
        return {
          label: s.label, data: s.values.map((c) => (c === null ? null : c / 100)),
          borderColor: color, backgroundColor: withAlpha(color, i === 0 ? 0.12 : 0), fill: i === 0 ? 'origin' : false,
          borderWidth: 2.5, tension: 0.3, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: color, spanGaps: false,
          borderDash: s.dashed ? [6, 4] : undefined,
        };
      }),
    },
    options: { ...opt, scales: { ...opt.scales, y: { ...opt.scales.y, beginAtZero: false } } },
  }));
}
