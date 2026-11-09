/**
 * ledger.js — Agrégats financiers d'un mois. Fonctions pures, sans accès aux données.
 *
 * Notations (voir conception, section 4) :
 *   R  = revenus            D = Df + Dv + De (dépenses fixes, variables, exceptionnelles)
 *   T  = épargne transférée = versements − retraits (mouvements d'épargne du mois)
 *   Excédent = R − D        Reste du mois = R − D − T
 *   Taux d'épargne = (R − D) / R   (null si R = 0)
 */
import { sumCents, percent } from '../core/money.js';

/**
 * Résumé d'un mois.
 * @param {Array} transactions revenus et dépenses du mois
 * @param {Array} [movements] mouvements d'épargne du mois
 */
export function summarizeMonth(transactions, movements = []) {
  const incomes = transactions.filter((t) => t.kind === 'income');
  const expenses = transactions.filter((t) => t.kind === 'expense');
  const R = sumCents(incomes, (t) => t.amountCents);
  const Df = sumCents(expenses.filter((t) => t.expenseType === 'fixed'), (t) => t.amountCents);
  const Dv = sumCents(expenses.filter((t) => t.expenseType === 'variable'), (t) => t.amountCents);
  const De = sumCents(expenses.filter((t) => t.expenseType === 'exceptional'), (t) => t.amountCents);
  const D = Df + Dv + De;
  const deposits = sumCents(movements.filter((m) => m.type === 'deposit'), (m) => m.amountCents);
  const withdrawals = sumCents(movements.filter((m) => m.type === 'withdrawal'), (m) => m.amountCents);
  const interest = sumCents(movements.filter((m) => m.type === 'interest'), (m) => m.amountCents);
  const T = deposits - withdrawals;
  return {
    income: R,
    fixed: Df,
    variable: Dv,
    exceptional: De,
    expenses: D,
    surplus: R - D,
    deposits,
    withdrawals,
    saved: T,
    interest,
    remaining: R - D - T,
    savingsRate: percent(R - D, R), // en %, 1 décimale, ou null
    incomeCount: incomes.length,
    expenseCount: expenses.length,
  };
}

/**
 * Solde du compte courant à une date donnée (incluse).
 * = solde de départ + Σ revenus − Σ dépenses − Σ versements d'épargne + Σ retraits d'épargne,
 *   pour les opérations datées entre la date du solde de départ (incluse) et `atISO`.
 * Les transferts entre comptes d'épargne et les intérêts ne touchent pas le compte courant.
 * @returns {number|null} centimes, ou null si aucun solde de départ n'est défini ou si `atISO` le précède
 */
export function accountBalance({ openingBalanceCents, openingBalanceDate }, atISO, transactions, movements = []) {
  if (!openingBalanceDate || !Number.isSafeInteger(openingBalanceCents) || atISO < openingBalanceDate) return null;
  const inRange = (d) => d >= openingBalanceDate && d <= atISO;
  let balance = openingBalanceCents;
  for (const t of transactions) {
    if (!inRange(t.date)) continue;
    balance += t.kind === 'income' ? t.amountCents : -t.amountCents;
  }
  for (const m of movements) {
    if (!inRange(m.date)) continue;
    if (m.type === 'deposit') balance -= m.amountCents;
    else if (m.type === 'withdrawal') balance += m.amountCents;
  }
  return balance;
}

/**
 * Variation d'une valeur entre deux mois.
 * @returns {{diff: number, pct: number|null}} pct null si la valeur précédente est nulle
 */
export function variation(current, previous) {
  return { diff: current - previous, pct: previous === 0 ? null : percent(current - previous, Math.abs(previous)) };
}

/**
 * Sens d'une variation pour l'utilisateur : 'good', 'bad' ou 'flat'.
 * @param {number} diff
 * @param {'up'|'down'} better sens favorable (revenus : up, dépenses : down)
 * @param {number|null} pct variation relative en %, sous 0,5 % considérée stable
 */
export function variationTone(diff, better = 'up', pct = null) {
  if (diff === 0 || (pct !== null && Math.abs(pct) < 0.5)) return 'flat';
  const up = diff > 0;
  return (up && better === 'up') || (!up && better === 'down') ? 'good' : 'bad';
}
