/**
 * pdf-kit.js — Outils de mise en page des rapports PDF (jsPDF + AutoTable, licences MIT, dans vendor/).
 * Format A4 portrait, millimètres. Les couleurs reprennent le thème clair du design system,
 * quel que soit le thème affiché à l'écran (un rapport s'imprime sur fond blanc).
 */
import { pdfText } from './report-data.js';
import { loadChartJs } from '../ui/charts.js';
import { formatMoney } from '../core/money.js';

// Valeurs du thème clair (tokens.json)
export const C = {
  ink: '#0e1116', ink2: '#525a68', ink3: '#646b78', accent: '#3d4fd6', accentSoft: '#eef0fd',
  positive: '#0f7a55', negative: '#c8323b', warning: '#a85008', border: '#e3e6eb', surface2: '#f1f3f6',
  fixed: '#5848d4', variable: '#0a7671', exceptional: '#b04e08',
};
export const CAT = {
  'cat-housing': '#4c5bd4', 'cat-utilities': '#8a6d1f', 'cat-telecom': '#0e86ad', 'cat-insurance': '#6b5b95', 'cat-transport': '#c2560a',
  'cat-groceries': '#2f8a3e', 'cat-restaurants': '#d1495b', 'cat-shopping': '#b5408f', 'cat-subscriptions': '#7a5af8', 'cat-health': '#0b7f7a',
  'cat-leisure': '#c58b00', 'cat-travel': '#2b7bd8', 'cat-car': '#57606f', 'cat-other': '#8a8f98',
};
/** Couleur imprimable d'une catégorie (nom de token ou hexadécimal personnalisé). */
export const catColor = (color) => (/^#[0-9a-f]{6}$/i.test(color ?? '') ? color : CAT[color] ?? CAT['cat-other']);

export const PAGE = { w: 210, h: 297, m: 16 };
export const money = (cents, opts) => pdfText(formatMoney(cents, opts));

let loading = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL(src, import.meta.url).href;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Impossible de charger ${src.split('/').pop()}.`));
    document.head.append(s);
  });
}

/** Charge jsPDF puis son extension AutoTable (une seule fois). */
export function loadPdfLibs() {
  loading ??= (async () => {
    if (!window.jspdf) await loadScript('../../vendor/jspdf.umd.min.js');
    if (!window.jspdf.jsPDF.API.autoTable) await loadScript('../../vendor/jspdf.plugin.autotable.min.js');
    return window.jspdf.jsPDF;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** Petit wrapper autour d'un document jsPDF avec un curseur vertical. */
export class Report {
  constructor(jsPDF, { title, subtitle }) {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    this.doc.setProperties({ title: pdfText(title), subject: pdfText(subtitle), creator: 'Mes finances — Personal Finance Manager' });
    this.title = title;
    this.subtitle = subtitle;
    this.y = PAGE.m;
    this.header();
  }

  font(size, style = 'normal', color = C.ink) {
    this.doc.setFont('helvetica', style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...rgb(color));
  }

  header() {
    const d = this.doc;
    d.setFillColor(...rgb(C.accent));
    d.rect(0, 0, PAGE.w, 4, 'F');
    this.font(9, 'bold', C.accent);
    d.text('MES FINANCES', PAGE.m, 14);
    this.font(20, 'bold');
    d.text(pdfText(this.title), PAGE.m, 24);
    this.font(10, 'normal', C.ink2);
    d.text(pdfText(this.subtitle), PAGE.m, 30.5);
    d.setDrawColor(...rgb(C.border));
    d.setLineWidth(0.3);
    d.line(PAGE.m, 35, PAGE.w - PAGE.m, 35);
    this.y = 43;
  }

  /** Passe à la page suivante si la hauteur demandée ne tient pas. */
  ensure(height) {
    if (this.y + height > PAGE.h - 20) { this.doc.addPage(); this.y = PAGE.m + 4; }
  }

  /** Titre de section ; `keepWith` réserve la place du contenu qui suit (pas de titre orphelin en bas de page). */
  section(text, { keepWith = 40 } = {}) {
    this.ensure(10 + keepWith);
    this.font(12.5, 'bold');
    this.doc.text(pdfText(text), PAGE.m, this.y);
    this.y += 6;
  }

  paragraph(lines, { size = 10, color = C.ink2, gap = 1.6 } = {}) {
    this.font(size, 'normal', color);
    for (const line of [].concat(lines)) {
      const wrapped = this.doc.splitTextToSize(pdfText(line), PAGE.w - 2 * PAGE.m);
      this.ensure(wrapped.length * size * 0.42 + gap);
      this.doc.text(wrapped, PAGE.m, this.y);
      this.y += wrapped.length * size * 0.42 + gap;
    }
    this.y += 2;
  }

  /** Rangée de cartes indicateurs : [{ label, value, sub, color }] */
  kpis(items, { perRow = 4 } = {}) {
    const gap = 3;
    const w = (PAGE.w - 2 * PAGE.m - gap * (perRow - 1)) / perRow;
    const h = 21;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(h + 3);
      items.slice(i, i + perRow).forEach((it, k) => {
        const x = PAGE.m + k * (w + gap);
        this.doc.setFillColor(...rgb(C.surface2));
        this.doc.roundedRect(x, this.y, w, h, 2, 2, 'F');
        if (it.swatch) { this.doc.setFillColor(...rgb(it.swatch)); this.doc.rect(x + 3.5, this.y + 3.6, 2, 2, 'F'); }
        this.font(7, 'bold', C.ink2);
        this.doc.text(pdfText(it.label.toUpperCase()), x + (it.swatch ? 7 : 3.5), this.y + 5.5);
        this.font(12.5, 'bold', it.color ?? C.ink);
        this.doc.text(pdfText(it.value), x + 3.5, this.y + 12.8);
        if (it.sub) { this.font(7.5, 'normal', it.subColor ?? C.ink3); this.doc.text(pdfText(it.sub), x + 3.5, this.y + 18); }
      });
      this.y += h + 3;
    }
    this.y += 3;
  }

  /**
   * Tableau AutoTable. `columns` : [{ header, align, width }] ; `rows` : tableaux de cellules
   * (texte ou { content, styles }). `foot` facultatif.
   */
  table(columns, rows, { foot, accentCol, fontSize = 8.5 } = {}) {
    this.ensure(18);
    const conv = (c) => (c && typeof c === 'object' && 'content' in c ? { ...c, content: pdfText(c.content) } : pdfText(c));
    this.doc.autoTable({
      startY: this.y,
      margin: { left: PAGE.m, right: PAGE.m, top: PAGE.m + 4, bottom: 20 },
      head: [columns.map((c) => pdfText(c.header))],
      body: rows.map((r) => r.map(conv)),
      foot: foot ? [foot.map(conv)] : undefined,
      showFoot: 'lastPage',
      theme: 'plain',
      styles: { font: 'helvetica', fontSize, textColor: rgb(C.ink), cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, lineColor: rgb(C.border), overflow: 'linebreak' },
      headStyles: { fontStyle: 'bold', textColor: rgb(C.ink2), fontSize: fontSize - 1, fillColor: rgb(C.surface2) },
      footStyles: { fontStyle: 'bold', textColor: rgb(C.ink), fillColor: rgb(C.accentSoft) },
      bodyStyles: { lineWidth: { bottom: 0.15 } },
      columnStyles: Object.fromEntries(columns.map((c, i) => [i, { halign: c.align ?? 'left', cellWidth: c.width ?? 'auto', fontStyle: i === accentCol ? 'bold' : 'normal' }])),
      didParseCell: (data) => { if (data.section !== 'body' && columns[data.column.index]?.align) data.cell.styles.halign = columns[data.column.index].align; },
    });
    this.y = this.doc.lastAutoTable.finalY + 7;
  }

  image(dataUrl, { width = PAGE.w - 2 * PAGE.m, height, x = PAGE.m } = {}) {
    if (!dataUrl) return;
    this.ensure(height + 4);
    this.doc.addImage(dataUrl, 'PNG', x, this.y, width, height, undefined, 'FAST');
    this.y += height + 5;
  }

  /** Légende colorée sous un graphique : [{ label, color }] */
  legend(items) {
    this.ensure(8);
    let x = PAGE.m;
    this.font(8, 'normal', C.ink2);
    for (const it of items) {
      const label = pdfText(it.label);
      const w = this.doc.getTextWidth(label) + 9;
      if (x + w > PAGE.w - PAGE.m) { x = PAGE.m; this.y += 5; }
      this.doc.setFillColor(...rgb(it.color));
      this.doc.rect(x, this.y - 2.4, 2.6, 2.6, 'F');
      this.doc.text(label, x + 4, this.y);
      x += w;
    }
    this.y += 7;
  }

  /** Pied de page sur toutes les pages, puis téléchargement. */
  save(filename) {
    const total = this.doc.getNumberOfPages();
    const now = new Date();
    const stamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    for (let i = 1; i <= total; i += 1) {
      this.doc.setPage(i);
      this.doc.setDrawColor(...rgb(C.border));
      this.doc.line(PAGE.m, PAGE.h - 13, PAGE.w - PAGE.m, PAGE.h - 13);
      this.font(7.5, 'normal', C.ink3);
      this.doc.text(pdfText(`${this.title} · ${this.subtitle} · Généré le ${stamp} · Données saisies par l'utilisateur`), PAGE.m, PAGE.h - 8.5);
      this.doc.text(`Page ${i} / ${total}`, PAGE.w - PAGE.m, PAGE.h - 8.5, { align: 'right' });
    }
    this.doc.save(filename);
    return this.doc;
  }
}

/**
 * Dessine un graphique Chart.js hors écran (taille fixe, sans animation, couleurs d'impression)
 * et renvoie une image PNG en data URL.
 */
export async function chartImage(config, { width = 900, height = 420 } = {}) {
  const Chart = await loadChartJs();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = 'position:fixed;left:-10000px;top:0;';
  document.body.append(canvas);
  const font = { family: 'Helvetica, Arial, sans-serif', size: 20 };
  const chart = new Chart(canvas, {
    ...config,
    options: {
      responsive: false, animation: false, devicePixelRatio: 1,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      ...config.options,
      scales: config.type === 'doughnut' ? {} : {
        x: { grid: { display: false }, ticks: { color: C.ink2, font }, ...(config.options?.scales?.x ?? {}) },
        y: { grid: { color: C.border }, border: { display: false }, ticks: { color: C.ink2, font, maxTicksLimit: 6, callback: (v) => money(Math.round(v) * 100, { compact: true }) }, ...(config.options?.scales?.y ?? {}) },
      },
    },
  });
  // Fond blanc (le PNG serait transparent sinon)
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  const url = canvas.toDataURL('image/png');
  chart.destroy();
  canvas.remove();
  return url;
}
