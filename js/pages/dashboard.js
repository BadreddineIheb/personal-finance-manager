/**
 * dashboard.js — Tableau de bord du mois consulté.
 * Indicateurs (revenus, dépenses par type, épargne réalisée, solde, taux) avec comparaison au mois
 * précédent, tendance globale, graphiques (revenus vs dépenses, catégories, épargne et patrimoine),
 * comparaison détaillée M / M-1, dernières opérations, plus grosses dépenses, prochaines échéances.
 */
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { listTransactionsBetween, listAllMovements, listSavingsAccounts, listRecurrences, listBudgets } from '../data/repository.js';
import { budgetOverview } from '../domain/budgets.js';
import { forecastMonth } from '../domain/forecast.js';
import { budgetLine, budgetAlerts, forecastCard } from '../ui/components/budget-widgets.js';
import { averageVariable } from './budgets.js';
import { backupReminder } from '../ui/components/backup-ui.js';
import { listAllTransactions } from '../data/repository.js';
import { summarizeMonth, accountBalance, variation } from '../domain/ledger.js';
import { totalSavingsAt } from '../domain/savings.js';
import { upcomingOccurrences } from '../domain/recurrence.js';
import { computeTrend } from '../domain/trend.js';
import { totalsByCategory, topTransactions, sortTransactions } from '../domain/transactions.js';
import { formatMoney, formatPercent, formatPoints } from '../core/money.js';
import { formatMonth, addMonths, monthBounds, formatDate, monthName, todayISO, addDays, monthRange } from '../core/dates.js';
import { categoryColor } from '../data/schema.js';
import { getCategories, getCachedSettings } from '../ui/cache.js';
import { pageHead, kpiCard, delta, emptyState } from '../ui/components/widgets.js';
import { transactionRow } from '../ui/components/transaction-row.js';
import { openTransactionForm } from '../ui/components/transaction-form.js';
import { incomeExpenseChart, donutChart, lineChart } from '../ui/charts.js';
import { href } from '../ui/router.js';

/** Période du graphique revenus / dépenses, conservée pendant la session. */
let chartMonths = 6;
const DONUT_SLICES = 5;

export async function render(view, { month }) {
  const firstMonth = addMonths(month, -11);
  const prevMonth = addMonths(month, -1);
  const [mStart, mEnd] = monthBounds(month);
  const [{ byId }, settings, movements, accounts, recurrences, budgets] = await Promise.all([
    getCategories(), getCachedSettings(), listAllMovements(), listSavingsAccounts(), listRecurrences(), listBudgets(),
  ]);
  // Transactions : 12 mois glissants, et depuis le solde de départ si celui-ci est plus ancien
  const from = settings.openingBalanceDate && settings.openingBalanceDate < monthBounds(firstMonth)[0] ? settings.openingBalanceDate : monthBounds(firstMonth)[0];
  const txs = await listTransactionsBetween(from, mEnd);

  const months = monthRange(firstMonth, month);
  const byMonth = new Map(months.map((k) => [k, summarizeMonth(txs.filter((t) => t.month === k), movements.filter((m) => m.month === k))]));
  const s = byMonth.get(month);
  const p = byMonth.get(prevMonth);
  const current = txs.filter((t) => t.month === month);
  const movCurrent = movements.filter((m) => m.month === month);
  const hasPrev = p.incomeCount + p.expenseCount > 0 || movements.some((m) => m.month === prevMonth);

  const balanceAt = (iso) => accountBalance(settings, iso, txs, movements);
  const balance = balanceAt(mEnd);
  const prevBalance = balanceAt(monthBounds(prevMonth)[1]);
  const savingsTotal = accounts.length ? totalSavingsAt(accounts, movements, mEnd) : null;
  const trend = computeTrend(s, months.slice(0, -1).map((k) => byMonth.get(k)));

  const add = (kind) => openTransactionForm({ kind, month });
  const head = pageHead('Tableau de bord', formatMonth(month),
    trendPill(trend),
    h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => add('income') }, icon('plus'), 'Revenu'),
    h('button', { class: 'btn btn-primary', type: 'button', onClick: () => add('expense') }, icon('plus'), 'Dépense'));

  if (!current.length && !movCurrent.length) {
    mount(view, head, h('section', { class: 'card' }, emptyState({
      iconName: 'wallet',
      title: `Aucune opération en ${formatMonth(month)}`,
      body: settings.openingBalanceDate
        ? 'Ajoute tes revenus et tes dépenses du mois : les indicateurs et graphiques se calculent automatiquement.'
        : 'Commence par renseigner le solde actuel de ton compte courant dans les Paramètres, puis ajoute tes revenus et dépenses.',
      actions: [
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => add('expense') }, icon('plus'), 'Ajouter une dépense'),
        h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => add('income') }, icon('plus'), 'Ajouter un revenu'),
        !settings.openingBalanceDate ? h('a', { class: 'btn btn-ghost', href: href('parametres') }, 'Définir le solde de départ') : null,
      ],
    })));
    return undefined;
  }

  const cleanups = [];
  const vs = `vs ${monthName(prevMonth, { short: true })}`;
  const foot = (node) => (node.textContent === 'Pas de comparaison' ? [node] : [node, h('span', {}, vs)]);

  // ---------- Indicateurs ----------
  const kpis1 = h('div', { class: 'kpi-grid' },
    kpiCard({ label: 'Revenus', value: formatMoney(s.income), foot: foot(delta(s.income, p.income, { better: 'up', hasPrevious: hasPrev })) }),
    kpiCard({ label: 'Total dépenses', value: formatMoney(s.expenses), foot: foot(delta(s.expenses, p.expenses, { better: 'down', hasPrevious: hasPrev })) }),
    kpiCard({ label: 'Épargne réalisée', value: formatMoney(s.saved), title: 'Versements − retraits d\'épargne du mois (argent réellement mis de côté).',
      foot: foot(delta(s.saved, p.saved, { better: 'up', hasPrevious: hasPrev })) }),
    kpiCard({ label: 'Solde disponible', value: balance === null ? '—' : formatMoney(balance),
      title: 'Solde du compte courant en fin de mois : solde de départ + revenus − dépenses − versements d\'épargne + retraits, depuis la date du solde de départ.',
      foot: balance === null ? h('a', { class: 'card-link', href: href('parametres') }, 'Définir le solde de départ') : foot(delta(balance, prevBalance, { better: 'up', hasPrevious: prevBalance !== null })) }));

  const kpis2 = h('div', { class: 'kpi-grid' },
    kpiCard({ small: true, label: 'Dépenses fixes', swatch: 'var(--type-fixed)', value: formatMoney(s.fixed), foot: foot(delta(s.fixed, p.fixed, { better: 'down', hasPrevious: hasPrev })) }),
    kpiCard({ small: true, label: 'Dépenses variables', swatch: 'var(--type-variable)', value: formatMoney(s.variable), foot: foot(delta(s.variable, p.variable, { better: 'down', hasPrevious: hasPrev })) }),
    kpiCard({ small: true, label: 'Exceptionnelles', swatch: 'var(--type-exceptional)', value: formatMoney(s.exceptional), foot: foot(delta(s.exceptional, p.exceptional, { better: 'down', hasPrevious: hasPrev })) }),
    kpiCard({ small: true, label: 'Taux d\'épargne', value: formatPercent(s.savingsRate), title: '(Revenus − dépenses) / revenus',
      foot: foot(delta(s.savingsRate, p.savingsRate, { kind: 'rate', better: 'up', hasPrevious: hasPrev && p.savingsRate !== null && s.savingsRate !== null })) }));

  // ---------- Revenus vs dépenses ----------
  const barBox = h('div', { class: 'chart chart-bars' });
  const barTable = h('div', { class: 'sr-only' });
  const periodSeg = h('div', { class: 'seg', role: 'group', aria: { label: 'Période du graphique' } },
    [6, 12].map((n) => h('button', { type: 'button', dataset: { months: String(n) }, aria: { pressed: String(chartMonths === n) }, onClick: () => {
      chartMonths = n; drawBars();
      for (const b of periodSeg.children) b.setAttribute('aria-pressed', String(b.dataset.months === String(n)));
    } }, `${n} mois`)));
  let bars = null;
  function drawBars() {
    bars?.destroy();
    const ks = months.slice(-chartMonths);
    const labels = ks.map((k, i) => `${monthName(k, { short: true })}${k.endsWith('-01') || i === 0 ? ` ${k.slice(2, 4)}` : ''}`);
    const income = ks.map((k) => byMonth.get(k).income);
    const expensesSeries = ks.map((k) => byMonth.get(k).expenses);
    bars = incomeExpenseChart(barBox, { labels, income, expenses: expensesSeries });
    barBox.setAttribute('role', 'img');
    barBox.setAttribute('aria-label', `Revenus et dépenses sur ${chartMonths} mois`);
    mount(barTable, dataTable(['Mois', 'Revenus', 'Dépenses'], ks.map((k, i) => [formatMonth(k), formatMoney(income[i]), formatMoney(expensesSeries[i])])));
  }
  drawBars();
  cleanups.push(() => bars?.destroy());
  const last6 = months.slice(-6);
  const avgIncome = Math.round(last6.reduce((a, k) => a + byMonth.get(k).income, 0) / 6);
  const avgExpenses = Math.round(last6.reduce((a, k) => a + byMonth.get(k).expenses, 0) / 6);
  const barsCard = h('section', { class: 'card stack-sm' },
    h('div', { class: 'card-head', style: { marginBottom: 0 } }, h('h2', { class: 'card-title' }, 'Revenus vs dépenses'), periodSeg),
    barBox, barTable,
    h('div', { class: 'row-between wrap fs-13' },
      h('div', { class: 'row wrap muted' }, legendDot('var(--positive)', 'Revenus'), legendDot('var(--ink-3)', 'Dépenses')),
      h('span', { class: 'subtle' }, `Moyenne sur 6 mois : ${formatMoney(avgIncome, { compact: true })} de revenus, ${formatMoney(avgExpenses, { compact: true })} de dépenses`)));

  // ---------- Dépenses par catégorie ----------
  const expenses = current.filter((t) => t.kind === 'expense');
  const rows = totalsByCategory(expenses);
  const top = rows.slice(0, DONUT_SLICES);
  const rest = rows.slice(DONUT_SLICES);
  const slices = top.map((r) => ({ label: byId.get(r.categoryId)?.name ?? 'Catégorie supprimée', cents: r.totalCents, pct: r.percent, color: categoryColor(byId.get(r.categoryId)?.color) }));
  if (rest.length) {
    slices.push({ label: `Autres (${rest.length})`, cents: rest.reduce((a, r) => a + r.totalCents, 0), pct: Math.round(rest.reduce((a, r) => a + r.percent * 10, 0)) / 10, color: 'var(--cat-other)' });
  }
  const donutBox = h('div', { class: 'chart chart-donut', role: 'img', aria: { label: `Répartition des dépenses de ${formatMonth(month)} par catégorie` } });
  const donutCard = h('section', { class: 'card stack-sm' },
    h('div', { class: 'row-between' }, h('h2', { class: 'card-title' }, 'Dépenses par catégorie'), h('a', { class: 'card-link', href: href('depenses') }, 'Détail')),
    slices.length
      ? h('div', { class: 'donut-layout' }, donutBox,
        h('ul', { class: 'donut-legend' }, slices.map((x) => h('li', {},
          h('span', { class: 'cat ellipsis' }, h('i', { style: { background: x.color } }), x.label),
          h('span', { class: 'num nowrap' }, h('span', { class: 'fw-600' }, formatMoney(x.cents, { compact: true })), h('span', { class: 'subtle' }, ` ${formatPercent(x.pct)}`))))))
      : h('p', { class: 'subtle' }, 'Aucune dépense ce mois-ci.'));
  if (slices.length) {
    const d = donutChart(donutBox, { labels: slices.map((x) => x.label), values: slices.map((x) => x.cents), colors: slices.map((x) => x.color), percents: slices.map((x) => x.pct), centerLabel: ['Total', formatMoney(s.expenses, { compact: true })] });
    cleanups.push(() => d.destroy());
  }

  // ---------- Épargne et patrimoine ----------
  const lineBox = h('div', { class: 'chart chart-line' });
  // Pas de point avant l'ouverture du premier compte d'épargne / avant le solde de départ
  const firstOpening = accounts.reduce((min, a) => (a.openingDate < min ? a.openingDate : min), '9999-12-31');
  const allSavings = months.map((k) => (accounts.length && monthBounds(k)[1] >= firstOpening ? totalSavingsAt(accounts, movements, monthBounds(k)[1]) : null));
  const allBalance = months.map((k) => balanceAt(monthBounds(k)[1]));
  const startIdx = Math.max(0, months.findIndex((k, i) => allSavings[i] !== null || allBalance[i] !== null));
  const lineMonths = months.slice(startIdx);
  const savingsSeries = allSavings.slice(startIdx);
  const balanceSeries = allBalance.slice(startIdx);
  const wealthSeries = lineMonths.map((k, i) => (balanceSeries[i] === null ? null : balanceSeries[i] + (savingsSeries[i] ?? 0)));
  const series = [];
  if (wealthSeries.some((v) => v !== null)) series.push({ label: 'Patrimoine', values: wealthSeries, color: '--accent' });
  if (accounts.length) series.push({ label: 'Épargne totale', values: savingsSeries, color: '--positive' });
  if (balanceSeries.some((v) => v !== null)) series.push({ label: 'Compte courant', values: balanceSeries, color: '--ink-3', dashed: true });
  const lineCard = h('section', { class: 'card stack-sm' },
    h('div', { class: 'card-head', style: { marginBottom: 0 } }, h('h2', { class: 'card-title' }, 'Épargne et patrimoine'),
      savingsTotal !== null ? h('span', { class: 'muted fs-13 num' }, 'Épargne totale ', h('b', { style: { color: 'var(--ink)' } }, formatMoney(savingsTotal))) : null),
    series.length
      ? [lineBox, h('div', { class: 'row wrap fs-13 muted' }, series.map((x) => legendDot(`var(${x.color})`, x.label, x.dashed))),
        h('div', { class: 'sr-only' }, dataTable(['Mois', ...series.map((x) => x.label)], lineMonths.map((k, i) => [formatMonth(k), ...series.map((x) => (x.values[i] === null ? '—' : formatMoney(x.values[i])))])))]
      : emptyState({ iconName: 'piggy', title: 'Pas encore de courbe', body: 'Définis le solde de départ de ton compte courant (Paramètres) et ajoute tes comptes d\'épargne pour suivre ton patrimoine.',
        actions: [h('a', { class: 'btn btn-secondary btn-sm', href: href('epargne') }, 'Ajouter un compte d\'épargne')] }));
  if (series.length) {
    const l = lineChart(lineBox, { labels: lineMonths.map((k) => `${monthName(k, { short: true })} ${k.slice(2, 4)}`), series });
    lineBox.setAttribute('role', 'img');
    lineBox.setAttribute('aria-label', `Évolution du patrimoine, de l'épargne et du compte courant sur ${lineMonths.length} mois`);
    cleanups.push(() => l.destroy());
  }

  // ---------- Bilan du mois ----------
  const summary = h('section', { class: 'card stack-sm' },
    h('h2', { class: 'card-title' }, 'Bilan du mois'),
    h('div', { class: 'list-plain' },
      line('Revenus', formatMoney(s.income, { sign: 'always' }), 'pos'),
      line('Dépenses', formatMoney(-s.expenses)),
      h('hr', { class: 'divider' }),
      line('Excédent (revenus − dépenses)', formatMoney(s.surplus, { sign: 'always' }), s.surplus >= 0 ? 'pos' : 'neg', true),
      line('Épargne virée', formatMoney(-s.saved)),
      line('Reste sur le compte', formatMoney(s.remaining, { sign: 'always' }), s.remaining >= 0 ? 'pos' : 'neg', true),
      h('hr', { class: 'divider' }),
      balance !== null ? line(`Solde du compte au ${formatDate(mEnd, 'dayMonth')}`, formatMoney(balance), null, true) : null,
      savingsTotal !== null ? line('Épargne totale', formatMoney(savingsTotal), null, true) : null,
      s.interest ? line('Intérêts perçus', formatMoney(s.interest, { sign: 'always' }), 'pos') : null,
      balance !== null && savingsTotal !== null ? line('Patrimoine financier', formatMoney(balance + savingsTotal), null, true) : null,
      line('Opérations', `${s.incomeCount} revenu${s.incomeCount > 1 ? 's' : ''} · ${s.expenseCount} dépense${s.expenseCount > 1 ? 's' : ''}`)));

  // ---------- Comparaison avec le mois précédent ----------
  const cmpRows = [
    ['Revenus', s.income, p.income, 'up'], ['Dépenses fixes', s.fixed, p.fixed, 'down'], ['Dépenses variables', s.variable, p.variable, 'down'],
    ['Dépenses exceptionnelles', s.exceptional, p.exceptional, 'down'], ['Total dépenses', s.expenses, p.expenses, 'down'],
    ['Excédent', s.surplus, p.surplus, 'up'], ['Épargne réalisée', s.saved, p.saved, 'up'],
  ];
  const rateDiff = s.savingsRate !== null && p.savingsRate !== null ? Math.round((s.savingsRate - p.savingsRate) * 10) / 10 : null;
  const compareCard = h('section', { class: 'card stack-sm' },
    h('h2', { class: 'card-title' }, `Comparaison avec ${monthName(prevMonth)}`),
    hasPrev
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'right cap' }, monthName(prevMonth, { short: true })), h('th', { class: 'right cap' }, monthName(month, { short: true })), h('th', { class: 'right' }, 'Écart'))),
        h('tbody', {},
          cmpRows.map(([label, cur, prev, better]) => {
            const v = variation(cur, prev);
            const tone = v.diff === 0 ? 'subtle' : (v.diff > 0) === (better === 'up') ? 'pos' : 'neg';
            return h('tr', {}, h('td', {}, label), h('td', { class: 'right num muted' }, formatMoney(prev)), h('td', { class: 'right num fw-600' }, formatMoney(cur)),
              h('td', { class: ['right', 'num', tone] }, v.diff === 0 ? '—' : [formatMoney(v.diff, { sign: 'always' }),
                v.pct !== null ? h('span', { class: 'cell-sub' }, formatPercent(v.pct, 1, { sign: 'always' })) : null]));
          }),
          h('tr', {}, h('td', {}, 'Taux d\'épargne'), h('td', { class: 'right num muted' }, formatPercent(p.savingsRate)), h('td', { class: 'right num fw-600' }, formatPercent(s.savingsRate)),
            h('td', { class: ['right', 'num', rateDiff === null || rateDiff === 0 ? 'subtle' : rateDiff > 0 ? 'pos' : 'neg'] }, rateDiff === null || rateDiff === 0 ? '—' : formatPoints(rateDiff))))))
      : h('p', { class: 'subtle' }, `Aucune donnée en ${formatMonth(prevMonth)} pour comparer.`));

  // ---------- Listes ----------
  const open = (t) => openTransactionForm({ record: t, month });
  const latest = sortTransactions(current, 'date', 'desc').slice(0, 6);
  const latestCard = h('section', { class: 'card stack-sm' },
    h('div', { class: 'row-between' }, h('h2', { class: 'card-title' }, 'Dernières opérations'), h('a', { class: 'card-link', href: href('depenses') }, 'Tout voir')),
    latest.length ? h('div', { class: 'tx-list' }, latest.map((t) => transactionRow(t, { categories: byId, onOpen: open, actions: false }))) : h('p', { class: 'subtle' }, 'Aucune opération ce mois-ci.'));

  const biggest = topTransactions(expenses, 5);
  const topCard = h('section', { class: 'card stack-sm' },
    h('h2', { class: 'card-title' }, 'Plus grosses dépenses'),
    biggest.length
      ? h('div', { class: 'list-plain' }, biggest.map((t) => h('div', { class: 'line' },
        h('a', { href: '#', class: 'ellipsis', style: { color: 'var(--ink)', textDecoration: 'none' }, onClick: (e) => { e.preventDefault(); open(t); } },
          t.label, t.expenseType === 'exceptional' ? h('span', { class: 'badge badge-exceptional', style: { marginLeft: '6px' } }, h('span', { class: 'dot' }), 'Exc.') : null),
        h('span', { class: 'num fw-600 nowrap' }, formatMoney(t.amountCents)))))
      : h('p', { class: 'subtle' }, 'Aucune dépense ce mois-ci.'));

  // ---------- Budgets et estimation ----------
  const overview = budgetOverview(budgets, current, month);
  const budgetRows = [...(overview.global ? [{ label: 'Budget global', st: overview.global }] : []),
    ...overview.categories.slice(0, 4).map((c) => ({ label: byId.get(c.categoryId)?.name ?? '?', color: categoryColor(byId.get(c.categoryId)?.color), st: c }))];
  const budgetsCard = h('section', { class: 'card stack-sm' },
    h('div', { class: 'row-between' }, h('h2', { class: 'card-title' }, 'Budgets'), h('a', { class: 'card-link', href: href('budgets') }, budgetRows.length ? 'Tout voir' : 'Définir')),
    budgetRows.length
      ? h('div', { class: 'budget-list' }, budgetRows.map((r) => budgetLine({ ...r, compact: true })))
      : h('p', { class: 'subtle' }, 'Aucun budget défini. Fixe un budget global ou par catégorie pour être alerté à 80 % et 100 %.'));
  const today = todayISO();
  const forecast = forecastMonth({ month, today, transactions: current, recurrences, averageVariableCents: month > today.slice(0, 7) ? await averageVariable(today) : 0 });

  const tomorrow = addDays(todayISO(), 1);
  const upFrom = tomorrow > mStart ? tomorrow : mStart;
  const upcoming = upFrom <= mEnd ? upcomingOccurrences(recurrences, upFrom, mEnd) : [];
  const upcomingCard = h('section', { class: 'card stack-sm' },
    h('div', { class: 'row-between' }, h('h2', { class: 'card-title' }, 'Prochaines échéances'),
      h('a', { class: 'card-link', href: href('depenses', { onglet: 'recurrents' }) }, 'Gérer')),
    !recurrences.length
      ? h('p', { class: 'subtle' }, 'Aucune opération récurrente. Ajoute ton loyer, ton salaire ou tes abonnements pour les voir ici.')
      : upcoming.length
        ? h('div', { class: 'list-plain' }, upcoming.slice(0, 6).map((u) => h('div', { class: 'line' },
          h('span', { class: 'ellipsis' }, h('span', { class: 'subtle num' }, `${formatDate(u.date, 'dayMonth')} · `), u.recurrence.label),
          h('span', { class: ['num', 'nowrap', u.recurrence.kind === 'income' && 'pos'] },
            formatMoney(u.recurrence.kind === 'income' ? u.recurrence.amountCents : -u.recurrence.amountCents, { sign: u.recurrence.kind === 'income' ? 'always' : 'auto' })))),
        upcoming.length > 6 ? h('p', { class: 'subtle fs-13' }, `et ${upcoming.length - 6} autre(s)`) : null)
        : h('p', { class: 'subtle' }, upFrom > mEnd ? 'Mois terminé : toutes les échéances ont été enregistrées.' : 'Aucune autre échéance ce mois-ci.'));

  const operationCount = (await listAllTransactions()).length;
  mount(view, head, backupReminder(settings, operationCount), budgetAlerts(overview, byId, { link: href('budgets') }), kpis1, kpis2,
    h('div', { class: 'grid-2-1' }, barsCard, donutCard),
    h('div', { class: 'grid-2-1' }, lineCard, summary),
    h('div', { class: 'grid-3' }, budgetsCard, forecastCard(forecast, { month }), upcomingCard),
    h('div', { class: 'grid-2' }, compareCard, h('div', { class: 'stack' }, latestCard, topCard)));

  return () => cleanups.forEach((fn) => fn());
}

// ------------------------------------------------------------------ Aides d'affichage

function line(label, value, tone = null, strong = false) {
  return h('div', { class: 'line' }, h('span', { class: 'muted' }, label), h('span', { class: ['num', 'nowrap', tone, strong && 'fw-600'] }, value));
}

function legendDot(color, label, dashed = false) {
  return h('span', { class: 'cat' }, h('i', { style: dashed ? { background: 'transparent', border: `2px dashed ${color}`, width: '10px', height: '10px', boxSizing: 'border-box' } : { background: color } }), label);
}

/** Tableau équivalent pour les lecteurs d'écran. */
function dataTable(headers, rows) {
  return h('table', {}, h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))));
}

/** Pastille de tendance ; la règle et le détail des signaux s'affichent au survol / au focus. */
function trendPill(trend) {
  if (trend.status === 'unknown') {
    return h('span', { class: 'trend stable', tabindex: '0', title: 'La tendance compare le mois à la moyenne des 3 mois précédents : il faut au moins un mois précédent avec des données.' }, 'Tendance : historique insuffisant');
  }
  const labels = { up: 'Situation en amélioration', stable: 'Situation stable', down: 'Situation en dégradation' };
  const sym = (v) => (v > 0 ? '▲' : v < 0 ? '▼' : '•');
  const detail = trend.signals.map((x) => {
    if (x.key === 'rate') return `${sym(x.value)} Taux d'épargne ${formatPercent(x.detail.current)} (moyenne ${formatPercent(x.detail.average)})`;
    if (x.key === 'expenses') return `${sym(x.value)} Dépenses ${formatMoney(x.detail.current, { compact: true })} (moyenne ${formatMoney(x.detail.average, { compact: true })})`;
    return `${sym(x.value)} Patrimoine ${formatMoney(x.detail.current, { sign: 'always', compact: true })} sur le mois`;
  }).join('\n');
  return h('span', {
    class: ['trend', trend.status], tabindex: '0',
    title: `Comparaison avec la moyenne des 3 mois précédents :\n${detail}\nScore ${trend.score > 0 ? '+' : ''}${trend.score} (amélioration à partir de +2, dégradation à partir de −2)`,
  }, icon(trend.status === 'up' ? 'trendUp' : trend.status === 'down' ? 'trendDown' : 'minus', 'icon icon-sm'), labels[trend.status]);
}
