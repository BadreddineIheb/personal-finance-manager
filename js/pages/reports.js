/**
 * reports.js — Page Rapports PDF : choix du rapport (mensuel ou annuel), aperçu des chiffres
 * et du contenu, bouton « Télécharger le rapport PDF ».
 */
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { listAllTransactions, listAllMovements, listSavingsAccounts, listGoals, listBudgets } from '../data/repository.js';
import { buildMonthlyReport, buildAnnualReport } from '../reports/report-data.js';
import { formatMoney, formatPercent } from '../core/money.js';
import { formatMonth, addMonths, monthRange, todayISO } from '../core/dates.js';
import { getCategories, getCachedSettings } from '../ui/cache.js';
import { pageHead } from '../ui/components/widgets.js';
import { toast } from '../ui/components/toast.js';

const state = { type: 'monthly', month: null, year: null };

export async function render(view, { month }) {
  state.month ??= month;
  state.year ??= month.slice(0, 4);
  const [transactions, movements, accounts, goals, budgets, settings, { byId }] = await Promise.all([
    listAllTransactions(), listAllMovements(), listSavingsAccounts(), listGoals(), listBudgets(), getCachedSettings(), getCategories(),
  ]);
  const data = { transactions, movements, accounts, goals, budgets, settings, categoriesById: byId };
  const months = transactions.map((t) => t.month);
  const first = months.length ? months.reduce((a, b) => (a < b ? a : b)) : month;
  const last = months.length ? months.reduce((a, b) => (a > b ? a : b)) : month;
  const rerender = () => render(view, { month });

  const typeSeg = h('div', { class: 'seg', role: 'group', aria: { label: 'Type de rapport' } },
    [['monthly', 'Rapport mensuel'], ['annual', 'Rapport annuel']].map(([k, l]) => h('button', {
      type: 'button', aria: { pressed: String(state.type === k) }, onClick: () => { state.type = k; rerender(); },
    }, l)));

  const monthOptions = monthRange(addMonths(first, -1) < addMonths(month, -24) ? addMonths(first, -1) : addMonths(month, -24), last > month ? last : month).reverse();
  const periodSelect = state.type === 'monthly'
    ? h('select', { class: 'select', id: 'report-month', aria: { label: 'Mois du rapport' }, onChange: (e) => { state.month = e.target.value; rerender(); } },
      monthOptions.map((m) => h('option', { value: m, selected: m === state.month }, formatMonth(m))))
    : h('select', { class: 'select', id: 'report-year', aria: { label: 'Année du rapport' }, onChange: (e) => { state.year = e.target.value; rerender(); } },
      [...new Set([...monthOptions.map((m) => m.slice(0, 4)), month.slice(0, 4)])].sort().reverse().map((y) => h('option', { value: y, selected: y === state.year }, y)));

  const report = state.type === 'monthly'
    ? buildMonthlyReport({ month: state.month, ...data })
    : buildAnnualReport({ year: state.year, ...data, today: todayISO() });
  const empty = state.type === 'monthly' ? report.s.incomeCount + report.s.expenseCount === 0 : !report.active.length;

  const button = h('button', { class: 'btn btn-primary', type: 'button', disabled: empty, id: 'download-report' }, icon('file'), 'Télécharger le rapport PDF');
  button.addEventListener('click', async () => {
    button.disabled = true;
    const label = button.lastChild;
    label.textContent = 'Génération en cours…';
    try {
      if (state.type === 'monthly') {
        const { generateMonthlyPdf } = await import('../reports/pdf-monthly.js');
        await generateMonthlyPdf(report, byId);
      } else {
        const { generateAnnualPdf } = await import('../reports/pdf-annual.js');
        await generateAnnualPdf(report, byId);
      }
      toast('Rapport PDF téléchargé');
    } catch (err) {
      console.error(err);
      toast(`Le rapport n'a pas pu être généré : ${err.message}`);
    } finally {
      button.disabled = false;
      label.textContent = 'Télécharger le rapport PDF';
    }
  });

  const kpi = (label, value) => h('div', { class: 'type-total' }, h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-value num' }, value));
  const preview = state.type === 'monthly'
    ? [kpi('Revenus', formatMoney(report.s.income)), kpi('Dépenses', formatMoney(report.s.expenses)), kpi('Excédent', formatMoney(report.s.surplus, { sign: 'always' })),
      kpi('Épargne réalisée', formatMoney(report.s.saved)), kpi('Taux d\'épargne', formatPercent(report.s.savingsRate)), kpi('Solde fin de mois', report.balance === null ? '—' : formatMoney(report.balance))]
    : [kpi('Revenus', formatMoney(report.totals.income)), kpi('Dépenses', formatMoney(report.totals.expenses)), kpi('Excédent cumulé', formatMoney(report.totals.surplus, { sign: 'always' })),
      kpi('Épargne réalisée', formatMoney(report.totals.saved)), kpi('Taux d\'épargne moyen', formatPercent(report.avgRate)), kpi('Mois avec opérations', `${report.active.length} / 12`)];

  const contents = state.type === 'monthly'
    ? ['Synthèse : revenus, dépenses fixes / variables / exceptionnelles, excédent, épargne, solde, taux d\'épargne, patrimoine',
      'Résumé de la situation, rédigé à partir des chiffres', 'Graphiques de répartition des dépenses (catégories et types)',
      'Détail des revenus', 'Dépenses par catégorie et par type', 'Dépenses exceptionnelles', 'Comparaison avec le mois précédent',
      'Budgets prévus et réels (si définis)', 'Épargne et objectifs', 'Annexe : liste complète des dépenses']
    : ['Synthèse de l\'année et évolution du patrimoine', 'Résumé de l\'année', 'Graphiques : revenus vs dépenses par mois, patrimoine',
      'Tableau des 12 mois avec totaux et moyennes', 'Dépenses de l\'année par catégorie', 'Mois les plus dépensiers', 'Objectifs d\'épargne au 31 décembre'];

  mount(view,
    pageHead('Rapports PDF', 'Bilans financiers à télécharger, imprimer ou archiver'),
    h('div', { class: 'grid-2-1' },
      h('section', { class: 'card stack' },
        h('div', { class: 'row wrap' }, typeSeg, periodSelect),
        h('div', { class: 'stack-sm' },
          h('h2', { class: 'card-title' }, state.type === 'monthly' ? `Bilan de ${formatMonth(state.month)}` : `Bilan de l'année ${state.year}`),
          h('div', { class: 'report-preview' }, preview)),
        empty
          ? h('div', { class: 'alert alert-info' }, icon('info'), h('div', { class: 'alert-body' }, 'Aucune opération sur cette période : choisis une autre période pour générer un rapport.'))
          : h('div', { class: 'stack-sm' }, h('h3', { class: 'field-label' }, 'Résumé inclus dans le rapport'),
            h('ul', { class: 'report-summary' }, report.summary.map((line) => h('li', {}, line)))),
        h('div', {}, button)),
      h('section', { class: 'card stack-sm' },
        h('h2', { class: 'card-title' }, 'Contenu du rapport'),
        h('ul', { class: 'check-list' }, contents.map((c) => h('li', {}, icon('check', 'icon icon-sm'), c))),
        h('p', { class: 'subtle fs-13' }, 'Format A4, texte sélectionnable, tableaux paginés. Le PDF est généré dans ton navigateur : aucune donnée n\'est envoyée.'))));
}
