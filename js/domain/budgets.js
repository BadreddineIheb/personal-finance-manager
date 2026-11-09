/**
 * budgets.js — Budgets mensuels : global et par catégorie. Fonctions pures.
 *
 * - Un budget « par défaut » (month = null) s'applique à tous les mois.
 * - Un budget propre à un mois (month = "AAAA-MM") le remplace pour ce mois uniquement.
 * - Toutes les dépenses comptent, y compris les exceptionnelles (décision 7 de la conception).
 * - États : ok (< 80 %), warn (≥ 80 %), reached (= 100 %), over (> 100 %).
 */
import { sumCents, percent } from '../core/money.js';

export const GLOBAL = 'global';

/** Identifiant stable d'un budget : un seul enregistrement par portée et par cible. */
export const budgetId = (month, categoryId) => `${month ?? 'default'}:${categoryId ?? GLOBAL}`;

/**
 * Budgets effectifs d'un mois.
 * @returns {{ global: null | {amountCents, source}, categories: Map<string, {amountCents, source}> }}
 *   source : 'month' (propre au mois) ou 'default'
 */
export function resolveBudgets(budgets, month) {
  const pick = (scope, categoryId) => {
    const specific = budgets.find((b) => b.scope === scope && b.month === month && (b.categoryId ?? null) === categoryId);
    if (specific) return { amountCents: specific.amountCents, source: 'month' };
    const def = budgets.find((b) => b.scope === scope && !b.month && (b.categoryId ?? null) === categoryId);
    return def ? { amountCents: def.amountCents, source: 'default' } : null;
  };
  const categories = new Map();
  const ids = new Set(budgets.filter((b) => b.scope === 'category').map((b) => b.categoryId));
  for (const id of ids) {
    const r = pick('category', id);
    if (r) categories.set(id, r);
  }
  return { global: pick('global', null), categories };
}

/** État d'un budget pour un montant dépensé. */
export function budgetStatus(spentCents, budgetCents) {
  const pct = percent(spentCents, budgetCents) ?? 0;
  const remainingCents = budgetCents - spentCents;
  // Comparaisons sur entiers : 80 % ⇔ dépensé × 100 ≥ budget × 80
  let state = 'ok';
  if (spentCents > budgetCents) state = 'over';
  else if (spentCents === budgetCents) state = 'reached';
  else if (spentCents * 100 >= budgetCents * 80) state = 'warn';
  return { spentCents, budgetCents, remainingCents, percent: pct, state };
}

/** Dépenses du mois par catégorie (tous types). */
export function spentByCategory(expenses) {
  const map = new Map();
  for (const t of expenses) if (t.kind === 'expense') map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amountCents);
  return map;
}

/**
 * Synthèse complète des budgets d'un mois.
 * @returns {{ global, categories: Array, unbudgeted: Array, alerts: Array, sumOfCategoryBudgets, exceedsGlobal: boolean }}
 */
export function budgetOverview(budgets, transactions, month) {
  const expenses = transactions.filter((t) => t.kind === 'expense');
  const spent = spentByCategory(expenses);
  const totalSpent = sumCents(expenses, (t) => t.amountCents);
  const resolved = resolveBudgets(budgets, month);

  const global = resolved.global ? { ...budgetStatus(totalSpent, resolved.global.amountCents), source: resolved.global.source } : null;
  const categories = [...resolved.categories.entries()].map(([categoryId, b]) => ({
    categoryId, source: b.source, ...budgetStatus(spent.get(categoryId) ?? 0, b.amountCents),
  })).sort((a, b) => b.percent - a.percent || b.spentCents - a.spentCents);
  const unbudgeted = [...spent.entries()].filter(([id]) => !resolved.categories.has(id))
    .map(([categoryId, spentCents]) => ({ categoryId, spentCents })).sort((a, b) => b.spentCents - a.spentCents);
  const sumOfCategoryBudgets = sumCents(categories, (c) => c.budgetCents);

  const alerts = [];
  if (global && global.state !== 'ok') alerts.push({ categoryId: null, ...global });
  for (const c of categories) if (c.state !== 'ok') alerts.push(c);

  return {
    global, categories, unbudgeted, alerts, totalSpent, sumOfCategoryBudgets,
    exceedsGlobal: Boolean(global) && sumOfCategoryBudgets > global.budgetCents,
  };
}
