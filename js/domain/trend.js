/**
 * trend.js — Indicateur « ma situation s'améliore / est stable / se dégrade ». Fonction pure.
 *
 * Règle explicite (affichée dans l'interface) : trois signaux comparent le mois consulté
 * à la moyenne des 3 mois précédents qui ont des données.
 *   1. Taux d'épargne : +1 s'il dépasse la moyenne d'au moins 2 points, −1 s'il est inférieur d'au moins 2 points.
 *   2. Dépenses : +1 si elles sont inférieures d'au moins 5 % à la moyenne, −1 si supérieures d'au moins 5 %.
 *   3. Patrimoine : +1 s'il augmente sur le mois (revenus − dépenses + intérêts > 0), −1 s'il diminue.
 * Score ≥ 2 → amélioration · score ≤ −2 → dégradation · sinon → stable.
 * Sans aucun mois précédent avec des données, l'indicateur n'est pas calculé.
 */

/**
 * @param {object} current   résumé du mois (summarizeMonth) : income, expenses, savingsRate, surplus, interest
 * @param {object[]} previous résumés des mois précédents, du plus ancien au plus récent
 * @returns {{ status: 'up'|'stable'|'down'|'unknown', score: number, signals: Array<{key, label, value: -1|0|1, detail}> }}
 */
export function computeTrend(current, previous) {
  const hasData = (s) => s.incomeCount + s.expenseCount > 0;
  const ref = previous.filter(hasData).slice(-3);
  if (!hasData(current) || !ref.length) return { status: 'unknown', score: 0, signals: [] };

  const signals = [];

  // 1. Taux d'épargne (uniquement sur les mois avec revenus)
  const rates = ref.map((s) => s.savingsRate).filter((r) => r !== null);
  if (current.savingsRate !== null && rates.length) {
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    const diff = current.savingsRate - avg;
    signals.push({ key: 'rate', label: 'Taux d\'épargne', value: diff >= 2 ? 1 : diff <= -2 ? -1 : 0, detail: { current: current.savingsRate, average: Math.round(avg * 10) / 10 } });
  }

  // 2. Dépenses (comparaison sur entiers : D × 100 vs moyenne × 95 / 105)
  const avgExpenses = Math.round(ref.reduce((a, s) => a + s.expenses, 0) / ref.length);
  if (avgExpenses > 0) {
    const v = current.expenses * 100 <= avgExpenses * 95 ? 1 : current.expenses * 100 >= avgExpenses * 105 ? -1 : 0;
    signals.push({ key: 'expenses', label: 'Dépenses', value: v, detail: { current: current.expenses, average: avgExpenses } });
  }

  // 3. Évolution du patrimoine sur le mois
  const growth = current.surplus + (current.interest ?? 0);
  signals.push({ key: 'wealth', label: 'Patrimoine', value: growth > 0 ? 1 : growth < 0 ? -1 : 0, detail: { current: growth } });

  const score = signals.reduce((a, s) => a + s.value, 0);
  return { status: score >= 2 ? 'up' : score <= -2 ? 'down' : 'stable', score, signals };
}
