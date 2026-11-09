/**
 * analytics.js — Analyse sur une période : séries mensuelles, catégories principales, taux d'épargne
 * moyen, mois les plus dépensiers, calendrier, et pistes d'amélioration. Fonctions pures.
 *
 * Les pistes d'amélioration sont produites par des règles explicites, uniquement à partir des données
 * saisies. Chaque piste donne les chiffres qui la justifient ; aucune n'est affichée sans données suffisantes.
 */
import { sumCents, percent } from '../core/money.js';
import { monthRange, parseISO, daysInMonth, toISO, weekdayIndex } from '../core/dates.js';
import { summarizeMonth } from './ledger.js';
import { totalsByCategory } from './transactions.js';
import { resolveBudgets, spentByCategory } from './budgets.js';
import { monthlyEquivalentCents } from './recurrence.js';

/** Résumé mensuel (summarizeMonth) pour chaque mois de la plage. */
export function monthlySummaries(transactions, movements, fromMonth, toMonth) {
  return monthRange(fromMonth, toMonth).map((month) => ({
    month,
    ...summarizeMonth(transactions.filter((t) => t.month === month), movements.filter((m) => m.month === month)),
  }));
}

/**
 * Taux d'épargne moyen de la période = Σ (revenus − dépenses) / Σ revenus,
 * calculé sur les mois qui ont des revenus (moyenne pondérée par les revenus).
 */
export function averageSavingsRate(summaries) {
  const withIncome = summaries.filter((s) => s.income > 0);
  if (!withIncome.length) return null;
  return percent(sumCents(withIncome, (s) => s.surplus), sumCents(withIncome, (s) => s.income));
}

/** Mois aux dépenses les plus élevées (mois sans dépense exclus). */
export function topSpendingMonths(summaries, n = 3) {
  return summaries.filter((s) => s.expenses > 0).sort((a, b) => b.expenses - a.expenses || (a.month < b.month ? 1 : -1)).slice(0, n);
}

/** Catégories les plus coûteuses de la période. */
export function topCategories(transactions, n = 3) {
  return totalsByCategory(transactions.filter((t) => t.kind === 'expense')).slice(0, n);
}

/**
 * Données du calendrier d'un mois.
 * @returns {{ weeks: Array<Array<null|{date, income, expense, count, upcoming: object[]}>>, maxExpense: number }}
 */
export function calendarMonth(month, transactions, upcoming = []) {
  const { y, m } = parseISO(`${month}-01`);
  const n = daysInMonth(y, m);
  const days = [];
  for (let d = 1; d <= n; d += 1) {
    const date = toISO(y, m, d);
    const items = transactions.filter((t) => t.date === date);
    days.push({
      date,
      income: sumCents(items.filter((t) => t.kind === 'income'), (t) => t.amountCents),
      expense: sumCents(items.filter((t) => t.kind === 'expense'), (t) => t.amountCents),
      count: items.length,
      upcoming: upcoming.filter((u) => u.date === date),
    });
  }
  const lead = weekdayIndex(days[0].date); // lundi = 0
  const cells = [...Array(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { weeks, maxExpense: Math.max(0, ...days.map((d) => d.expense)) };
}

/**
 * Pistes d'amélioration à partir des données réelles.
 * @param {object} p
 * @param {string} p.month                   mois analysé
 * @param {object[]} p.transactions          transactions couvrant au moins le mois et les 3 précédents
 * @param {object[]} p.summaries             résumés mensuels jusqu'au mois inclus (ordre chronologique)
 * @param {object[]} [p.budgets]
 * @param {object[]} [p.recurrences]
 * @param {Map} [p.categoriesById]
 * @returns {Array<{ key, tone: 'warn'|'info'|'good', title, detail }>}
 */
export function insights({ month, transactions, summaries, budgets = [], recurrences = [], categoriesById = new Map() }) {
  const out = [];
  const name = (id) => categoriesById.get(id)?.name ?? 'Catégorie';
  const idx = summaries.findIndex((s) => s.month === month);
  if (idx === -1) return out;
  const cur = summaries[idx];
  const previous = summaries.slice(Math.max(0, idx - 3), idx).filter((s) => s.expenseCount > 0);

  // 1. Catégorie en forte hausse (> 25 % au-dessus de sa moyenne sur les mois précédents, et au moins 20 € d'écart)
  if (previous.length >= 2) {
    const curByCat = spentByCategory(transactions.filter((t) => t.month === month));
    for (const [categoryId, spent] of curByCat) {
      const avg = Math.round(sumCents(previous, (s) => sumCents(transactions.filter((t) => t.month === s.month && t.kind === 'expense' && t.categoryId === categoryId), (t) => t.amountCents)) / previous.length);
      if (avg > 0 && spent * 100 > avg * 125 && spent - avg >= 2000) {
        out.push({ key: `cat-${categoryId}`, tone: 'warn', title: `${name(categoryId)} en hausse`,
          detail: { categoryId, spent, average: avg, pct: percent(spent - avg, avg), months: previous.length } });
      }
    }
  }

  // 2. Budget dépassé 3 mois de suite
  const last3 = summaries.slice(Math.max(0, idx - 2), idx + 1);
  if (last3.length === 3 && budgets.length) {
    const ids = new Set(budgets.filter((b) => b.scope === 'category').map((b) => b.categoryId));
    for (const categoryId of ids) {
      const overAll = last3.every((s) => {
        const b = resolveBudgets(budgets, s.month).categories.get(categoryId);
        if (!b) return false;
        const spent = sumCents(transactions.filter((t) => t.month === s.month && t.kind === 'expense' && t.categoryId === categoryId), (t) => t.amountCents);
        return spent > b.amountCents;
      });
      if (overAll) out.push({ key: `budget-${categoryId}`, tone: 'warn', title: `Budget ${name(categoryId)} dépassé 3 mois de suite`, detail: { categoryId } });
    }
  }

  // 3. Part des dépenses fixes dans les revenus
  if (cur.income > 0) {
    const share = percent(cur.fixed, cur.income);
    if (share > 50) out.push({ key: 'fixed-share', tone: 'info', title: 'Dépenses fixes élevées', detail: { share, fixed: cur.fixed, income: cur.income } });
  }

  // 4. Taux d'épargne du mois par rapport à la moyenne
  const prevRates = summaries.slice(Math.max(0, idx - 3), idx).filter((s) => s.income > 0);
  if (cur.savingsRate !== null && prevRates.length >= 2) {
    const avg = averageSavingsRate(prevRates);
    if (avg !== null && cur.savingsRate >= avg + 5) out.push({ key: 'rate-up', tone: 'good', title: 'Taux d\'épargne au-dessus de ta moyenne', detail: { rate: cur.savingsRate, average: avg } });
    else if (avg !== null && cur.savingsRate <= avg - 5) out.push({ key: 'rate-down', tone: 'warn', title: 'Taux d\'épargne en dessous de ta moyenne', detail: { rate: cur.savingsRate, average: avg } });
  }
  if (cur.income > 0 && cur.surplus < 0) out.push({ key: 'deficit', tone: 'warn', title: 'Dépenses supérieures aux revenus', detail: { deficit: -cur.surplus } });

  // 5. Abonnements actifs et leur coût annuel
  const subs = recurrences.filter((r) => r.active && r.kind === 'expense' && (r.categoryId === 'cat_subscriptions' || r.categoryId === 'cat_telecom'));
  if (subs.length) {
    const monthly = sumCents(subs, monthlyEquivalentCents);
    out.push({ key: 'subscriptions', tone: 'info', title: `${subs.length} abonnement${subs.length > 1 ? 's' : ''} actif${subs.length > 1 ? 's' : ''}`,
      detail: { count: subs.length, monthly, yearly: monthly * 12, items: subs.map((r) => ({ label: r.label, monthly: monthlyEquivalentCents(r) })) } });
  }

  // 6. Dépenses exceptionnelles importantes (> 20 % des dépenses du mois)
  if (cur.expenses > 0 && cur.exceptional * 100 > cur.expenses * 20) {
    out.push({ key: 'exceptional', tone: 'info', title: 'Mois marqué par des dépenses exceptionnelles', detail: { exceptional: cur.exceptional, share: percent(cur.exceptional, cur.expenses) } });
  }
  return out;
}

