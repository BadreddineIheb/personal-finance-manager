/**
 * budgets.js — Page Budgets : budget global et par catégorie, alertes 80 % / 100 %,
 * comparaison prévu / réel, dépenses hors budget, estimation de fin de mois.
 */
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { listTransactionsByMonth, listTransactionsForMonths, listBudgets, listRecurrences } from '../data/repository.js';
import { budgetOverview } from '../domain/budgets.js';
import { forecastMonth } from '../domain/forecast.js';
import { formatMoney, formatPercent, sumCents } from '../core/money.js';
import { formatMonth, todayISO, addMonths, monthKeyOf } from '../core/dates.js';
import { categoryColor } from '../data/schema.js';
import { getCategories } from '../ui/cache.js';
import { pageHead, emptyState } from '../ui/components/widgets.js';
import { budgetLine, budgetAlerts, forecastCard, openBudgetForm, budgetBadge } from '../ui/components/budget-widgets.js';
import { href } from '../ui/router.js';

/** Moyenne des dépenses variables des 3 mois précédant le mois en cours (pour les mois futurs). */
export async function averageVariable(today = todayISO()) {
  const cur = monthKeyOf(today);
  const txs = await listTransactionsForMonths(addMonths(cur, -3), addMonths(cur, -1));
  const v = sumCents(txs.filter((t) => t.kind === 'expense' && t.expenseType === 'variable'), (t) => t.amountCents);
  return Math.round(v / 3);
}

export async function render(view, { month }) {
  const [{ byId }, budgets, transactions, recurrences] = await Promise.all([getCategories(), listBudgets(), listTransactionsByMonth(month), listRecurrences()]);
  const o = budgetOverview(budgets, transactions, month);
  const today = todayISO();
  const forecast = forecastMonth({ month, today, transactions, recurrences, averageVariableCents: month > monthKeyOf(today) ? await averageVariable(today) : 0 });
  const edit = () => openBudgetForm({ month });
  const editMonth = () => openBudgetForm({ month, scope: 'month' });

  const head = pageHead('Budgets', formatMonth(month),
    h('button', { class: 'btn btn-secondary', type: 'button', onClick: editMonth }, `Ajuster ${formatMonth(month, { short: true })}`),
    h('button', { class: 'btn btn-primary', type: 'button', onClick: edit }, icon('edit'), 'Définir les budgets'));

  if (!o.global && !o.categories.length) {
    mount(view, head,
      h('section', { class: 'card' }, emptyState({
        iconName: 'gauge', title: 'Aucun budget défini',
        body: 'Fixe un budget global mensuel et des budgets par catégorie (courses, restaurants, loisirs…). Tu seras alerté à 80 % et à 100 %.',
        actions: [h('button', { class: 'btn btn-primary', type: 'button', onClick: edit }, icon('plus'), 'Définir mes budgets')],
      })),
      h('div', { class: 'grid-2' }, forecastCard(forecast, { month }), unbudgetedCard(o, byId, transactions)));
    return;
  }

  // Budget global
  const globalCard = h('section', { class: 'card stack budget-hero' },
    h('div', { class: 'row-between' }, h('h2', { class: 'card-title' }, 'Budget global'),
      o.global ? h('span', { class: 'subtle fs-13' }, o.global.source === 'month' ? `Propre à ${formatMonth(month)}` : 'Budget par défaut') : null),
    o.global
      ? [h('div', { class: 'row-between wrap', style: { alignItems: 'baseline' } },
        h('span', { class: 'num' }, h('span', { class: 'kpi-value' }, formatMoney(o.global.spentCents)), h('span', { class: 'subtle' }, ` / ${formatMoney(o.global.budgetCents)}`)),
        budgetBadge(o.global)),
      h('div', { class: 'progress', dataset: { state: { ok: 'ok', warn: 'warn', reached: 'over', over: 'over' }[o.global.state] }, role: 'progressbar',
        aria: { valuenow: String(Math.round(o.global.percent)), valuemin: '0', valuemax: '100', label: 'Budget global consommé' } },
      h('span', { style: { width: `${Math.min(100, o.global.percent)}%` } })),
      h('p', { class: 'fs-13' }, o.global.remainingCents >= 0
        ? h('span', { class: 'muted' }, `Reste ${formatMoney(o.global.remainingCents)} à dépenser ce mois-ci.`)
        : h('span', { class: 'neg' }, `Budget dépassé de ${formatMoney(-o.global.remainingCents)}.`)),
      o.exceedsGlobal ? h('div', { class: 'alert alert-warn' }, icon('alert'), h('div', { class: 'alert-body' },
        `La somme des budgets par catégorie (${formatMoney(o.sumOfCategoryBudgets)}) dépasse le budget global (${formatMoney(o.global.budgetCents)}).`)) : null]
      : h('p', { class: 'subtle' }, `Pas de budget global. Dépenses du mois : ${formatMoney(o.totalSpent)}.`));

  // Budgets par catégorie
  const catCard = h('section', { class: 'card stack-sm' },
    h('h2', { class: 'card-title' }, 'Par catégorie'),
    o.categories.length
      ? h('div', { class: 'budget-list' }, o.categories.map((c) => {
        const cat = byId.get(c.categoryId);
        return budgetLine({ label: cat?.name ?? 'Catégorie supprimée', color: categoryColor(cat?.color), st: c, source: c.source });
      }))
      : h('p', { class: 'subtle' }, 'Aucun budget par catégorie.'));

  // Prévu vs réel
  const planned = o.categories;
  const compare = h('section', { class: 'card stack-sm' },
    h('h2', { class: 'card-title' }, 'Prévu vs réel'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Catégorie'), h('th', { class: 'right' }, 'Prévu'), h('th', { class: 'right' }, 'Réel'), h('th', { class: 'right' }, 'Écart'), h('th', { class: 'right' }, 'Utilisé'))),
      h('tbody', {},
        planned.map((c) => h('tr', {},
          h('td', {}, h('span', { class: 'cat' }, h('i', { style: { background: categoryColor(byId.get(c.categoryId)?.color) } }), byId.get(c.categoryId)?.name ?? '?')),
          h('td', { class: 'right num' }, formatMoney(c.budgetCents)),
          h('td', { class: 'right num fw-600' }, formatMoney(c.spentCents)),
          h('td', { class: ['right', 'num', c.remainingCents < 0 ? 'neg' : 'pos'] }, formatMoney(c.remainingCents, { sign: 'always' })),
          h('td', { class: ['right', 'num', c.state === 'ok' ? 'subtle' : c.state === 'warn' ? 'warn-text' : 'neg'] }, formatPercent(c.percent)))),
        planned.length ? h('tr', { class: 'total-row' },
          h('td', { class: 'fw-600' }, 'Total des catégories budgétées'),
          h('td', { class: 'right num fw-600' }, formatMoney(o.sumOfCategoryBudgets)),
          h('td', { class: 'right num fw-600' }, formatMoney(sumCents(planned, (c) => c.spentCents))),
          h('td', { class: 'right num fw-600' }, formatMoney(o.sumOfCategoryBudgets - sumCents(planned, (c) => c.spentCents), { sign: 'always' })),
          h('td', {})) : null,
        o.global ? h('tr', { class: 'total-row' }, h('td', { class: 'fw-600' }, 'Budget global'),
          h('td', { class: 'right num fw-600' }, formatMoney(o.global.budgetCents)), h('td', { class: 'right num fw-600' }, formatMoney(o.global.spentCents)),
          h('td', { class: ['right', 'num', 'fw-600', o.global.remainingCents < 0 ? 'neg' : 'pos'] }, formatMoney(o.global.remainingCents, { sign: 'always' })),
          h('td', { class: 'right num' }, formatPercent(o.global.percent))) : null))));

  mount(view, head,
    budgetAlerts(o, byId),
    h('div', { class: 'grid-2-1' }, h('div', { class: 'stack' }, globalCard, catCard), h('div', { class: 'stack' }, forecastCard(forecast, { month }), unbudgetedCard(o, byId, transactions))),
    compare);
}

function unbudgetedCard(o, byId) {
  return h('section', { class: 'card stack-sm' },
    h('h2', { class: 'card-title' }, 'Dépenses sans budget'),
    o.unbudgeted.length
      ? [h('div', { class: 'list-plain' }, o.unbudgeted.map((u) => h('div', { class: 'line' },
        h('span', { class: 'cat ellipsis' }, h('i', { style: { background: categoryColor(byId.get(u.categoryId)?.color) } }), byId.get(u.categoryId)?.name ?? '?'),
        h('span', { class: 'num fw-600' }, formatMoney(u.spentCents))))),
      h('p', { class: 'subtle fs-13' }, 'Ces catégories n\'ont pas de budget ce mois-ci.')]
      : h('p', { class: 'subtle' }, 'Toutes les dépenses du mois sont couvertes par un budget.'),
    h('a', { class: 'card-link', href: href('depenses') }, 'Voir les dépenses'));
}
