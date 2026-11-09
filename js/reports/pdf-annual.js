/**
 * pdf-annual.js — Rapport annuel : synthèse de l'année, résumé rédigé, graphiques (revenus vs dépenses,
 * patrimoine), tableau des 12 mois avec totaux et moyennes, catégories de l'année, mois les plus dépensiers,
 * objectifs d'épargne.
 */
import { Report, loadPdfLibs, chartImage, money, C, catColor } from './pdf-kit.js';
import { formatPercent } from '../core/money.js';
import { formatMonth, monthName, formatDate } from '../core/dates.js';
import { pdfText } from './report-data.js';
import { capital } from './pdf-monthly.js';

const pct = (v) => pdfText(formatPercent(v));

export async function generateAnnualPdf(r, categoriesById) {
  const jsPDF = await loadPdfLibs();
  const t = r.totals;
  const rep = new Report(jsPDF, { title: 'Bilan financier annuel', subtitle: `Année ${r.year}` });
  const name = (id) => categoriesById.get(id)?.name ?? 'Catégorie supprimée';
  const n = r.active.length;

  rep.kpis([
    { label: 'Revenus de l\'année', value: money(t.income), sub: n ? `${money(Math.round(t.income / n), { compact: true })} / mois en moyenne` : null, color: C.positive },
    { label: 'Dépenses de l\'année', value: money(t.expenses), sub: n ? `${money(Math.round(t.expenses / n), { compact: true })} / mois en moyenne` : null },
    { label: 'Excédent cumulé', value: money(t.surplus, { sign: t.surplus ? 'always' : 'auto' }), color: t.surplus < 0 ? C.negative : C.ink },
    { label: 'Taux d\'épargne moyen', value: pct(r.avgRate), sub: 'Pondéré par les revenus' },
    { label: 'Dépenses fixes', value: money(t.fixed), swatch: C.fixed },
    { label: 'Dépenses variables', value: money(t.variable), swatch: C.variable },
    { label: 'Exceptionnelles', value: money(t.exceptional), swatch: C.exceptional },
    { label: 'Épargne réalisée', value: money(t.saved), sub: t.interest ? `+ ${money(t.interest)} d'intérêts` : null },
    { label: r.wealthStartLabel ? 'Patrimoine début de suivi' : 'Patrimoine au 1er janvier', value: r.wealthStart === null ? '-' : money(r.wealthStart), sub: r.wealthStartLabel ? `Fin ${r.wealthStartLabel}` : null },
    { label: r.wealthEndLabel ? 'Patrimoine actuel' : 'Patrimoine au 31 décembre', value: r.wealthEnd === null ? '-' : money(r.wealthEnd), sub: r.wealthEndLabel ? `Fin ${r.wealthEndLabel}` : null },
    { label: 'Évolution du patrimoine', value: r.wealthStart !== null && r.wealthEnd !== null ? money(r.wealthEnd - r.wealthStart, { sign: 'always' }) : '-' },
    { label: 'Mois avec opérations', value: `${n} / 12` },
  ]);

  rep.section('Résumé de l\'année');
  rep.paragraph(r.summary, { color: C.ink });

  // ---------- Graphiques ----------
  const labels = r.rows.map((x) => capital(monthName(x.month, { short: true })));
  const bars = await chartImage({
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Revenus', data: r.rows.map((x) => x.income / 100), backgroundColor: C.positive, borderRadius: 6, maxBarThickness: 34 },
      { label: 'Dépenses', data: r.rows.map((x) => x.expenses / 100), backgroundColor: '#a7adb7', borderRadius: 6, maxBarThickness: 34 },
    ] },
  }, { width: 1100, height: 420 });
  rep.section('Revenus et dépenses par mois', { keepWith: 72 });
  rep.image(bars, { height: 64 });
  rep.legend([{ label: 'Revenus', color: C.positive }, { label: 'Dépenses', color: '#a7adb7' }]);

  if (r.rows.some((x) => x.wealth !== null)) {
    const line = await chartImage({
      type: 'line',
      data: { labels, datasets: [
        { label: 'Patrimoine', data: r.rows.map((x) => (x.wealth === null ? null : x.wealth / 100)), borderColor: C.accent, backgroundColor: C.accent, borderWidth: 4, pointRadius: 5, tension: 0.3 },
        { label: 'Épargne totale', data: r.rows.map((x) => (x.savings === null ? null : x.savings / 100)), borderColor: C.positive, backgroundColor: C.positive, borderWidth: 4, pointRadius: 5, tension: 0.3 },
      ] },
      options: { scales: { y: { beginAtZero: false } } },
    }, { width: 1100, height: 380 });
    rep.section('Évolution du patrimoine', { keepWith: 66 });
    rep.image(line, { height: 58 });
    rep.legend([{ label: 'Patrimoine (compte courant + épargne)', color: C.accent }, { label: 'Épargne totale', color: C.positive }]);
  }

  // ---------- Tableau des 12 mois ----------
  rep.section('Synthèse mois par mois');
  const c = (v) => (v ? money(v) : '-');
  rep.table(
    [{ header: 'Mois', width: 22 }, { header: 'Revenus', align: 'right' }, { header: 'Fixes', align: 'right' }, { header: 'Variables', align: 'right' }, { header: 'Except.', align: 'right' },
      { header: 'Dépenses', align: 'right' }, { header: 'Épargne', align: 'right' }, { header: 'Solde fin', align: 'right' }, { header: 'Taux', align: 'right', width: 14 }],
    r.rows.map((x) => [capital(monthName(x.month)), c(x.income), c(x.fixed), c(x.variable), c(x.exceptional), c(x.expenses), c(x.saved), x.balance === null ? '-' : money(x.balance), pct(x.savingsRate)]),
    { foot: ['Total', money(t.income), money(t.fixed), money(t.variable), money(t.exceptional), money(t.expenses), money(t.saved), '', pct(r.avgRate)], fontSize: 7.5, accentCol: 5 },
  );
  if (r.averages) {
    rep.paragraph(`Moyennes mensuelles (sur ${n} mois avec opérations) : revenus ${money(r.averages.income)}, dépenses ${money(r.averages.expenses)} dont ${money(r.averages.fixed)} fixes, ${money(r.averages.variable)} variables et ${money(r.averages.exceptional)} exceptionnelles ; épargne réalisée ${money(r.averages.saved)}.`, { size: 9 });
  }

  // ---------- Catégories ----------
  if (r.byCategory.length) {
    rep.section('Dépenses de l\'année par catégorie');
    rep.table(
      [{ header: 'Catégorie' }, { header: 'Opérations', align: 'right', width: 24 }, { header: 'Montant', align: 'right', width: 32 }, { header: 'Par mois', align: 'right', width: 28 }, { header: 'Part', align: 'right', width: 18 }],
      r.byCategory.map((x) => [{ content: name(x.categoryId), styles: { textColor: hex(catColor(categoriesById.get(x.categoryId)?.color)) } }, String(x.count), money(x.totalCents), n ? money(Math.round(x.totalCents / n)) : '-', pct(x.percent)]),
      { foot: ['Total', '', money(t.expenses), n ? money(Math.round(t.expenses / n)) : '-', '100,0 %'] },
    );
  }

  if (r.topMonths.length) {
    rep.section('Mois les plus dépensiers');
    rep.table(
      [{ header: 'Rang', width: 14 }, { header: 'Mois' }, { header: 'Dépenses', align: 'right', width: 32 }, { header: 'Dont exceptionnelles', align: 'right', width: 40 }],
      r.topMonths.map((x, i) => [String(i + 1), capital(formatMonth(x.month)), money(x.expenses), x.exceptional ? money(x.exceptional) : '-']),
    );
  }

  if (r.goals.length) {
    rep.section(r.wealthEndLabel ? 'Objectifs d\'épargne' : 'Objectifs d\'épargne au 31 décembre');
    rep.table(
      [{ header: 'Objectif' }, { header: 'Épargné', align: 'right', width: 30 }, { header: 'Cible', align: 'right', width: 30 }, { header: 'Progression', align: 'right', width: 26 }, { header: 'Échéance', width: 26 }],
      r.goals.map((g) => [g.goal.name, money(g.savedCents), money(g.goal.targetCents), pct(g.percent), g.goal.deadline ? formatDate(g.goal.deadline) : '-']),
    );
  }

  return rep.save(`bilan-annuel-${r.year}.pdf`);
}

function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
