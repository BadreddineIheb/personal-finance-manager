/**
 * pdf-monthly.js — Rapport mensuel : synthèse, résumé rédigé, graphiques, revenus, dépenses par catégorie
 * et par type, dépenses exceptionnelles, comparaison avec le mois précédent, budgets, épargne et objectifs,
 * détail de toutes les dépenses.
 */
import { Report, loadPdfLibs, chartImage, money, C, catColor, PAGE } from './pdf-kit.js';
import { formatPercent, formatPoints } from '../core/money.js';
import { formatMonth, formatDate, monthName, monthBounds } from '../core/dates.js';
import { EXPENSE_TYPES, INCOME_TYPES } from '../data/schema.js';
import { pdfText } from './report-data.js';

const pct = (v) => pdfText(formatPercent(v));

/**
 * @param {object} r résultat de buildMonthlyReport
 * @param {Map} categoriesById
 */
export async function generateMonthlyPdf(r, categoriesById) {
  const jsPDF = await loadPdfLibs();
  const s = r.s;
  const rep = new Report(jsPDF, { title: 'Bilan financier mensuel', subtitle: capital(formatMonth(r.month)) });
  const name = (id) => categoriesById.get(id)?.name ?? 'Catégorie supprimée';
  const prevLabel = monthName(r.prev);

  // ---------- Synthèse ----------
  const vs = (cur, prev) => {
    if (!r.hasPrevious) return null;
    const d = cur - prev;
    if (!d) return `= ${prevLabel}`;
    return `${money(d, { sign: 'always' })} vs ${prevLabel}`;
  };
  rep.kpis([
    { label: 'Revenus', value: money(s.income), sub: vs(s.income, r.p.income), color: C.positive },
    { label: 'Total dépenses', value: money(s.expenses), sub: vs(s.expenses, r.p.expenses) },
    { label: 'Excédent', value: money(s.surplus, { sign: s.surplus ? 'always' : 'auto' }), sub: 'Revenus - dépenses', color: s.surplus < 0 ? C.negative : C.ink },
    { label: 'Taux d\'épargne', value: pct(s.savingsRate), sub: r.hasPrevious && r.p.savingsRate !== null && s.savingsRate !== null ? `${pdfText(formatPoints(Math.round((s.savingsRate - r.p.savingsRate) * 10) / 10))} vs ${prevLabel}` : null },
    { label: 'Dépenses fixes', value: money(s.fixed), swatch: C.fixed },
    { label: 'Dépenses variables', value: money(s.variable), swatch: C.variable },
    { label: 'Exceptionnelles', value: money(s.exceptional), swatch: C.exceptional },
    { label: 'Épargne réalisée', value: money(s.saved), sub: `${money(r.movements.deposits, { compact: true })} versés, ${money(r.movements.withdrawals, { compact: true })} retirés` },
    { label: 'Solde fin de mois', value: r.balance === null ? '-' : money(r.balance), sub: r.balance === null ? 'Solde de départ non défini' : 'Compte courant' },
    { label: 'Épargne totale', value: r.savingsTotal === null ? '-' : money(r.savingsTotal), sub: s.interest ? `dont ${money(s.interest)} d'intérêts ce mois` : null },
    { label: 'Patrimoine', value: r.balance !== null && r.savingsTotal !== null ? money(r.balance + r.savingsTotal) : '-', sub: 'Compte courant + épargne' },
    { label: 'Opérations', value: String(s.incomeCount + s.expenseCount), sub: `${s.incomeCount} revenu(s), ${s.expenseCount} dépense(s)` },
  ]);

  rep.section('Résumé');
  rep.paragraph(r.summary, { color: C.ink });

  // ---------- Graphiques ----------
  if (r.byCategory.length) {
    const top = r.byCategory.slice(0, 7);
    const rest = r.byCategory.slice(7);
    const slices = top.map((c) => ({ name: name(c.categoryId), pct: pct(c.percent), cents: c.totalCents, color: catColor(categoriesById.get(c.categoryId)?.color) }));
    if (rest.length) {
      const cents = rest.reduce((a, c) => a + c.totalCents, 0);
      slices.push({ name: `Autres (${rest.length})`, pct: pct(Math.round(rest.reduce((a, c) => a + c.percent * 10, 0)) / 10), cents, color: catColor('cat-other') });
    }
    for (const x of slices) x.label = x.name;
    const [donut, types] = await Promise.all([
      chartImage({ type: 'doughnut', data: { labels: slices.map((x) => x.label), datasets: [{ data: slices.map((x) => x.cents / 100), backgroundColor: slices.map((x) => x.color), borderColor: '#ffffff', borderWidth: 3 }] }, options: { cutout: '62%' } }, { width: 600, height: 600 }),
      chartImage({ type: 'bar', data: { labels: ['Fixes', 'Variables', 'Exceptionnelles'], datasets: [{ data: [s.fixed / 100, s.variable / 100, s.exceptional / 100], backgroundColor: [C.fixed, C.variable, C.exceptional], borderRadius: 8, maxBarThickness: 120 }] } }, { width: 800, height: 600 }),
    ]);
    rep.section('Répartition des dépenses', { keepWith: 66 });
    const y0 = rep.y;
    rep.doc.addImage(donut, 'PNG', PAGE.m, y0, 58, 58, undefined, 'FAST');
    rep.doc.addImage(types, 'PNG', PAGE.m + 118, y0 + 2, 60, 45, undefined, 'FAST');
    // Légende du donut : nom (tronqué si besoin) et part alignée à droite
    rep.font(8, 'normal', C.ink2);
    const lx = PAGE.m + 62;
    const lw = 50;
    slices.forEach((x, i) => {
      const yy = y0 + 5 + i * 6.2;
      rep.doc.setFillColor(...hexRgb(x.color));
      rep.doc.rect(lx, yy - 2.4, 2.6, 2.6, 'F');
      let label = pdfText(x.name);
      while (rep.doc.getTextWidth(label) > lw - 20 && label.length > 4) label = `${label.slice(0, -2)}…`.replace(/……$/, '…');
      rep.doc.text(label, lx + 4, yy);
      rep.doc.text(x.pct, lx + lw, yy, { align: 'right' });
    });
    rep.font(7.5, 'normal', C.ink3);
    rep.doc.text('Par type de dépense', PAGE.m + 148, y0 + 50, { align: 'center' });
    rep.y = y0 + 66;
  }

  // ---------- Revenus ----------
  rep.section('Détail des revenus', { keepWith: 30 });
  if (r.incomes.length) {
    rep.table(
      [{ header: 'Date', width: 22 }, { header: 'Libellé' }, { header: 'Type', width: 38 }, { header: 'Montant', align: 'right', width: 30 }],
      r.incomes.map((t) => [formatDate(t.date), t.label, INCOME_TYPES[t.incomeType]?.label ?? '', money(t.amountCents)]),
      { foot: ['', 'Total des revenus', '', money(s.income)] },
    );
  } else rep.paragraph('Aucun revenu enregistré ce mois-ci.');

  // ---------- Dépenses ----------
  rep.section('Dépenses par catégorie');
  if (r.byCategory.length) {
    rep.table(
      [{ header: 'Catégorie' }, { header: 'Opérations', align: 'right', width: 24 }, { header: 'Montant', align: 'right', width: 32 }, { header: 'Part', align: 'right', width: 20 }],
      r.byCategory.map((c) => [name(c.categoryId), String(c.count), money(c.totalCents), pct(c.percent)]),
      { foot: ['Total des dépenses', String(s.expenseCount), money(s.expenses), '100,0 %'] },
    );
  } else rep.paragraph('Aucune dépense enregistrée ce mois-ci.');

  rep.section('Dépenses par type');
  rep.table(
    [{ header: 'Type' }, { header: 'Montant', align: 'right', width: 32 }, { header: 'Part', align: 'right', width: 20 }],
    Object.entries(EXPENSE_TYPES).map(([k, t]) => [t.plural, money(s[k]), s.expenses ? pct(Math.round((s[k] * 1000) / s.expenses) / 10) : '-']),
    { foot: ['Total', money(s.expenses), s.expenses ? '100,0 %' : '-'] },
  );

  if (r.exceptional.length) {
    rep.section('Dépenses exceptionnelles');
    rep.table(
      [{ header: 'Date', width: 22 }, { header: 'Libellé' }, { header: 'Catégorie', width: 46 }, { header: 'Montant', align: 'right', width: 30 }],
      r.exceptional.map((t) => [formatDate(t.date), t.label, name(t.categoryId), money(t.amountCents)]),
    );
  }

  // ---------- Comparaison ----------
  rep.section(`Comparaison avec ${formatMonth(r.prev)}`);
  if (r.hasPrevious) {
    rep.table(
      [{ header: '' }, { header: capital(monthName(r.prev)), align: 'right', width: 32 }, { header: capital(monthName(r.month)), align: 'right', width: 32 }, { header: 'Écart', align: 'right', width: 32 }, { header: 'Variation', align: 'right', width: 22 }],
      [
        ...r.comparison.map((c) => [c.label, money(c.previous), money(c.current),
          { content: c.diff ? money(c.diff, { sign: 'always' }) : '-', styles: { textColor: toneColor(c.diff, c.better) } },
          c.pct === null || !c.diff ? '-' : pdfText(formatPercent(c.pct, 1, { sign: 'always' }))]),
        ['Taux d\'épargne', pct(r.p.savingsRate), pct(s.savingsRate),
          r.p.savingsRate !== null && s.savingsRate !== null ? pdfText(formatPoints(Math.round((s.savingsRate - r.p.savingsRate) * 10) / 10)) : '-', ''],
      ],
      { accentCol: 2 },
    );
  } else rep.paragraph(`Aucune donnée en ${formatMonth(r.prev)} : comparaison impossible.`);

  // ---------- Budgets ----------
  const b = r.budget;
  if (b.global || b.categories.length) {
    rep.section('Budgets : prévu et réel');
    const state = (st) => ({ ok: 'Respecté', warn: 'Attention (80 %)', reached: 'Atteint', over: 'Dépassé' }[st]);
    const rows = [
      ...(b.global ? [['Budget global', money(b.global.budgetCents), money(b.global.spentCents), money(b.global.remainingCents, { sign: 'always' }), pct(b.global.percent), state(b.global.state)]] : []),
      ...b.categories.map((c) => [name(c.categoryId), money(c.budgetCents), money(c.spentCents), money(c.remainingCents, { sign: 'always' }), pct(c.percent), state(c.state)]),
    ].map((row) => row.map((cell, i) => (i === 5 ? { content: cell, styles: { textColor: cell === 'Respecté' ? hexRgb(C.positive) : cell === 'Dépassé' || cell === 'Atteint' ? hexRgb(C.negative) : hexRgb(C.warning) } } : cell)));
    rep.table([{ header: 'Budget' }, { header: 'Prévu', align: 'right', width: 26 }, { header: 'Réel', align: 'right', width: 26 }, { header: 'Reste', align: 'right', width: 26 }, { header: 'Utilisé', align: 'right', width: 18 }, { header: 'État', width: 30 }], rows);
  }

  // ---------- Épargne ----------
  rep.section('Épargne');
  rep.paragraph([
    `Versements : ${money(r.movements.deposits)} · Retraits : ${money(r.movements.withdrawals)} · Épargne réalisée : ${money(s.saved)}${s.interest ? ` · Intérêts : ${money(s.interest)}` : ''}.`,
    r.savingsTotal !== null ? `Épargne totale au ${formatDate(monthBounds(r.month)[1])} : ${money(r.savingsTotal)}.` : 'Aucun compte d\'épargne enregistré.',
  ]);
  if (r.goals.length) {
    rep.table(
      [{ header: 'Objectif' }, { header: 'Épargné', align: 'right', width: 30 }, { header: 'Cible', align: 'right', width: 30 }, { header: 'Progression', align: 'right', width: 26 }, { header: 'Échéance', width: 26 }],
      r.goals.map((g) => [g.goal.name, money(g.savedCents), money(g.goal.targetCents), pct(g.percent), g.goal.deadline ? formatDate(g.goal.deadline) : '-']),
    );
  }

  // ---------- Annexe : toutes les dépenses ----------
  if (r.expenses.length) {
    rep.section('Annexe : détail des dépenses', { keepWith: 30 });
    rep.table(
      [{ header: 'Date', width: 20 }, { header: 'Libellé' }, { header: 'Catégorie', width: 42 }, { header: 'Type', width: 26 }, { header: 'Montant', align: 'right', width: 26 }],
      r.expenses.map((t) => [formatDate(t.date), t.label, name(t.categoryId), EXPENSE_TYPES[t.expenseType]?.label ?? '', money(t.amountCents)]),
      { foot: ['', 'Total', '', '', money(s.expenses)], fontSize: 8 },
    );
  }

  return rep.save(`bilan-${r.month}.pdf`);
}

function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function hexRgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
function toneColor(diff, better) { if (!diff) return hexRgb(C.ink3); return hexRgb((diff > 0) === (better === 'up') ? C.positive : C.negative); }

export { capital, hexRgb };
