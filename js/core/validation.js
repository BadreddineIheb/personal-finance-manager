/**
 * validation.js — Règles de validation partagées par les formulaires et l'import JSON.
 * Chaque validateur retourne { ok, value, errors } où errors est indexé par nom de champ.
 */
import { parseAmount, isCents, MAX_AMOUNT_CENTS } from './money.js';
import { isValidISODate, parseFrenchDate } from './dates.js';
import { EXPENSE_TYPES, INCOME_TYPES } from '../data/schema.js';

export const LIMITS = { label: 80, description: 500, name: 60 };

/** Nettoie un texte : espaces superflus, caractères de contrôle. */
export function cleanText(v) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Lit un montant : déjà en centimes (number) ou saisi (string). */
function readAmount(v, errors, field = 'amount') {
  if (typeof v === 'number') {
    if (!isCents(v) || v <= 0 || v > MAX_AMOUNT_CENTS) { errors[field] = 'Montant invalide.'; return null; }
    return v;
  }
  const r = parseAmount(v);
  if (!r.ok) { errors[field] = r.error; return null; }
  return r.cents;
}

function readDate(v, errors, field = 'date', { required = true } = {}) {
  if ((v === '' || v === null || v === undefined) && !required) return null;
  if (v === '' || v === null || v === undefined) { errors[field] = 'Date requise.'; return null; }
  const iso = parseFrenchDate(v);
  if (!iso) { errors[field] = 'Cette date n\'existe pas.'; return null; }
  return iso;
}

function readLabel(v, errors, field = 'label', max = LIMITS.label) {
  const s = cleanText(v);
  if (!s) { errors[field] = 'Nom requis.'; return null; }
  if (s.length > max) { errors[field] = `${max} caractères maximum.`; return null; }
  return s;
}

function readDescription(v, errors) {
  const s = cleanText(v);
  if (s.length > LIMITS.description) { errors.description = `${LIMITS.description} caractères maximum.`; return null; }
  return s;
}

/**
 * Valide un revenu ou une dépense.
 * @param {object} raw
 * @param {{categoryIds?: Set<string>}} ctx ensemble des catégories existantes
 */
export function validateTransaction(raw, ctx = {}) {
  const errors = {};
  const kind = raw.kind;
  if (kind !== 'income' && kind !== 'expense') errors.kind = 'Type de transaction inconnu.';

  const value = {
    kind,
    label: readLabel(raw.label, errors),
    amountCents: readAmount(raw.amountCents ?? raw.amount, errors),
    date: readDate(raw.date, errors),
    description: readDescription(raw.description, errors),
  };

  if (kind === 'expense') {
    if (!raw.categoryId) errors.categoryId = 'Catégorie requise.';
    else if (ctx.categoryIds && !ctx.categoryIds.has(raw.categoryId)) errors.categoryId = 'Catégorie inconnue.';
    if (!EXPENSE_TYPES[raw.expenseType]) errors.expenseType = 'Type de dépense requis.';
    value.categoryId = raw.categoryId;
    value.expenseType = raw.expenseType;
  } else if (kind === 'income') {
    if (!INCOME_TYPES[raw.incomeType]) errors.incomeType = 'Type de revenu requis.';
    value.incomeType = raw.incomeType;
  }

  const ok = Object.keys(errors).length === 0;
  return { ok, value: ok ? value : null, errors };
}

/** Valide un montant seul (ex. solde de départ, qui peut être nul ou négatif). */
export function validateSignedAmount(input) {
  const s = String(input ?? '').trim().replace(/−/g, '-');
  if (s === '') return { ok: true, cents: 0 };
  const negative = s.startsWith('-');
  const r = parseAmount(negative ? s.slice(1) : s, { allowZero: true });
  if (!r.ok) return r;
  return { ok: true, cents: negative ? -r.cents : r.cents };
}

export { readAmount, readDate, readLabel, readDescription };

// ------------------------------------------------------------------ Épargne

const ACCOUNT_TYPE_KEYS = ['livretA', 'lep', 'ldds', 'pel', 'lifeInsurance', 'pea', 'cto', 'other'];
const MOVEMENT_TYPE_KEYS = ['deposit', 'withdrawal', 'transfer', 'interest'];

/** Valide un compte d'épargne (le solde de départ peut être nul, jamais négatif). */
export function validateAccount(raw) {
  const errors = {};
  const name = readLabel(raw.name, errors, 'name', LIMITS.name);
  if (!ACCOUNT_TYPE_KEYS.includes(raw.type)) errors.type = 'Type de compte requis.';
  let openingBalanceCents = null;
  if (typeof raw.openingBalanceCents === 'number') openingBalanceCents = raw.openingBalanceCents;
  else {
    const r = String(raw.openingBalance ?? '').trim() === '' ? { ok: true, cents: 0 } : parseAmount(raw.openingBalance, { allowZero: true });
    if (r.ok) openingBalanceCents = r.cents; else errors.openingBalance = r.error;
  }
  if (openingBalanceCents !== null && (!isCents(openingBalanceCents) || openingBalanceCents < 0)) errors.openingBalance = 'Le solde de départ ne peut pas être négatif.';
  const openingDate = readDate(raw.openingDate, errors, 'openingDate');
  const color = /^#[0-9a-f]{6}$/i.test(raw.color ?? '') ? raw.color : null;
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { name, type: raw.type, openingBalanceCents, openingDate, color } : null };
}

/**
 * Valide un mouvement d'épargne.
 * @param {{accountIds?: Set<string>, goalIds?: Set<string>}} ctx
 */
export function validateMovement(raw, ctx = {}) {
  const errors = {};
  if (!MOVEMENT_TYPE_KEYS.includes(raw.type)) errors.type = 'Type de mouvement requis.';
  const amountCents = readAmount(raw.amountCents ?? raw.amount, errors);
  const date = readDate(raw.date, errors);
  if (!raw.accountId) errors.accountId = 'Compte requis.';
  else if (ctx.accountIds && !ctx.accountIds.has(raw.accountId)) errors.accountId = 'Compte inconnu.';
  let toAccountId = null;
  if (raw.type === 'transfer') {
    if (!raw.toAccountId) errors.toAccountId = 'Compte de destination requis.';
    else if (raw.toAccountId === raw.accountId) errors.toAccountId = 'Choisis un compte différent du compte de départ.';
    else if (ctx.accountIds && !ctx.accountIds.has(raw.toAccountId)) errors.toAccountId = 'Compte inconnu.';
    toAccountId = raw.toAccountId;
  }
  let goalId = null;
  if (raw.goalId && raw.type !== 'transfer') {
    if (ctx.goalIds && !ctx.goalIds.has(raw.goalId)) errors.goalId = 'Objectif inconnu.';
    goalId = raw.goalId;
  }
  const label = cleanText(raw.label);
  if (label.length > LIMITS.label) errors.label = `${LIMITS.label} caractères maximum.`;
  const description = readDescription(raw.description, errors);
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { type: raw.type, amountCents, date, accountId: raw.accountId, toAccountId, goalId, label, description } : null };
}

/** Valide un objectif d'épargne. */
export function validateGoal(raw) {
  const errors = {};
  const name = readLabel(raw.name, errors, 'name', LIMITS.name);
  const targetCents = readAmount(raw.targetCents ?? raw.target, errors, 'target');
  const deadline = readDate(raw.deadline, errors, 'deadline', { required: false });
  const color = /^#[0-9a-f]{6}$/i.test(raw.color ?? '') ? raw.color : null;
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { name, targetCents, deadline, color } : null };
}

// ------------------------------------------------------------------ Récurrences

/**
 * Valide une récurrence (revenu ou dépense).
 * Le jour du mois vaut par défaut celui de la date de début.
 */
export function validateRecurrence(raw, ctx = {}) {
  const base = validateTransaction({ ...raw, date: raw.startDate }, ctx);
  const errors = { ...base.errors };
  if (errors.date) { errors.startDate = errors.date; delete errors.date; }
  const freq = raw.frequency;
  if (!['monthly', 'everyNMonths', 'yearly', 'weekly'].includes(freq)) errors.frequency = 'Fréquence requise.';
  let interval = 1;
  if (freq === 'everyNMonths' || freq === 'weekly') {
    interval = Number(raw.interval);
    const max = freq === 'weekly' ? 52 : 24;
    if (!Number.isInteger(interval) || interval < 1 || interval > max) errors.interval = `Entre 1 et ${max}.`;
  }
  const startDate = base.ok || !errors.startDate ? parseFrenchDate(raw.startDate) : null;
  let dayOfMonth = raw.dayOfMonth === '' || raw.dayOfMonth === undefined || raw.dayOfMonth === null ? Number(startDate?.slice(8, 10)) : Number(raw.dayOfMonth);
  if (freq !== 'weekly' && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) errors.dayOfMonth = 'Jour entre 1 et 31.';
  const monthOfYear = freq === 'yearly' ? Number(raw.monthOfYear ?? startDate?.slice(5, 7)) : null;
  if (freq === 'yearly' && (!Number.isInteger(monthOfYear) || monthOfYear < 1 || monthOfYear > 12)) errors.monthOfYear = 'Mois requis.';
  const endDate = readDate(raw.endDate, errors, 'endDate', { required: false });
  if (endDate && startDate && endDate < startDate) errors.endDate = 'La date de fin doit suivre la date de début.';
  if (freq === 'weekly') dayOfMonth = Number(startDate?.slice(8, 10)) || 1;

  const ok = Object.keys(errors).length === 0;
  if (!ok) return { ok, errors, value: null };
  const { date, ...v } = base.value;
  return { ok, errors, value: { ...v, frequency: freq, interval, dayOfMonth, monthOfYear, startDate, endDate, active: raw.active !== false } };
}
