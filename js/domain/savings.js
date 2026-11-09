/**
 * savings.js — Épargne : soldes des comptes, épargne totale, évolution, objectifs. Fonctions pures.
 *
 * Mouvements (savingsMovements) :
 *   deposit    compte courant → compte d'épargne   (+ sur accountId)
 *   withdrawal compte d'épargne → compte courant   (− sur accountId)
 *   transfer   compte d'épargne → autre compte     (− sur accountId, + sur toAccountId) : neutre pour le total
 *   interest   intérêts crédités                   (+ sur accountId) : ni revenu, ni épargne transférée
 *
 * Le solde d'un compte à une date = solde de départ (si la date est ≥ sa date de départ)
 * + effet des mouvements datés entre sa date de départ et cette date, incluses.
 */
import { sumCents } from '../core/money.js';
import { monthBounds, monthRange, diffMonths, monthKeyOf } from '../core/dates.js';

export const MOVEMENT_TYPES = {
  deposit: { label: 'Versement', verb: 'Versement vers', sign: 1 },
  withdrawal: { label: 'Retrait', verb: 'Retrait de', sign: -1 },
  transfer: { label: 'Transfert', verb: 'Transfert', sign: 0 },
  interest: { label: 'Intérêts', verb: 'Intérêts', sign: 1 },
};

export const ACCOUNT_TYPES = {
  livretA: 'Livret A',
  lep: 'LEP',
  ldds: 'LDDS',
  pel: 'PEL / CEL',
  lifeInsurance: 'Assurance vie',
  pea: 'PEA',
  cto: 'Compte-titres',
  other: 'Autre',
};

/** Effet d'un mouvement sur un compte donné (centimes signés). */
export function effectOn(movement, accountId) {
  const a = movement.amountCents;
  switch (movement.type) {
    case 'deposit':
    case 'interest':
      return movement.accountId === accountId ? a : 0;
    case 'withdrawal':
      return movement.accountId === accountId ? -a : 0;
    case 'transfer':
      if (movement.accountId === accountId) return -a;
      if (movement.toAccountId === accountId) return a;
      return 0;
    default:
      return 0;
  }
}

/** Solde d'un compte à une date ISO (incluse). 0 avant sa date de départ. */
export function accountBalanceAt(account, movements, atISO) {
  if (atISO < account.openingDate) return 0;
  let b = account.openingBalanceCents;
  for (const m of movements) {
    if (m.date < account.openingDate || m.date > atISO) continue;
    b += effectOn(m, account.id);
  }
  return b;
}

/** Soldes de tous les comptes à une date : Map(accountId → centimes). */
export function balancesAt(accounts, movements, atISO) {
  return new Map(accounts.map((a) => [a.id, accountBalanceAt(a, movements, atISO)]));
}

/** Épargne totale à une date, ou null si aucun compte n'était encore ouvert (pas de donnée). */
export function totalSavingsOrNull(accounts, movements, atISO) {
  if (!accounts.some((a) => a.openingDate <= atISO)) return null;
  return totalSavingsAt(accounts, movements, atISO);
}

/** Épargne totale à une date (tous comptes, y compris archivés). */
export function totalSavingsAt(accounts, movements, atISO) {
  return sumCents([...balancesAt(accounts, movements, atISO).values()]);
}

/**
 * Cherche le premier moment où un compte passerait en négatif.
 * Pour un même jour, les crédits sont appliqués avant les débits.
 * @returns {null | {accountId: string, date: string, balanceCents: number}}
 */
export function findNegativeBalance(accounts, movements) {
  for (const acc of accounts) {
    const events = [];
    for (const m of movements) {
      if (m.date < acc.openingDate) continue;
      const e = effectOn(m, acc.id);
      if (e !== 0) events.push({ date: m.date, e });
    }
    events.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : y.e - x.e));
    let b = acc.openingBalanceCents;
    if (b < 0) return { accountId: acc.id, date: acc.openingDate, balanceCents: b };
    for (const ev of events) {
      b += ev.e;
      if (b < 0) return { accountId: acc.id, date: ev.date, balanceCents: b };
    }
  }
  return null;
}

/**
 * Mouvements dont la date précède la date de départ du compte concerné (incohérents).
 * @returns {object|null} premier mouvement fautif
 */
export function findMovementBeforeOpening(accounts, movements) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const m of movements) {
    const from = byId.get(m.accountId);
    if (from && m.date < from.openingDate) return m;
    if (m.type === 'transfer') {
      const to = byId.get(m.toAccountId);
      if (to && m.date < to.openingDate) return m;
    }
  }
  return null;
}

/** Totaux des mouvements d'une période. */
export function summarizeMovements(movements) {
  const of = (t) => sumCents(movements.filter((m) => m.type === t), (m) => m.amountCents);
  const deposits = of('deposit');
  const withdrawals = of('withdrawal');
  return { deposits, withdrawals, transfers: of('transfer'), interest: of('interest'), net: deposits - withdrawals };
}

/**
 * Évolution mensuelle de l'épargne : pour chaque mois, solde total en fin de mois,
 * épargne transférée (T), intérêts.
 */
export function savingsSeries(accounts, movements, fromMonth, toMonth) {
  return monthRange(fromMonth, toMonth).map((month) => {
    const end = monthBounds(month)[1];
    const inMonth = movements.filter((m) => monthKeyOf(m.date) === month);
    const s = summarizeMovements(inMonth);
    return { month, totalCents: totalSavingsAt(accounts, movements, end), savedCents: s.net, interestCents: s.interest };
  });
}

/**
 * Progression d'un objectif : versements et intérêts affectés − retraits affectés.
 * Les transferts entre comptes ne changent pas l'avancement d'un objectif.
 */
export function goalProgress(goal, movements, atISO = null) {
  let saved = 0;
  for (const m of movements) {
    if (m.goalId !== goal.id) continue;
    if (atISO && m.date > atISO) continue;
    if (m.type === 'deposit' || m.type === 'interest') saved += m.amountCents;
    else if (m.type === 'withdrawal') saved -= m.amountCents;
  }
  const savedCents = Math.max(0, saved);
  const remainingCents = Math.max(0, goal.targetCents - savedCents);
  const pct = goal.targetCents > 0 ? Math.min(100, Math.floor((savedCents * 1000) / goal.targetCents) / 10) : 0;
  return { savedCents, remainingCents, percent: pct, reached: savedCents >= goal.targetCents };
}

/**
 * Montant mensuel à épargner pour atteindre l'objectif à son échéance.
 * Le mois en cours compte comme un mois restant ; arrondi au centime supérieur.
 * @returns {null | {months: number, perMonthCents: number, overdue: boolean}}
 */
export function monthlyNeeded(goal, progress, todayISO) {
  if (!goal.deadline || progress.reached) return null;
  const months = diffMonths(monthKeyOf(todayISO), monthKeyOf(goal.deadline)) + 1;
  if (months <= 0) return { months: 0, perMonthCents: progress.remainingCents, overdue: true };
  return { months, perMonthCents: Math.ceil(progress.remainingCents / months), overdue: false };
}

/** Épargne non affectée à un objectif actif = épargne totale − Σ progressions (jamais négative). */
export function freeSavings(totalCents, goals, movements) {
  const allocated = sumCents(goals.filter((g) => !g.archived), (g) => goalProgress(g, movements).savedCents);
  return { allocatedCents: allocated, freeCents: Math.max(0, totalCents - allocated) };
}
