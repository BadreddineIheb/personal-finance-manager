/**
 * report-data.js — Données et textes des rapports PDF. Fonctions pures (testées sous Node).
 * La mise en page (pdf-monthly.js, pdf-annual.js) ne fait qu'afficher ce qui est calculé ici.
 */
import { sumCents, percent, formatMoney, formatPercent, formatPoints } from '../core/money.js';
import { formatMonth, monthName, monthBounds, addMonths, monthRange, addDays } from '../core/dates.js';
import { summarizeMonth, accountBalance, variation } from '../domain/ledger.js';
import { totalsByCategory, totalsByIncomeType, sortTransactions } from '../domain/transactions.js';
import { totalSavingsAt, totalSavingsOrNull, goalProgress, summarizeMovements } from '../domain/savings.js';
import { budgetOverview } from '../domain/budgets.js';
import { averageSavingsRate, topSpendingMonths } from '../domain/analytics.js';

/**
 * @param {object} p
 * @param {string} p.month
 * @param {object[]} p.transactions  toutes les transactions (au moins depuis le solde de départ)
 * @param {object[]} p.movements     tous les mouvements d'épargne
 * @param {object[]} p.accounts, p.goals, p.budgets
 * @param {object} p.settings
 */
export function buildMonthlyReport({ month, transactions, movements, accounts = [], goals = [], budgets = [], settings = {}, categoriesById = new Map() }) {
  const categoryName = (id) => categoriesById.get(id)?.name ?? 'Catégorie supprimée';
  const prev = addMonths(month, -1);
  const [, end] = monthBounds(month);
  const cur = transactions.filter((t) => t.month === month);
  const before = transactions.filter((t) => t.month === prev);
  const s = summarizeMonth(cur, movements.filter((m) => m.month === month));
  const p = summarizeMonth(before, movements.filter((m) => m.month === prev));
  const hasPrevious = before.length > 0 || movements.some((m) => m.month === prev);
  const incomes = sortTransactions(cur.filter((t) => t.kind === 'income'), 'date', 'asc');
  const expenses = sortTransactions(cur.filter((t) => t.kind === 'expense'), 'date', 'asc');
  const byCategory = totalsByCategory(expenses).map((r) => ({ ...r, count: r.count }));
  const byIncomeType = Object.entries(totalsByIncomeType(incomes)).sort((a, b) => b[1] - a[1]);
  const balance = accountBalance(settings, end, transactions, movements);
  const savingsTotal = accounts.length ? totalSavingsAt(accounts, movements, end) : null;
  const mv = summarizeMovements(movements.filter((m) => m.month === month));
  const budget = budgetOverview(budgets, cur, month);
  const goalRows = goals.filter((g) => !g.archived).map((g) => ({ goal: g, ...goalProgress(g, movements, end) }));

  const comparison = [
    ['Revenus', s.income, p.income, 'up'], ['Dépenses fixes', s.fixed, p.fixed, 'down'], ['Dépenses variables', s.variable, p.variable, 'down'],
    ['Dépenses exceptionnelles', s.exceptional, p.exceptional, 'down'], ['Total des dépenses', s.expenses, p.expenses, 'down'],
    ['Excédent', s.surplus, p.surplus, 'up'], ['Épargne réalisée', s.saved, p.saved, 'up'],
  ].map(([label, current, previous, better]) => ({ label, current, previous, better, ...variation(current, previous) }));

  return {
    month, prev, hasPrevious, s, p, incomes, expenses, byCategory, byIncomeType, balance, savingsTotal,
    movements: mv, budget, goals: goalRows, comparison,
    exceptional: expenses.filter((t) => t.expenseType === 'exceptional'),
    summary: monthlySummaryText({ month, prev, s, p, hasPrevious, byCategory, balance, savingsTotal, categoryName }),
    categoryName,
  };
}

/** Résumé rédigé du mois, uniquement à partir des chiffres (aucune donnée inventée). */
export function monthlySummaryText({ month, prev, s, p, hasPrevious, byCategory, balance, savingsTotal, categoryName = (id) => id }) {
  const out = [];
  const m = formatMonth(month);
  if (s.incomeCount + s.expenseCount === 0) return [`Aucune opération n'a été enregistrée en ${m}.`];
  let first = `En ${m}, les revenus s'élèvent à ${formatMoney(s.income)} et les dépenses à ${formatMoney(s.expenses)}`;
  if (hasPrevious && p.expenses > 0) {
    const v = variation(s.expenses, p.expenses);
    first += v.diff === 0 ? `, un niveau identique à ${monthName(prev)}` : ` (${formatPercent(v.pct, 1, { sign: 'always' })} par rapport à ${monthName(prev)})`;
  }
  out.push(`${first}.`);
  if (s.income > 0) {
    out.push(s.surplus >= 0
      ? `Le mois dégage un excédent de ${formatMoney(s.surplus)}, soit un taux d'épargne de ${formatPercent(s.savingsRate)}.`
      : `Les dépenses dépassent les revenus de ${formatMoney(-s.surplus)}.`);
    if (hasPrevious && p.savingsRate !== null && s.savingsRate !== null && p.savingsRate !== s.savingsRate) {
      out.push(`Le taux d'épargne ${s.savingsRate > p.savingsRate ? 'progresse' : 'recule'} de ${formatPoints(Math.abs(Math.round((s.savingsRate - p.savingsRate) * 10) / 10)).replace(/^\+/, '')} par rapport au mois précédent.`);
    }
  }
  if (s.saved > 0) out.push(`${formatMoney(s.saved)} ont été virés vers l'épargne.`);
  else if (s.saved < 0) out.push(`${formatMoney(-s.saved)} ont été retirés de l'épargne (retraits supérieurs aux versements).`);
  if (s.exceptional > 0) out.push(`Les dépenses exceptionnelles (${formatMoney(s.exceptional)}) représentent ${formatPercent(percent(s.exceptional, s.expenses))} des dépenses du mois.`);
  if (byCategory.length) out.push(`Le premier poste de dépenses est « ${categoryName(byCategory[0].categoryId)} » (${formatMoney(byCategory[0].totalCents)}, ${formatPercent(byCategory[0].percent)}).`);
  if (balance !== null) out.push(`Le solde du compte courant en fin de mois est de ${formatMoney(balance)}${savingsTotal !== null ? ` et l'épargne totale de ${formatMoney(savingsTotal)}` : ''}.`);
  return out;
}

/**
 * Rapport annuel.
 */
export function buildAnnualReport({ year, transactions, movements, accounts = [], goals = [], settings = {}, categoriesById = new Map(), today = null }) {
  const categoryName = (id) => categoriesById.get(id)?.name ?? 'Catégorie supprimée';
  const months = monthRange(`${year}-01`, `${year}-12`);
  // Pour l'année en cours, pas de solde ni de patrimoine pour les mois qui ne sont pas encore commencés
  const currentMonth = today ? today.slice(0, 7) : null;
  const rows = months.map((month) => {
    const s = summarizeMonth(transactions.filter((t) => t.month === month), movements.filter((m) => m.month === month));
    const end = monthBounds(month)[1];
    const future = currentMonth && month > currentMonth;
    const balance = future ? null : accountBalance(settings, end, transactions, movements);
    const savings = future ? null : totalSavingsOrNull(accounts, movements, end);
    return { month, ...s, balance, savings, wealth: balance === null && savings === null ? null : (balance ?? 0) + (savings ?? 0) };
  });
  const active = rows.filter((r) => r.incomeCount + r.expenseCount > 0);
  const sum = (k) => sumCents(rows, (r) => r[k]);
  const totals = {
    income: sum('income'), fixed: sum('fixed'), variable: sum('variable'), exceptional: sum('exceptional'),
    expenses: sum('expenses'), surplus: sum('surplus'), saved: sum('saved'), interest: sum('interest'),
  };
  const yearTx = transactions.filter((t) => t.month >= `${year}-01` && t.month <= `${year}-12`);
  const byCategory = totalsByCategory(yearTx.filter((t) => t.kind === 'expense'));
  const startIso = addDays(`${year}-01-01`, -1);
  const wealthAt = (iso) => {
    const b = accountBalance(settings, iso, transactions, movements);
    const sv = totalSavingsOrNull(accounts, movements, iso);
    return b === null && sv === null ? null : (b ?? 0) + (sv ?? 0);
  };
  // Patrimoine de départ : au 1er janvier, ou à défaut à la fin du premier mois suivi de l'année
  let wealthStart = wealthAt(startIso);
  let wealthStartLabel = null;
  if (wealthStart === null) {
    const firstKnown = rows.find((x) => x.wealth !== null);
    if (firstKnown) { wealthStart = firstKnown.wealth; wealthStartLabel = formatMonth(firstKnown.month); }
  }
  const endIso = today && today < `${year}-12-31` ? monthBounds(currentMonth)[1] : `${year}-12-31`;
  const wealthEnd = wealthAt(endIso);
  const wealthEndLabel = endIso === `${year}-12-31` ? null : formatMonth(currentMonth);
  const avgRate = averageSavingsRate(rows);
  const top = topSpendingMonths(rows, 3);
  const goalRows = goals.filter((g) => !g.archived).map((g) => ({ goal: g, ...goalProgress(g, movements, `${year}-12-31`) }));
  return {
    year, rows, active, totals, byCategory, avgRate, topMonths: top, wealthStart, wealthStartLabel, wealthEnd, wealthEndLabel, goals: goalRows,
    averages: active.length ? Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v / active.length)])) : null,
    summary: annualSummaryText({ year, totals, active, avgRate, top, wealthStart, wealthStartLabel, wealthEnd, wealthEndLabel, byCategory, categoryName }),
    categoryName,
  };
}

export function annualSummaryText({ year, totals, active, avgRate, top, wealthStart, wealthStartLabel = null, wealthEnd, wealthEndLabel = null, byCategory, categoryName = (id) => id }) {
  if (!active.length) return [`Aucune opération n'a été enregistrée en ${year}.`];
  const out = [];
  out.push(`En ${year}, ${active.length} mois comportent des opérations. Les revenus totalisent ${formatMoney(totals.income)} et les dépenses ${formatMoney(totals.expenses)}, soit en moyenne ${formatMoney(Math.round(totals.expenses / active.length))} de dépenses par mois.`);
  if (avgRate !== null) out.push(`L'excédent cumulé atteint ${formatMoney(totals.surplus)}, pour un taux d'épargne moyen de ${formatPercent(avgRate)}.`);
  if (totals.saved) out.push(`${formatMoney(totals.saved)} ont été virés vers l'épargne sur l'année${totals.interest ? `, et ${formatMoney(totals.interest)} d'intérêts ont été perçus` : ''}.`);
  if (top.length) out.push(`Le mois le plus dépensier est ${formatMonth(top[0].month)} (${formatMoney(top[0].expenses)}).`);
  if (byCategory.length) out.push(`Le premier poste de dépenses de l'année est « ${categoryName(byCategory[0].categoryId)} » (${formatPercent(byCategory[0].percent)} des dépenses).`);
  if (wealthStart !== null && wealthEnd !== null) out.push(`Le patrimoine financier passe de ${formatMoney(wealthStart)}${wealthStartLabel ? ` (fin ${wealthStartLabel}, début du suivi)` : ''} à ${formatMoney(wealthEnd)} ${wealthEndLabel ? `fin ${wealthEndLabel}` : 'au 31 décembre'} (${formatMoney(wealthEnd - wealthStart, { sign: 'always' })}).`);
  return out;
}

/**
 * Texte compatible avec les polices standard des PDF (encodage WinAnsi) :
 * espaces insécables → espaces, signe moins typographique → tiret, flèches et symboles hors jeu remplacés.
 */
export function pdfText(str) {
  return String(str ?? '')
    .replace(/[   ]/g, ' ')
    .replace(/−/g, '-')
    .replace(/→/g, '->')
    .replace(/≥/g, '>=').replace(/≤/g, '<=')
    .replace(/[‘’]/g, "'")
    .replace(/Σ/g, 'Somme');
}
