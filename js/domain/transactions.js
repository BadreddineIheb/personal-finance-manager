/**
 * transactions.js — Recherche, filtres, tris et regroupements de transactions.
 * Fonctions pures, utilisées par les pages Revenus, Dépenses et Historique.
 */
import { sumCents, distributePercents } from '../core/money.js';

/** Normalise un texte pour la recherche : minuscules, sans accents. */
export function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Filtre une liste de transactions.
 * @param {Array} list
 * @param {object} f
 * @param {string} [f.query]        texte recherché dans le nom, la description et la catégorie
 * @param {string} [f.kind]         'income' | 'expense'
 * @param {string[]} [f.categoryIds]
 * @param {string[]} [f.expenseTypes]
 * @param {string[]} [f.incomeTypes]
 * @param {string} [f.from] [f.to]  dates ISO incluses
 * @param {number} [f.minCents] [f.maxCents]
 * @param {Map<string,object>} [categoriesById] pour rechercher dans le nom de catégorie
 */
export function filterTransactions(list, f = {}, categoriesById = new Map()) {
  const q = normalize(f.query).trim();
  const terms = q ? q.split(/\s+/) : [];
  return list.filter((t) => {
    if (f.kind && t.kind !== f.kind) return false;
    if (f.categoryIds?.length && !f.categoryIds.includes(t.categoryId)) return false;
    if (f.expenseTypes?.length && !f.expenseTypes.includes(t.expenseType)) return false;
    if (f.incomeTypes?.length && !f.incomeTypes.includes(t.incomeType)) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (Number.isSafeInteger(f.minCents) && t.amountCents < f.minCents) return false;
    if (Number.isSafeInteger(f.maxCents) && t.amountCents > f.maxCents) return false;
    if (terms.length) {
      const hay = normalize(`${t.label} ${t.description ?? ''} ${categoriesById.get(t.categoryId)?.name ?? ''}`);
      if (!terms.every((term) => hay.includes(term))) return false;
    }
    return true;
  });
}

/** Critères de tri disponibles. */
export const SORTS = {
  date: (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
  amount: (a, b) => a.amountCents - b.amountCents,
  label: (a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }),
};

/** Trie sans modifier la liste d'origine. dir : 'asc' | 'desc'. */
export function sortTransactions(list, key = 'date', dir = 'desc') {
  const cmp = SORTS[key] ?? SORTS.date;
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => sign * cmp(a, b) || (a.id < b.id ? -1 : 1));
}

/**
 * Totaux des dépenses par catégorie, du plus gros au plus petit,
 * avec des pourcentages qui totalisent exactement 100 %.
 * @returns {Array<{categoryId, totalCents, count, percent}>}
 */
export function totalsByCategory(expenses) {
  const map = new Map();
  for (const t of expenses) {
    if (t.kind !== 'expense') continue;
    const e = map.get(t.categoryId) ?? { categoryId: t.categoryId, totalCents: 0, count: 0 };
    e.totalCents += t.amountCents;
    e.count += 1;
    map.set(t.categoryId, e);
  }
  const rows = [...map.values()].sort((a, b) => b.totalCents - a.totalCents || a.categoryId.localeCompare(b.categoryId));
  const pcts = distributePercents(rows.map((r) => r.totalCents));
  rows.forEach((r, i) => { r.percent = pcts[i]; });
  return rows;
}

/** Totaux par type de dépense. */
export function totalsByExpenseType(expenses) {
  const out = { fixed: 0, variable: 0, exceptional: 0 };
  for (const t of expenses) if (t.kind === 'expense' && t.expenseType in out) out[t.expenseType] += t.amountCents;
  return out;
}

/** Totaux des revenus par type. */
export function totalsByIncomeType(incomes) {
  const out = {};
  for (const t of incomes) if (t.kind === 'income') out[t.incomeType] = (out[t.incomeType] ?? 0) + t.amountCents;
  return out;
}

/** Les n plus grosses transactions (ex aequo départagés par date récente). */
export function topTransactions(list, n = 5) {
  return [...list].sort((a, b) => b.amountCents - a.amountCents || (b.date < a.date ? -1 : b.date > a.date ? 1 : 0)).slice(0, n);
}

/** Somme d'une liste de transactions. */
export const total = (list) => sumCents(list, (t) => t.amountCents);
