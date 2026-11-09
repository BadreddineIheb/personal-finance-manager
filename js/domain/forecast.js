/**
 * forecast.js — Estimation de ce qui restera (épargne possible) en fin de mois. Fonction pure.
 *
 * Méthode (affichée dans l'interface) :
 *   Revenus attendus   = revenus enregistrés + revenus récurrents encore à venir ce mois
 *   Dépenses certaines = dépenses enregistrées + dépenses récurrentes encore à venir
 *   Variables projetées (mois en cours) = rythme des dépenses variables datées jusqu'à aujourd'hui
 *     (montant / jours écoulés) × jours restants, moins les dépenses variables déjà saisies à une date future
 *   Estimation haute    = revenus attendus − dépenses certaines
 *   Estimation prudente = estimation haute − variables projetées
 * Mois passé : le résultat réel. Mois futur : récurrences du mois, et pour les variables la moyenne
 * des 3 derniers mois (estimation prudente).
 */
import { sumCents } from '../core/money.js';
import { monthBounds, monthKeyOf, addDays, parseISO, daysInMonth } from '../core/dates.js';
import { upcomingOccurrences } from './recurrence.js';

/**
 * @param {object} p
 * @param {string} p.month              mois estimé
 * @param {string} p.today              date du jour (ISO)
 * @param {object[]} p.transactions     revenus et dépenses enregistrés du mois
 * @param {object[]} p.recurrences      toutes les récurrences
 * @param {number} [p.averageVariableCents] moyenne des dépenses variables (mois futurs)
 */
export function forecastMonth({ month, today, transactions, recurrences, averageVariableCents = 0 }) {
  const [start, end] = monthBounds(month);
  const income = sumCents(transactions.filter((t) => t.kind === 'income'), (t) => t.amountCents);
  const expenses = sumCents(transactions.filter((t) => t.kind === 'expense'), (t) => t.amountCents);
  const variableDone = sumCents(transactions.filter((t) => t.kind === 'expense' && t.expenseType === 'variable'), (t) => t.amountCents);
  const currentMonth = monthKeyOf(today);

  if (month < currentMonth) {
    const actual = income - expenses;
    return { mode: 'final', income, expenses, upcomingIncome: 0, upcomingExpenses: 0, projectedVariable: 0, high: actual, low: actual, upcoming: [] };
  }

  const from = month === currentMonth ? addDays(today, 1) : start;
  const upcoming = from <= end ? upcomingOccurrences(recurrences, from, end) : [];
  const upcomingIncome = sumCents(upcoming.filter((u) => u.recurrence.kind === 'income'), (u) => u.recurrence.amountCents);
  const upcomingExpenses = sumCents(upcoming.filter((u) => u.recurrence.kind === 'expense'), (u) => u.recurrence.amountCents);

  let projectedVariable;
  let variableRate = variableDone;
  let daysElapsed = null;
  let daysRemaining = null;
  if (month === currentMonth) {
    const { y, m, d } = parseISO(today);
    daysElapsed = d;
    daysRemaining = daysInMonth(y, m) - d;
    // Le rythme ne tient compte que des dépenses déjà faites (date ≤ aujourd'hui) ;
    // les dépenses variables saisies à l'avance sont déjà dans les dépenses enregistrées.
    const variablePast = sumCents(transactions.filter((t) => t.kind === 'expense' && t.expenseType === 'variable' && t.date <= today), (t) => t.amountCents);
    const variableAhead = variableDone - variablePast;
    projectedVariable = Math.max(0, Math.round((variablePast * daysRemaining) / daysElapsed) - variableAhead);
    variableRate = variablePast;
  } else {
    projectedVariable = Math.max(0, averageVariableCents - variableDone);
  }

  const high = income + upcomingIncome - expenses - upcomingExpenses;
  return {
    mode: month === currentMonth ? 'current' : 'future',
    income, expenses, upcomingIncome, upcomingExpenses, projectedVariable, variableDone: variableRate, daysElapsed, daysRemaining,
    high, low: high - projectedVariable, upcoming,
  };
}
