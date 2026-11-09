/**
 * recurrence.js — Moteur des opérations récurrentes (salaire, loyer, abonnements…). Fonctions pures.
 *
 * Règles (décision 2 de la conception) :
 * - Une occurrence est créée comme une vraie transaction dès que sa date est atteinte ;
 *   les occurrences futures ne sont jamais enregistrées, seulement calculées (échéances à venir).
 * - Chaque occurrence a une clé unique `recurrenceId@AAAA-MM-JJ` : générer plusieurs fois
 *   ne crée jamais de doublon.
 * - Une occurrence supprimée par l'utilisateur est mémorisée (skippedKeys) et jamais recréée.
 * - Le jour 29, 30 ou 31 est ramené au dernier jour des mois plus courts.
 */
import {
  parseISO, toISO, daysInMonth, addMonths, addDays, monthKeyOf, diffMonths, diffDays, weekdayIndex, MONTHS, clampDayInMonth,
} from '../core/dates.js';

export const FREQUENCIES = {
  monthly: 'Tous les mois',
  everyNMonths: 'Tous les N mois',
  yearly: 'Chaque année',
  weekly: 'Toutes les semaines',
};

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MAX_OCCURRENCES = 2000; // garde-fou contre une boucle sur une période absurde

export const occurrenceKey = (recurrenceId, dateISO) => `${recurrenceId}@${dateISO}`;

/**
 * Dates d'occurrence d'une récurrence entre deux dates ISO incluses.
 * @param {object} r récurrence { frequency, interval, dayOfMonth, monthOfYear, startDate, endDate }
 */
export function occurrencesBetween(r, fromDate, toDate) {
  const from = fromDate > r.startDate ? fromDate : r.startDate;
  const to = r.endDate && r.endDate < toDate ? r.endDate : toDate;
  if (from > to) return [];
  const out = [];
  const push = (d) => { if (d >= from && d <= to) out.push(d); };
  const interval = Math.max(1, r.interval || 1);
  const startMonth = monthKeyOf(r.startDate);

  if (r.frequency === 'weekly') {
    // Ancrée sur la date de début : même jour de la semaine, toutes les `interval` semaines.
    const step = 7 * interval;
    const gap = diffDays(r.startDate, from);
    let k = gap > 0 ? Math.ceil(gap / step) : 0;
    for (let i = 0; i < MAX_OCCURRENCES; i += 1, k += 1) {
      const d = addDays(r.startDate, k * step);
      if (d > to) break;
      push(d);
    }
    return out;
  }

  // Mensuelle, tous les N mois, annuelle : ancrées sur le mois de début.
  const monthStep = r.frequency === 'yearly' ? 12 : r.frequency === 'everyNMonths' ? interval : 1;
  let firstMonth = startMonth;
  if (r.frequency === 'yearly') {
    // Premier mois `monthOfYear` à partir du mois de début
    const y = Number(startMonth.slice(0, 4));
    const m = r.monthOfYear;
    firstMonth = toISO(y, m, 1).slice(0, 7);
    if (firstMonth < startMonth) firstMonth = toISO(y + 1, m, 1).slice(0, 7);
  }
  // Saut direct au premier mois utile (évite d'itérer sur des années passées)
  const skip = Math.max(0, Math.floor(diffMonths(firstMonth, monthKeyOf(from)) / monthStep));
  let month = addMonths(firstMonth, skip * monthStep);
  for (let i = 0; i < MAX_OCCURRENCES; i += 1) {
    const d = clampDayInMonth(month, r.dayOfMonth);
    if (d > to) break;
    push(d);
    month = addMonths(month, monthStep);
  }
  return out;
}

/**
 * Occurrences échues (date ≤ aujourd'hui) qui n'existent pas encore et n'ont pas été supprimées.
 * @param {object[]} recurrences
 * @param {Set<string>} existingKeys clés déjà présentes en base
 * @param {string} todayISO
 * @returns {Array<{recurrence: object, date: string, key: string}>}
 */
export function dueOccurrences(recurrences, existingKeys, todayISO) {
  const out = [];
  for (const r of recurrences) {
    if (!r.active) continue;
    const skipped = new Set(r.skippedKeys ?? []);
    for (const date of occurrencesBetween(r, r.startDate, todayISO)) {
      const key = occurrenceKey(r.id, date);
      if (!existingKeys.has(key) && !skipped.has(key)) out.push({ recurrence: r, date, key });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Échéances à venir (non encore enregistrées) entre deux dates, toutes récurrences actives.
 * @returns {Array<{recurrence, date, key}>}
 */
export function upcomingOccurrences(recurrences, fromDate, toDate) {
  const out = [];
  for (const r of recurrences) {
    if (!r.active) continue;
    const skipped = new Set(r.skippedKeys ?? []);
    for (const date of occurrencesBetween(r, fromDate, toDate)) {
      const key = occurrenceKey(r.id, date);
      if (!skipped.has(key)) out.push({ recurrence: r, date, key });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.recurrence.label.localeCompare(b.recurrence.label, 'fr')));
}

/** Transaction à créer pour une occurrence (copie des valeurs actuelles de la récurrence). */
export function transactionFromOccurrence(r, date) {
  const base = {
    kind: r.kind, label: r.label, amountCents: r.amountCents, date, description: r.description ?? '',
    recurringId: r.id, occurrenceKey: occurrenceKey(r.id, date),
  };
  return r.kind === 'expense'
    ? { ...base, categoryId: r.categoryId, expenseType: r.expenseType }
    : { ...base, incomeType: r.incomeType };
}

/** Prochaine occurrence à partir d'une date (incluse), ou null. Cherche sur 2 ans. */
export function nextOccurrence(r, fromISO) {
  if (!r.active) return null;
  const skipped = new Set(r.skippedKeys ?? []);
  const { y, m, d } = parseISO(fromISO);
  const limit = toISO(y + 2, m, Math.min(d, daysInMonth(y + 2, m)));
  return occurrencesBetween(r, fromISO, limit).find((date) => !skipped.has(occurrenceKey(r.id, date))) ?? null;
}

/** Description lisible : « Tous les mois, le 5 », « Chaque année, le 1er septembre »… */
export function describeFrequency(r) {
  const day = r.dayOfMonth === 1 ? '1er' : String(r.dayOfMonth);
  const last = r.dayOfMonth >= 29 ? ' (ou dernier jour du mois)' : '';
  switch (r.frequency) {
    case 'monthly': return `Tous les mois, le ${day}${last}`;
    case 'everyNMonths': return `Tous les ${r.interval} mois, le ${day}${last}`;
    case 'yearly': return `Chaque année, le ${day} ${MONTHS[r.monthOfYear - 1]}`;
    case 'weekly': return `${r.interval > 1 ? `Toutes les ${r.interval} semaines` : 'Toutes les semaines'}, le ${WEEKDAYS[weekdayIndex(r.startDate)]}`;
    default: return '';
  }
}

/** Montant moyen mensuel d'une récurrence (pour les estimations), en centimes arrondis. */
export function monthlyEquivalentCents(r) {
  switch (r.frequency) {
    case 'monthly': return r.amountCents;
    case 'everyNMonths': return Math.round(r.amountCents / Math.max(1, r.interval));
    case 'yearly': return Math.round(r.amountCents / 12);
    case 'weekly': return Math.round((r.amountCents * 52) / (12 * Math.max(1, r.interval)));
    default: return 0;
  }
}
