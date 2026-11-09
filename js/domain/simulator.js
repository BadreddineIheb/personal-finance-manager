/**
 * simulator.js — Simulateur d'épargne. Fonctions pures, calcul au centime.
 *
 * Chaque mois : intérêts du mois sur le solde (taux annuel / 12, arrondis au centime), puis versement.
 * Le taux est exprimé en points de base (1 % = 100) pour rester en nombres entiers.
 * Hypothèse simplificatrice affichée à l'utilisateur : capitalisation mensuelle (les livrets réglementés
 * calculent par quinzaine et versent les intérêts une fois par an).
 */

/** Intérêts d'un mois : solde × taux annuel / 12, arrondis au centime (demi vers le haut). */
export function monthlyInterest(balanceCents, rateBp) {
  if (!rateBp || balanceCents <= 0) return 0;
  return Math.round((balanceCents * rateBp) / 120000);
}

/**
 * Projection mois par mois.
 * @returns {Array<{ month: number, balanceCents, depositedCents, interestCents }>} cumuls à la fin de chaque mois
 */
export function simulate({ startCents = 0, monthlyCents = 0, rateBp = 0, months }) {
  const out = [];
  let balance = startCents;
  let deposited = 0;
  let interest = 0;
  for (let i = 1; i <= months; i += 1) {
    const it = monthlyInterest(balance, rateBp);
    balance += it + monthlyCents;
    interest += it;
    deposited += monthlyCents;
    out.push({ month: i, balanceCents: balance, depositedCents: deposited, interestCents: interest });
  }
  return out;
}

/**
 * Nombre de mois pour atteindre un objectif (null si jamais atteint en 100 ans).
 * @returns {number|null} 0 si l'objectif est déjà atteint
 */
export function monthsToReach({ targetCents, startCents = 0, monthlyCents = 0, rateBp = 0 }) {
  if (startCents >= targetCents) return 0;
  if (monthlyCents <= 0 && (!rateBp || startCents <= 0)) return null;
  let balance = startCents;
  for (let i = 1; i <= 1200; i += 1) {
    balance += monthlyInterest(balance, rateBp) + monthlyCents;
    if (balance >= targetCents) return i;
  }
  return null;
}

/** Durée lisible : 14 → « 1 an et 2 mois ». */
export function formatDuration(months) {
  if (months === null) return 'jamais (versement trop faible)';
  if (months === 0) return 'déjà atteint';
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} an${y > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} mois`);
  return parts.join(' et ');
}
