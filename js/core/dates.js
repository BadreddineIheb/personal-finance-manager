/**
 * dates.js — Dates civiles sans heure ni fuseau.
 *
 * Toutes les dates sont stockées en chaîne ISO "AAAA-MM-JJ" et les mois en "AAAA-MM".
 * On n'utilise jamais `new Date("AAAA-MM-JJ")` (interprété en UTC, peut décaler d'un jour).
 * Les calculs passent par des entiers {y, m, d} ; Date.UTC ne sert qu'au jour de la semaine.
 */

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

export const pad2 = (n) => String(n).padStart(2, '0');

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Nombre de jours du mois m (1–12) de l'année y. */
export function daysInMonth(y, m) {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Construit "AAAA-MM-JJ" ; ne vérifie pas la validité. */
export function toISO(y, m, d) {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

/** Vérifie qu'une chaîne est une date ISO existante (31/02 refusé). */
export function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseISO(s);
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** "2026-11-09" → {y: 2026, m: 11, d: 9}. */
export function parseISO(s) {
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) };
}

/** Vérifie une clé de mois "AAAA-MM". */
export function isValidMonthKey(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5, 7));
  const y = Number(s.slice(0, 4));
  return m >= 1 && m <= 12 && y >= 1900 && y <= 2200;
}

/** Date du jour (fuseau local de l'appareil). Injectable pour les tests. */
export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** "2026-11-09" → "2026-11". */
export function monthKeyOf(iso) {
  return iso.slice(0, 7);
}

export function currentMonthKey(now = new Date()) {
  return monthKeyOf(todayISO(now));
}

/** Ajoute n mois à une clé "AAAA-MM" (n peut être négatif). */
export function addMonths(monthKey, n) {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`;
}

/** Ajoute n jours à une date ISO. */
export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dt = new Date(t);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Nombre de jours entre deux dates ISO (b - a). */
export function diffDays(a, b) {
  const A = parseISO(a);
  const B = parseISO(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86_400_000);
}

/** Nombre de mois entre deux clés de mois (b - a). */
export function diffMonths(a, b) {
  return (Number(b.slice(0, 4)) * 12 + Number(b.slice(5, 7))) - (Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7)));
}

/** Premier et dernier jour d'un mois : "2026-02" → ["2026-02-01", "2026-02-28"]. */
export function monthBounds(monthKey) {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  return [toISO(y, m, 1), toISO(y, m, daysInMonth(y, m))];
}

/** Date du jour `day` dans le mois, ramenée au dernier jour si besoin (31 → 28/29/30). */
export function clampDayInMonth(monthKey, day) {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  return toISO(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Liste des clés de mois de `from` à `to` inclus. */
export function monthRange(from, to) {
  const out = [];
  const n = diffMonths(from, to);
  for (let i = 0; i <= n; i += 1) out.push(addMonths(from, i));
  return out;
}

/** Jour de la semaine, lundi = 0 … dimanche = 6. */
export function weekdayIndex(iso) {
  const { y, m, d } = parseISO(iso);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Comparaison de dates ISO (fonctionne aussi sur des clés de mois). */
export const compareISO = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------- Affichage ----------

/** "2026-11" → "novembre 2026". */
export function formatMonth(monthKey, { short = false } = {}) {
  const m = Number(monthKey.slice(5, 7));
  const names = short ? MONTHS_SHORT : MONTHS;
  return `${names[m - 1]} ${monthKey.slice(0, 4)}`;
}

/** Nom du mois seul : "2026-11" → "novembre" (ou "nov."). */
export function monthName(monthKey, { short = false } = {}) {
  const m = Number(monthKey.slice(5, 7));
  return (short ? MONTHS_SHORT : MONTHS)[m - 1];
}

/**
 * Formate une date ISO.
 * 'numeric' → 09/11/2026 · 'medium' → 9 nov. 2026 · 'long' → lundi 9 novembre 2026 · 'dayMonth' → 09/11
 */
export function formatDate(iso, style = 'numeric') {
  if (!isValidISODate(iso)) return '—';
  const { y, m, d } = parseISO(iso);
  switch (style) {
    case 'medium': return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
    case 'long': return `${['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][weekdayIndex(iso)]} ${d} ${MONTHS[m - 1]} ${y}`;
    case 'dayMonth': return `${pad2(d)}/${pad2(m)}`;
    case 'weekday': return WEEKDAYS_SHORT[weekdayIndex(iso)];
    default: return `${pad2(d)}/${pad2(m)}/${y}`;
  }
}

/**
 * Lit une date saisie en français : "9/11/2026", "09/11/2026", "09-11-2026", "09.11.26".
 * Accepte aussi l'ISO "2026-11-09" (valeur d'un <input type="date">).
 * @returns {string|null} date ISO ou null si invalide
 */
export function parseFrenchDate(input) {
  const s = String(input ?? '').trim();
  if (isValidISODate(s)) return s;
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  let y = Number(m[3]);
  if (m[3].length === 2) y += 2000;
  const iso = toISO(y, Number(m[2]), Number(m[1]));
  return isValidISODate(iso) ? iso : null;
}

export { MONTHS, MONTHS_SHORT };
