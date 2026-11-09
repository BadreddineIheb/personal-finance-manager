/**
 * history.js — Page Historique.
 * Onglets : Synthèse (mois par mois sur une période choisie), Opérations (toutes les opérations
 * de la période, filtrables), Comparaison (deux mois côte à côte), Calendrier (mois consulté), Analyse.
 */
import { h, mount, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  listTransactionsForMonths, listAllTransactions, listAllMovements, listRecurrences, listBudgets, listSavingsAccounts,
} from '../data/repository.js';
import { monthlySummaries, averageSavingsRate, topSpendingMonths, topCategories, calendarMonth, insights } from '../domain/analytics.js';
import { filterTransactions, sortTransactions, total, totalsByCategory } from '../domain/transactions.js';
import { accountBalance, variation } from '../domain/ledger.js';
import { totalSavingsOrNull } from '../domain/savings.js';
import { upcomingOccurrences } from '../domain/recurrence.js';
import { formatMoney, formatPercent, formatPoints, sumCents, parseAmount } from '../core/money.js';
import {
  formatMonth, addMonths, monthBounds, monthRange, formatDate, monthName, todayISO, addDays, currentMonthKey, compareISO,
} from '../core/dates.js';
import { EXPENSE_TYPES, categoryColor } from '../data/schema.js';
import { getCategories, getCachedSettings } from '../ui/cache.js';
import { pageHead, emptyState } from '../ui/components/widgets.js';
import { transactionRow } from '../ui/components/transaction-row.js';
import { openTransactionForm } from '../ui/components/transaction-form.js';
import { incomeExpenseChart } from '../ui/charts.js';
import { href } from '../ui/router.js';

const TABS = [['synthese', 'Synthèse'], ['operations', 'Opérations'], ['comparaison', 'Comparaison'], ['calendrier', 'Calendrier'], ['analyse', 'Analyse']];

/** Période choisie et filtres, conservés pendant la session. */
const state = { from: null, to: null, compareA: null, compareB: null, query: '', kind: '', categoryId: '', type: '', sort: 'date-desc', limit: 100, selectedDay: null };

export async function render(view, { month, params }) {
  const tab = TABS.some(([k]) => k === params.onglet) ? params.onglet : 'synthese';
  const all = await listAllTransactions();
  const first = all.reduce((min, t) => (t.month < min ? t.month : min), month);
  const last = all.reduce((max, t) => (t.month > max ? t.month : max), month);
  state.to ??= month;
  state.from ??= addMonths(month, -11) < first ? first : addMonths(month, -11);

  const tabs = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, l]) => h('a', {
    role: 'tab', class: 'tab-link', href: href('historique', k === 'synthese' ? {} : { onglet: k }), aria: { selected: String(tab === k) },
  }, l)));
  const ctx = { month, params, all, first, last, rerender: () => render(view, { month, params }) };
  const content = await ({ synthese: synthesis, operations, comparaison: comparison, calendrier: calendar, analyse: analysis }[tab])(ctx);
  mount(view, pageHead('Historique', subtitleFor(tab, month)), tabs, ...content.nodes);
  return content.cleanup;
}

function subtitleFor(tab, month) {
  if (tab === 'calendrier') return formatMonth(month);
  if (tab === 'comparaison') return 'Deux mois côte à côte';
  return `Du ${formatMonth(state.from)} à ${formatMonth(state.to)}`;
}

/** Sélecteur de période (mois de début et de fin). */
function periodPicker({ first, last, rerender }) {
  const options = monthRange(addMonths(first, -12), addMonths(last, 12)).reverse();
  const sel = (value, label, onChange) => h('select', { class: 'select select-sm', aria: { label }, onChange },
    options.map((m) => h('option', { value: m, selected: m === value }, formatMonth(m))));
  const from = sel(state.from, 'Premier mois', () => { state.from = from.value; if (state.from > state.to) state.to = state.from; rerender(); });
  const to = sel(state.to, 'Dernier mois', () => { state.to = to.value; if (state.to < state.from) state.from = state.to; rerender(); });
  const preset = (label, fn) => h('button', { class: 'chip', type: 'button', onClick: () => { fn(); rerender(); } }, label);
  const cur = currentMonthKey();
  return h('div', { class: 'filters' },
    h('span', { class: 'muted fs-13' }, 'Période :'), from, h('span', { class: 'subtle' }, '→'), to,
    preset('3 derniers mois', () => { state.to = cur; state.from = addMonths(cur, -2); }),
    preset('12 derniers mois', () => { state.to = cur; state.from = addMonths(cur, -11); }),
    preset(`Année ${cur.slice(0, 4)}`, () => { state.from = `${cur.slice(0, 4)}-01`; state.to = `${cur.slice(0, 4)}-12`; }),
    preset('Tout', () => { state.from = first; state.to = last; }));
}

// ------------------------------------------------------------------ Synthèse

async function synthesis(ctx) {
  const [txs, movements, settings] = await Promise.all([listTransactionsForMonths(state.from, state.to), listAllMovements(), getCachedSettings()]);
  const all = ctx.all;
  const rows = monthlySummaries(txs, movements, state.from, state.to);
  const balanceAt = (iso) => accountBalance(settings, iso, all, movements);
  const sums = (k) => sumCents(rows, (r) => r[k]);
  const n = rows.length;
  const box = h('div', { class: 'chart chart-bars' });
  const chart = incomeExpenseChart(box, { labels: rows.map((r) => formatMonth(r.month, { short: true })), income: rows.map((r) => r.income), expenses: rows.map((r) => r.expenses) });

  const head = ['Mois', 'Revenus', 'Fixes', 'Variables', 'Exception.', 'Total dépenses', 'Excédent', 'Épargne virée', 'Solde fin de mois', 'Taux'];
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'table table-history' },
    h('thead', {}, h('tr', {}, head.map((x, i) => h('th', { class: i ? 'right' : null }, x)))),
    h('tbody', {}, [...rows].reverse().map((r) => {
      const bal = balanceAt(monthBounds(r.month)[1]);
      return h('tr', { class: r.month === ctx.month ? 'is-current' : null },
        h('td', {}, h('a', { href: href('dashboard', { mois: r.month }), class: 'cap', style: { color: 'var(--ink)' } }, formatMonth(r.month))),
        h('td', { class: 'right num pos' }, money0(r.income)),
        h('td', { class: 'right num' }, money0(r.fixed)),
        h('td', { class: 'right num' }, money0(r.variable)),
        h('td', { class: ['right', 'num', r.exceptional && 'warn-text'] }, money0(r.exceptional)),
        h('td', { class: 'right num fw-600' }, money0(r.expenses)),
        h('td', { class: ['right', 'num', r.surplus > 0 ? 'pos' : r.surplus < 0 ? 'neg' : 'subtle'] }, r.surplus ? formatMoney(r.surplus, { sign: 'always' }) : '—'),
        h('td', { class: 'right num' }, money0(r.saved)),
        h('td', { class: 'right num' }, bal === null ? '—' : formatMoney(bal)),
        h('td', { class: 'right num' }, formatPercent(r.savingsRate)));
    })),
    h('tfoot', {},
      h('tr', { class: 'total-row' }, h('td', { class: 'fw-600' }, `Total (${n} mois)`),
        ...['income', 'fixed', 'variable', 'exceptional', 'expenses'].map((k) => h('td', { class: 'right num fw-600' }, formatMoney(sums(k)))),
        h('td', { class: 'right num fw-600' }, formatMoney(sums('surplus'), { sign: 'always' })),
        h('td', { class: 'right num fw-600' }, formatMoney(sums('saved'))), h('td', {}),
        h('td', { class: 'right num fw-600', title: 'Taux moyen pondéré : Σ(revenus − dépenses) / Σ revenus' }, formatPercent(averageSavingsRate(rows)))),
      h('tr', {}, h('td', { class: 'muted' }, 'Moyenne mensuelle'),
        ...['income', 'fixed', 'variable', 'exceptional', 'expenses', 'surplus', 'saved'].map((k) => h('td', { class: 'right num muted' }, formatMoney(Math.round(sums(k) / n)))),
        h('td', {}), h('td', {})))));

  // Dépenses exceptionnelles de la période
  const exceptional = sortTransactions(txs.filter((t) => t.kind === 'expense' && t.expenseType === 'exceptional'), 'date', 'desc');
  const { byId } = await getCategories();
  const open = (t) => openTransactionForm({ record: t, month: t.month });

  return {
    nodes: [periodPicker(ctx),
      h('section', { class: 'card stack-sm' }, h('h2', { class: 'card-title' }, 'Revenus et dépenses par mois'), box,
        h('div', { class: 'row wrap fs-13 muted' }, legend('var(--positive)', 'Revenus'), legend('var(--ink-3)', 'Dépenses'))),
      h('section', { class: 'card stack-sm' }, h('h2', { class: 'card-title' }, 'Synthèse mensuelle'), table,
        h('p', { class: 'subtle fs-13' }, 'Clique sur un mois pour ouvrir son tableau de bord. Solde fin de mois : compte courant (nécessite le solde de départ).')),
      h('section', { class: 'card stack-sm' },
        h('div', { class: 'row-between' }, h('h2', { class: 'card-title' }, 'Dépenses exceptionnelles'), h('span', { class: 'result-count num' }, `${exceptional.length} · ${formatMoney(total(exceptional))}`)),
        exceptional.length ? h('div', { class: 'tx-list' }, exceptional.map((t) => transactionRow(t, { categories: byId, onOpen: open }))) : h('p', { class: 'subtle' }, 'Aucune dépense exceptionnelle sur la période.'))],
    cleanup: () => chart.destroy(),
  };
}

// ------------------------------------------------------------------ Opérations

async function operations(ctx) {
  const [txs, { byId, list: cats }] = await Promise.all([listTransactionsForMonths(state.from, state.to), getCategories()]);
  const listBox = h('div', { class: 'tx-list' });
  const countBox = h('span', { class: 'result-count num' });
  const open = (t) => openTransactionForm({ record: t, month: t.month });
  const duplicate = (t) => openTransactionForm({ duplicateOf: t, month: ctx.month });

  const refresh = () => {
    const [key, dir] = state.sort.split('-');
    const min = parseAmount(state.min ?? '', { allowZero: true });
    const max = parseAmount(state.max ?? '', { allowZero: true });
    const filtered = sortTransactions(filterTransactions(txs, {
      query: state.query, kind: state.kind, categoryIds: state.categoryId ? [state.categoryId] : [], expenseTypes: state.type ? [state.type] : [],
      minCents: min.ok ? min.cents : undefined, maxCents: max.ok ? max.cents : undefined,
    }, byId), key, dir);
    const incomes = filtered.filter((t) => t.kind === 'income');
    const expenses = filtered.filter((t) => t.kind === 'expense');
    countBox.textContent = `${filtered.length} opération${filtered.length > 1 ? 's' : ''} · ${formatMoney(total(incomes), { sign: 'always' })} / ${formatMoney(-total(expenses))}`;
    const shown = filtered.slice(0, state.limit);
    mount(listBox,
      shown.length ? shown.map((t) => transactionRow(t, { categories: byId, onOpen: open, onDuplicate: duplicate })) : emptyState({ iconName: 'search', title: 'Aucune opération', body: 'Aucune opération ne correspond à ces critères sur la période.' }),
      filtered.length > state.limit ? h('div', { class: 'row', style: { justifyContent: 'center', paddingTop: 'var(--space-3)' } },
        h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => { state.limit += 100; refresh(); } }, `Afficher plus (${filtered.length - state.limit} restantes)`)) : null);
  };

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher…', value: state.query, aria: { label: 'Rechercher' } });
  search.addEventListener('input', debounce(() => { state.query = search.value; state.limit = 100; refresh(); }, 150));
  const select = (label, value, options, onChange) => {
    const s = h('select', { class: 'select', aria: { label } }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    s.addEventListener('change', () => { onChange(s.value); state.limit = 100; refresh(); });
    return s;
  };
  const amountInput = (label, key) => {
    const el = h('input', { class: 'input', inputmode: 'decimal', placeholder: label, value: state[key] ?? '', aria: { label: `Montant ${label.toLowerCase()}` }, style: { width: '90px' } });
    el.addEventListener('input', debounce(() => { state[key] = el.value; refresh(); }, 250));
    return el;
  };
  const filters = h('div', { class: 'filters' },
    h('div', { class: 'search-field' }, icon('search'), search),
    select('Nature', state.kind, [['', 'Revenus et dépenses'], ['income', 'Revenus'], ['expense', 'Dépenses']], (v) => { state.kind = v; }),
    select('Catégorie', state.categoryId, [['', 'Toutes catégories'], ...cats.map((c) => [c.id, c.name])], (v) => { state.categoryId = v; }),
    select('Type', state.type, [['', 'Tous types'], ...Object.entries(EXPENSE_TYPES).map(([k, t]) => [k, t.label])], (v) => { state.type = v; }),
    select('Tri', state.sort, [['date-desc', 'Plus récentes'], ['date-asc', 'Plus anciennes'], ['amount-desc', 'Montant ↓'], ['amount-asc', 'Montant ↑'], ['label-asc', 'Nom A → Z']], (v) => { state.sort = v; }),
    amountInput('Min €', 'min'), amountInput('Max €', 'max'));
  refresh();
  return { nodes: [periodPicker(ctx), h('section', { class: 'card stack' }, filters, h('div', { class: 'row-between' }, h('h2', { class: 'card-title' }, 'Opérations de la période'), countBox), listBox)] };
}

// ------------------------------------------------------------------ Comparaison

async function comparison(ctx) {
  state.compareB ??= ctx.month;
  state.compareA ??= addMonths(ctx.month, -1);
  const [{ byId }, movements] = await Promise.all([getCategories(), listAllMovements()]);
  const from = compareISO(state.compareA, state.compareB) < 0 ? state.compareA : state.compareB;
  const to = from === state.compareA ? state.compareB : state.compareA;
  const txs = await listTransactionsForMonths(from, to);
  const [A, B] = [state.compareA, state.compareB].map((m) => monthlySummaries(txs, movements, m, m)[0]);
  const options = monthRange(addMonths(ctx.first, -12), addMonths(ctx.last, 12)).reverse();
  const sel = (value, label, onChange) => {
    const s = h('select', { class: 'select', aria: { label } }, options.map((m) => h('option', { value: m, selected: m === value }, formatMonth(m))));
    s.addEventListener('change', () => { onChange(s.value); ctx.rerender(); });
    return s;
  };
  const rows = [['Revenus', 'income', 'up'], ['Dépenses fixes', 'fixed', 'down'], ['Dépenses variables', 'variable', 'down'], ['Dépenses exceptionnelles', 'exceptional', 'down'],
    ['Total dépenses', 'expenses', 'down'], ['Excédent', 'surplus', 'up'], ['Épargne virée', 'saved', 'up'], ['Intérêts', 'interest', 'up']];
  const deltaCell = (a, b, better) => {
    const v = variation(b, a);
    if (!v.diff) return h('td', { class: 'right num subtle' }, '—');
    const tone = (v.diff > 0) === (better === 'up') ? 'pos' : 'neg';
    return h('td', { class: ['right', 'num', tone] }, formatMoney(v.diff, { sign: 'always' }), v.pct !== null ? h('span', { class: 'cell-sub' }, formatPercent(v.pct, 1, { sign: 'always' })) : null);
  };
  const la = formatMonth(state.compareA, { short: true });
  const lb = formatMonth(state.compareB, { short: true });
  const main = h('section', { class: 'card stack-sm' },
    h('h2', { class: 'card-title' }, 'Indicateurs'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'right cap' }, la), h('th', { class: 'right cap' }, lb), h('th', { class: 'right' }, 'Écart'))),
      h('tbody', {}, rows.map(([label, k, better]) => h('tr', {}, h('td', {}, label), h('td', { class: 'right num' }, formatMoney(A[k])), h('td', { class: 'right num fw-600' }, formatMoney(B[k])), deltaCell(A[k], B[k], better))),
        h('tr', {}, h('td', {}, 'Taux d\'épargne'), h('td', { class: 'right num' }, formatPercent(A.savingsRate)), h('td', { class: 'right num fw-600' }, formatPercent(B.savingsRate)),
          h('td', { class: 'right num' }, A.savingsRate !== null && B.savingsRate !== null ? formatPoints(Math.round((B.savingsRate - A.savingsRate) * 10) / 10) : '—')),
        h('tr', {}, h('td', {}, 'Nombre d\'opérations'), h('td', { class: 'right num' }, String(A.incomeCount + A.expenseCount)), h('td', { class: 'right num fw-600' }, String(B.incomeCount + B.expenseCount)), h('td', {}))))));

  const catA = new Map(totalsByCategory(txs.filter((t) => t.month === state.compareA)).map((r) => [r.categoryId, r.totalCents]));
  const catB = new Map(totalsByCategory(txs.filter((t) => t.month === state.compareB)).map((r) => [r.categoryId, r.totalCents]));
  const ids = [...new Set([...catA.keys(), ...catB.keys()])].sort((x, y) => Math.max(catB.get(y) ?? 0, catA.get(y) ?? 0) - Math.max(catB.get(x) ?? 0, catA.get(x) ?? 0));
  const cats = h('section', { class: 'card stack-sm' },
    h('h2', { class: 'card-title' }, 'Dépenses par catégorie'),
    ids.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Catégorie'), h('th', { class: 'right cap' }, la), h('th', { class: 'right cap' }, lb), h('th', { class: 'right' }, 'Écart'))),
      h('tbody', {}, ids.map((id) => h('tr', {},
        h('td', {}, h('span', { class: 'cat' }, h('i', { style: { background: categoryColor(byId.get(id)?.color) } }), byId.get(id)?.name ?? '?')),
        h('td', { class: 'right num' }, formatMoney(catA.get(id) ?? 0)), h('td', { class: 'right num fw-600' }, formatMoney(catB.get(id) ?? 0)),
        deltaCell(catA.get(id) ?? 0, catB.get(id) ?? 0, 'down')))))) : h('p', { class: 'subtle' }, 'Aucune dépense sur ces deux mois.'));

  return {
    nodes: [h('div', { class: 'filters' }, h('span', { class: 'muted fs-13' }, 'Comparer'), sel(state.compareA, 'Premier mois', (v) => { state.compareA = v; }),
      h('span', { class: 'subtle' }, 'avec'), sel(state.compareB, 'Second mois', (v) => { state.compareB = v; }),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { [state.compareA, state.compareB] = [state.compareB, state.compareA]; ctx.rerender(); } }, icon('sort', 'icon icon-sm'), 'Inverser')),
    h('div', { class: 'grid-2' }, main, cats)],
  };
}

// ------------------------------------------------------------------ Calendrier

async function calendar(ctx) {
  const month = ctx.month;
  const [{ byId }, recurrences, txs] = await Promise.all([getCategories(), listRecurrences(), listTransactionsForMonths(month, month)]);
  const [start, end] = monthBounds(month);
  const tomorrow = addDays(todayISO(), 1);
  const upcoming = (tomorrow > start ? tomorrow : start) <= end ? upcomingOccurrences(recurrences, tomorrow > start ? tomorrow : start, end) : [];
  const cal = calendarMonth(month, txs, upcoming);
  const today = todayISO();
  if (!state.selectedDay?.startsWith(month)) state.selectedDay = today.startsWith(month) ? today : null;
  const detail = h('section', { class: 'card stack-sm' });

  const showDay = (date) => {
    state.selectedDay = date;
    for (const el of grid.querySelectorAll('.cal-day')) el.setAttribute('aria-pressed', String(el.dataset.date === date));
    const items = sortTransactions(txs.filter((t) => t.date === date), 'amount', 'desc');
    const ups = upcoming.filter((u) => u.date === date);
    mount(detail,
      h('h2', { class: 'card-title cap' }, formatDate(date, 'long')),
      items.length ? h('div', { class: 'tx-list' }, items.map((t) => transactionRow(t, { categories: byId, onOpen: (x) => openTransactionForm({ record: x, month }) }))) : null,
      ups.length ? h('div', { class: 'list-plain' }, h('span', { class: 'field-label' }, 'Échéances prévues'), ups.map((u) => h('div', { class: 'line' },
        h('span', {}, u.recurrence.label, h('span', { class: 'badge badge-accent', style: { marginLeft: '6px' } }, 'Prévu')),
        h('span', { class: ['num', u.recurrence.kind === 'income' && 'pos'] }, formatMoney(u.recurrence.kind === 'income' ? u.recurrence.amountCents : -u.recurrence.amountCents, { sign: u.recurrence.kind === 'income' ? 'always' : 'auto' }))))) : null,
      !items.length && !ups.length ? h('p', { class: 'subtle' }, 'Aucune opération ce jour-là.') : null,
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', style: { alignSelf: 'flex-start' }, onClick: () => openTransactionForm({ kind: 'expense', month, date }) }, icon('plus', 'icon icon-sm'), 'Ajouter une opération ce jour'));
  };

  // Intensité : 4 niveaux selon la dépense du jour rapportée au maximum du mois
  const level = (cents) => (!cents || !cal.maxExpense ? 0 : Math.min(4, Math.ceil((cents * 4) / cal.maxExpense)));
  const grid = h('div', { class: 'cal-grid', role: 'grid', aria: { label: `Calendrier de ${formatMonth(month)}` } },
    ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((d) => h('div', { class: 'cal-head', role: 'columnheader' }, d)),
    cal.weeks.flat().map((d) => (d === null ? h('div', { class: 'cal-empty' }) : h('button', {
      class: ['cal-day', d.date === today && 'is-today'], type: 'button', dataset: { date: d.date, level: String(level(d.expense)) },
      aria: { pressed: String(d.date === state.selectedDay), label: `${formatDate(d.date, 'long')} : ${d.count} opération(s)` },
      onClick: () => showDay(d.date),
    },
    h('span', { class: 'cal-num' }, String(Number(d.date.slice(8, 10)))),
    d.income ? h('span', { class: 'cal-in' }, `+${formatMoney(d.income, { compact: true })}`) : null,
    d.expense ? h('span', { class: 'cal-out' }, `−${formatMoney(d.expense, { compact: true })}`) : null,
    d.upcoming.length ? h('span', { class: 'cal-up', title: d.upcoming.map((u) => u.recurrence.label).join(', ') }, icon('calendar', 'icon icon-sm'), d.upcoming.length) : null))));

  // Semaines les plus chargées
  const weekTotals = cal.weeks.map((w, i) => ({ i, cents: sumCents(w.filter(Boolean), (d) => d.expense), from: w.find(Boolean)?.date, to: [...w].reverse().find(Boolean)?.date }));
  const heaviest = [...weekTotals].filter((w) => w.cents > 0).sort((a, b) => b.cents - a.cents)[0];
  const monthTotal = sumCents(weekTotals, (w) => w.cents);

  if (state.selectedDay) queueMicrotask(() => showDay(state.selectedDay));
  else mount(detail, h('p', { class: 'subtle' }, 'Choisis un jour pour voir ses opérations.'));

  return {
    nodes: [h('div', { class: 'grid-2-1' },
      h('section', { class: 'card stack-sm' },
        h('div', { class: 'row-between wrap' }, h('h2', { class: 'card-title cap' }, formatMonth(month)),
          h('div', { class: 'row wrap fs-13 muted' }, h('span', { class: 'pos' }, 'Revenus'), h('span', {}, 'Dépenses (intensité)'), h('span', { class: 'row', style: { gap: '4px' } }, icon('calendar', 'icon icon-sm'), 'Échéance prévue'))),
        grid,
        heaviest ? h('p', { class: 'muted fs-13' }, `Semaine la plus chargée : du ${formatDate(heaviest.from, 'dayMonth')} au ${formatDate(heaviest.to, 'dayMonth')} (${formatMoney(heaviest.cents)}, soit ${formatPercent(Math.round((heaviest.cents * 1000) / monthTotal) / 10)} des dépenses du mois).`) : null),
      detail)],
  };
}

// ------------------------------------------------------------------ Analyse

async function analysis(ctx) {
  const analysisFrom = addMonths(state.from, -3);
  const [txs, movements, recurrences, budgets, accounts, settings, { byId }] = await Promise.all([
    listTransactionsForMonths(analysisFrom, state.to), listAllMovements(), listRecurrences(), listBudgets(), listSavingsAccounts(), getCachedSettings(), getCategories(),
  ]);
  const inPeriod = txs.filter((t) => t.month >= state.from && t.month <= state.to);
  const rows = monthlySummaries(inPeriod, movements, state.from, state.to);
  const withData = rows.filter((r) => r.incomeCount + r.expenseCount > 0);
  if (!withData.length) return { nodes: [periodPicker(ctx), h('section', { class: 'card' }, emptyState({ iconName: 'history', title: 'Aucune donnée sur la période', body: 'Choisis une autre période ou ajoute des opérations.' }))] };

  const top3 = topCategories(inPeriod, 3);
  const totalExp = sumCents(rows, (r) => r.expenses);
  const avgRate = averageSavingsRate(rows);
  const topMonths = topSpendingMonths(rows, 3);

  // Patrimoine (compte courant + épargne) en début et fin de période
  const all = ctx.all;
  const wealthAt = (iso) => {
    const bal = accountBalance(settings, iso, all, movements);
    const sav = totalSavingsOrNull(accounts, movements, iso);
    if (bal === null && sav === null) return null;
    return (bal ?? 0) + (sav ?? 0);
  };
  const startIso = addDays(monthBounds(state.from)[0], -1);
  const endIso = monthBounds(state.to)[1];
  const w0 = wealthAt(startIso);
  const w1 = wealthAt(endIso);

  const lastMonthWithData = withData[withData.length - 1].month;
  const summariesForInsights = monthlySummaries(txs, movements, analysisFrom, lastMonthWithData);
  const tips = insights({ month: lastMonthWithData, transactions: txs, summaries: summariesForInsights, budgets, recurrences, categoriesById: byId });

  const card = (title, ...body) => h('section', { class: 'card stack-sm' }, h('h2', { class: 'card-title' }, title), ...body);
  const nodes = [periodPicker(ctx),
    h('div', { class: 'kpi-grid' },
      kpi('Dépenses sur la période', formatMoney(totalExp), `${formatMoney(Math.round(totalExp / rows.length))} par mois en moyenne`),
      kpi('Revenus sur la période', formatMoney(sumCents(rows, (r) => r.income)), `${withData.length} mois avec des opérations`),
      kpi('Taux d\'épargne moyen', formatPercent(avgRate), 'Σ (revenus − dépenses) / Σ revenus'),
      kpi('Évolution du patrimoine', w0 !== null && w1 !== null ? formatMoney(w1 - w0, { sign: 'always' }) : '—',
        w0 !== null && w1 !== null ? `${formatMoney(w0, { compact: true })} → ${formatMoney(w1, { compact: true })}` : 'Solde de départ ou comptes d\'épargne nécessaires')),
    h('div', { class: 'grid-3' },
      card('Top 3 des catégories', top3.length ? h('ol', { class: 'rank-list' }, top3.map((r) => h('li', {},
        h('span', { class: 'cat ellipsis' }, h('i', { style: { background: categoryColor(byId.get(r.categoryId)?.color) } }), byId.get(r.categoryId)?.name ?? '?'),
        h('span', { class: 'num nowrap' }, h('b', {}, formatMoney(r.totalCents)), h('span', { class: 'subtle' }, ` ${formatPercent(Math.round((r.totalCents * 1000) / totalExp) / 10)}`))))) : h('p', { class: 'subtle' }, 'Aucune dépense.')),
      card('Mois les plus dépensiers', h('ol', { class: 'rank-list' }, topMonths.map((r) => h('li', {},
        h('a', { href: href('dashboard', { mois: r.month }), class: 'cap', style: { color: 'var(--ink)' } }, formatMonth(r.month)),
        h('span', { class: 'num nowrap' }, h('b', {}, formatMoney(r.expenses)), r.exceptional ? h('span', { class: 'subtle' }, ` dont ${formatMoney(r.exceptional, { compact: true })} except.`) : null))))),
      card('Taux d\'épargne par mois', h('div', { class: 'list-plain' }, rows.filter((r) => r.income > 0).slice(-6).map((r) => h('div', { class: 'line' },
        h('span', { class: 'muted cap' }, formatMonth(r.month, { short: true })),
        h('span', { class: ['num', r.savingsRate >= (avgRate ?? 0) ? 'pos' : 'neg'] }, formatPercent(r.savingsRate))))))),
    card(`Pistes d'amélioration (${formatMonth(lastMonthWithData)})`,
      tips.length ? h('div', { class: 'stack-sm' }, tips.map((t) => tipView(t, byId))) : h('p', { class: 'subtle' }, 'Rien de notable à signaler ce mois-ci, ou historique encore insuffisant (il faut au moins 2 à 3 mois de données).'),
      h('p', { class: 'subtle fs-13' }, 'Ces pistes sont calculées uniquement à partir de tes données, avec des règles fixes : catégorie supérieure de plus de 25 % à sa moyenne des 3 mois précédents, budget dépassé 3 mois de suite, dépenses fixes au-delà de 50 % des revenus, taux d\'épargne à ±5 points de ta moyenne, abonnements actifs.')),
  ];
  return { nodes };
}

function tipView(t, byId) {
  const d = t.detail;
  const text = {
    'fixed-share': () => `Tes dépenses fixes (${formatMoney(d.fixed)}) représentent ${formatPercent(d.share)} de tes revenus. Au-delà de 50 %, la marge pour épargner et absorber un imprévu devient faible : renégocier une assurance ou un forfait peut aider.`,
    'rate-up': () => `Ton taux d'épargne atteint ${formatPercent(d.rate)}, contre ${formatPercent(d.average)} en moyenne sur les mois précédents.`,
    'rate-down': () => `Ton taux d'épargne est de ${formatPercent(d.rate)}, contre ${formatPercent(d.average)} en moyenne sur les mois précédents.`,
    deficit: () => `Tes dépenses dépassent tes revenus de ${formatMoney(d.deficit)} ce mois-ci.`,
    subscriptions: () => `Coût total : ${formatMoney(d.monthly)} par mois, soit ${formatMoney(d.yearly)} par an (${d.items.map((x) => x.label).join(', ')}). Vérifie que chacun est encore utile.`,
    exceptional: () => `Les dépenses exceptionnelles (${formatMoney(d.exceptional)}) représentent ${formatPercent(d.share)} des dépenses du mois : la comparaison avec les autres mois est donc à nuancer.`,
  };
  let body;
  if (t.key.startsWith('cat-')) body = `${formatMoney(d.spent)} ce mois-ci contre ${formatMoney(d.average)} en moyenne sur les ${d.months} mois précédents (${formatPercent(d.pct, 1, { sign: 'always' })}).`;
  else if (t.key.startsWith('budget-')) body = 'Les dépenses ont dépassé ce budget trois mois consécutifs : soit le budget est trop bas par rapport à tes besoins réels, soit cette catégorie mérite une attention particulière.';
  else body = text[t.key]?.() ?? '';
  const iconName = t.tone === 'good' ? 'check' : t.tone === 'warn' ? 'alert' : 'info';
  return h('div', { class: ['alert', t.tone === 'warn' ? 'alert-warn' : t.tone === 'good' ? 'alert-good' : 'alert-info'] }, icon(iconName),
    h('div', {}, h('div', { class: 'alert-title' }, t.title), h('div', { class: 'alert-body' }, body)));
}

function kpi(label, value, foot) {
  return h('div', { class: 'card kpi' }, h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-value' }, value), h('span', { class: 'kpi-foot' }, foot));
}

function legend(color, label) {
  return h('span', { class: 'cat' }, h('i', { style: { background: color } }), label);
}

/** Montant ou tiret pour zéro (lisibilité des tableaux). */
function money0(cents) {
  return cents ? formatMoney(cents) : '—';
}
