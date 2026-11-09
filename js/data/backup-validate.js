/**
 * backup-validate.js — Validation complète d'un fichier de sauvegarde JSON. Fonctions pures.
 *
 * Un fichier n'est importé que s'il passe TOUS les contrôles : identité de l'application, version,
 * structure, types, montants en centimes entiers, dates existantes, références (catégories, comptes,
 * objectifs, récurrences), identifiants uniques, cohérence de l'épargne (aucun solde négatif).
 * Les enregistrements sont normalisés (champs inconnus retirés, champ `month` recalculé) :
 * un fichier modifié à la main ne peut pas injecter de données inattendues.
 */
import { APP_ID, SCHEMA_VERSION, DEFAULT_SETTINGS } from './schema.js';
import { isValidISODate, isValidMonthKey, monthKeyOf } from '../core/dates.js';
import { MAX_AMOUNT_CENTS } from '../core/money.js';
import { findNegativeBalance, findMovementBeforeOpening } from '../domain/savings.js';

export const STORE_NAMES = ['categories', 'transactions', 'savingsAccounts', 'savingsMovements', 'goals', 'budgets', 'recurrences'];
const MAX_ERRORS = 12;
const MAX_RECORDS = 200000;

const isStr = (v, max = 500) => typeof v === 'string' && v.length <= max;
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_\-:@.]{1,120}$/.test(v);
const isAmount = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_AMOUNT_CENTS;
const isStamp = (v) => v === undefined || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));
const oneOf = (v, list) => list.includes(v);
const isColor = (v) => v === null || v === undefined || (typeof v === 'string' && (/^#[0-9a-f]{6}$/i.test(v) || /^cat-[a-z]+$/.test(v)));

/** Garde uniquement les clés autorisées (et définies). */
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out;
}

const SCHEMAS = {
  categories: {
    keys: ['id', 'name', 'icon', 'color', 'defaultExpenseType', 'archived', 'order', 'system', 'createdAt', 'updatedAt'],
    check: (r) => isId(r.id) && isStr(r.name, 60) && r.name.trim() && oneOf(r.defaultExpenseType, ['fixed', 'variable', 'exceptional']) && isColor(r.color)
      && (r.icon === undefined || isStr(r.icon, 40)) && (r.order === undefined || Number.isInteger(r.order)) && (r.archived === undefined || typeof r.archived === 'boolean'),
  },
  transactions: {
    keys: ['id', 'kind', 'label', 'amountCents', 'date', 'description', 'categoryId', 'expenseType', 'incomeType', 'recurringId', 'occurrenceKey', 'createdAt', 'updatedAt'],
    check: (r, ctx) => isId(r.id) && oneOf(r.kind, ['income', 'expense']) && isStr(r.label, 80) && r.label.trim() && isAmount(r.amountCents) && isValidISODate(r.date)
      && (r.description === undefined || isStr(r.description))
      && (r.kind === 'expense'
        ? ctx.categoryIds.has(r.categoryId) && oneOf(r.expenseType, ['fixed', 'variable', 'exceptional'])
        : oneOf(r.incomeType, ['salary', 'apprenticeship', 'benefit', 'refund', 'bonus', 'sale', 'other']))
      && (r.occurrenceKey === undefined || isStr(r.occurrenceKey, 200)) && (r.recurringId === undefined || isId(r.recurringId)),
    derive: (r) => ({ ...r, month: monthKeyOf(r.date) }),
  },
  savingsAccounts: {
    keys: ['id', 'name', 'type', 'openingBalanceCents', 'openingDate', 'color', 'archived', 'order', 'createdAt', 'updatedAt'],
    check: (r) => isId(r.id) && isStr(r.name, 60) && r.name.trim() && oneOf(r.type, ['livretA', 'lep', 'ldds', 'pel', 'lifeInsurance', 'pea', 'cto', 'other'])
      && Number.isSafeInteger(r.openingBalanceCents) && r.openingBalanceCents >= 0 && r.openingBalanceCents <= MAX_AMOUNT_CENTS && isValidISODate(r.openingDate) && isColor(r.color),
  },
  savingsMovements: {
    keys: ['id', 'type', 'amountCents', 'date', 'accountId', 'toAccountId', 'goalId', 'label', 'description', 'createdAt', 'updatedAt'],
    check: (r, ctx) => isId(r.id) && oneOf(r.type, ['deposit', 'withdrawal', 'transfer', 'interest']) && isAmount(r.amountCents) && isValidISODate(r.date)
      && ctx.accountIds.has(r.accountId)
      && (r.type === 'transfer' ? ctx.accountIds.has(r.toAccountId) && r.toAccountId !== r.accountId : r.toAccountId === undefined || r.toAccountId === null)
      && (r.goalId === undefined || r.goalId === null || ctx.goalIds.has(r.goalId))
      && (r.label === undefined || isStr(r.label, 80)) && (r.description === undefined || isStr(r.description)),
    derive: (r) => ({ ...r, month: monthKeyOf(r.date) }),
  },
  goals: {
    keys: ['id', 'name', 'targetCents', 'deadline', 'color', 'archived', 'createdAt', 'updatedAt'],
    check: (r) => isId(r.id) && isStr(r.name, 60) && r.name.trim() && isAmount(r.targetCents) && (r.deadline === undefined || r.deadline === null || isValidISODate(r.deadline)) && isColor(r.color),
  },
  budgets: {
    keys: ['id', 'scope', 'categoryId', 'month', 'amountCents', 'updatedAt'],
    check: (r, ctx) => isId(r.id) && oneOf(r.scope, ['global', 'category']) && isAmount(r.amountCents)
      && (r.month === undefined || r.month === null || isValidMonthKey(r.month))
      && (r.scope === 'category' ? ctx.categoryIds.has(r.categoryId) : r.categoryId === undefined || r.categoryId === null),
  },
  recurrences: {
    keys: ['id', 'kind', 'label', 'amountCents', 'description', 'categoryId', 'expenseType', 'incomeType', 'frequency', 'interval', 'dayOfMonth', 'monthOfYear', 'startDate', 'endDate', 'active', 'skippedKeys', 'createdAt', 'updatedAt'],
    check: (r, ctx) => isId(r.id) && oneOf(r.kind, ['income', 'expense']) && isStr(r.label, 80) && r.label.trim() && isAmount(r.amountCents)
      && oneOf(r.frequency, ['monthly', 'everyNMonths', 'yearly', 'weekly']) && Number.isInteger(r.interval) && r.interval >= 1 && r.interval <= 52
      && Number.isInteger(r.dayOfMonth) && r.dayOfMonth >= 1 && r.dayOfMonth <= 31
      && (r.frequency !== 'yearly' || (Number.isInteger(r.monthOfYear) && r.monthOfYear >= 1 && r.monthOfYear <= 12))
      && isValidISODate(r.startDate) && (r.endDate === undefined || r.endDate === null || (isValidISODate(r.endDate) && r.endDate >= r.startDate))
      && typeof r.active === 'boolean' && (r.skippedKeys === undefined || (Array.isArray(r.skippedKeys) && r.skippedKeys.every((k) => isStr(k, 200))))
      && (r.kind === 'expense' ? ctx.categoryIds.has(r.categoryId) && oneOf(r.expenseType, ['fixed', 'variable', 'exceptional']) : oneOf(r.incomeType, ['salary', 'apprenticeship', 'benefit', 'refund', 'bonus', 'sale', 'other'])),
    // Même forme que les enregistrements créés par l'application (champs facultatifs à null)
    derive: (r) => ({ ...r, monthOfYear: r.monthOfYear ?? null, endDate: r.endDate ?? null, skippedKeys: r.skippedKeys ?? [] }),
  },
};

const LABELS = {
  categories: 'catégorie', transactions: 'opération', savingsAccounts: 'compte d\'épargne', savingsMovements: 'mouvement d\'épargne',
  goals: 'objectif', budgets: 'budget', recurrences: 'récurrence',
};

/** Paramètres autorisés et leur contrôle. */
const SETTINGS_CHECK = {
  theme: (v) => oneOf(v, ['system', 'light', 'dark']),
  openingBalanceCents: (v) => Number.isSafeInteger(v) && Math.abs(v) <= MAX_AMOUNT_CENTS,
  openingBalanceDate: (v) => v === null || isValidISODate(v),
  lastExportAt: (v) => v === null || isStamp(v),
  simulatorDefaultRate: (v) => v === null || (typeof v === 'string' && /^\d{1,2}([.,]\d{1,2})?$/.test(v.trim())),
  installedAt: (v) => v === null || isStamp(v),
  backupReminderSnoozedUntil: (v) => v === null || isStamp(v),
};

/**
 * Migre une sauvegarde d'une version antérieure vers la version courante.
 * (Version 1 = version actuelle : aucune transformation pour l'instant.)
 */
export function migrateBackup(backup) {
  let v = backup.schemaVersion;
  const data = backup.data;
  while (v < SCHEMA_VERSION) { v += 1; /* futures migrations : data = MIGRATE[v](data) */ }
  return { ...backup, schemaVersion: v, data };
}

/**
 * Valide un contenu JSON déjà parsé.
 * @returns {{ ok: boolean, errors: string[], data?: object, summary?: object }}
 */
export function validateBackup(json) {
  const errors = [];
  const fail = (msg) => ({ ok: false, errors: [msg] });
  if (!json || typeof json !== 'object' || Array.isArray(json)) return fail('Ce fichier n\'est pas une sauvegarde valide (contenu JSON inattendu).');
  if (json.app !== APP_ID) return fail('Ce fichier ne provient pas de cette application (identifiant « app » absent ou différent).');
  if (!Number.isInteger(json.schemaVersion) || json.schemaVersion < 1) return fail('Version de sauvegarde absente ou invalide.');
  if (json.schemaVersion > SCHEMA_VERSION) return fail(`Cette sauvegarde vient d'une version plus récente de l'application (v${json.schemaVersion}). Mets l'application à jour puis réessaie.`);
  if (!json.data || typeof json.data !== 'object') return fail('Section « data » absente.');

  const migrated = migrateBackup(json);
  const src = migrated.data;
  const add = (msg) => { if (errors.length < MAX_ERRORS) errors.push(msg); };
  const data = {};

  for (const name of STORE_NAMES) {
    const list = src[name] ?? [];
    if (!Array.isArray(list)) { add(`« ${name} » doit être une liste.`); data[name] = []; continue; }
    if (list.length > MAX_RECORDS) { add(`« ${name} » contient trop d'éléments.`); data[name] = []; continue; }
    data[name] = list;
  }
  if (errors.length) return { ok: false, errors };

  // Contexte des références (identifiants déclarés dans le fichier lui-même)
  const ctx = {
    categoryIds: new Set(data.categories.map((c) => c?.id)),
    accountIds: new Set(data.savingsAccounts.map((a) => a?.id)),
    goalIds: new Set(data.goals.map((g) => g?.id)),
  };
  const clean = {};
  for (const name of STORE_NAMES) {
    const schema = SCHEMAS[name];
    const seen = new Set();
    clean[name] = [];
    data[name].forEach((raw, i) => {
      const where = `${LABELS[name]} n° ${i + 1}${raw && typeof raw === 'object' && isStr(raw.label ?? raw.name, 80) ? ` (« ${raw.label ?? raw.name} »)` : ''}`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { add(`${where} : format invalide.`); return; }
      const rec = pick(raw, schema.keys);
      if (!schema.check(rec, ctx) || !isStamp(rec.createdAt) || !isStamp(rec.updatedAt)) {
        add(`${where} : ${describeProblem(name, rec, ctx)}`);
        return;
      }
      if (seen.has(rec.id)) { add(`${where} : identifiant en double.`); return; }
      seen.add(rec.id);
      clean[name].push(schema.derive ? schema.derive(rec) : rec);
    });
  }
  // Clés d'occurrence uniques
  const keys = new Set();
  for (const t of clean.transactions) {
    if (!t.occurrenceKey) continue;
    if (keys.has(t.occurrenceKey)) add(`Échéance récurrente en double (${t.occurrenceKey.split('@')[1]}).`);
    keys.add(t.occurrenceKey);
  }
  // Cohérence de l'épargne
  const early = findMovementBeforeOpening(clean.savingsAccounts, clean.savingsMovements);
  if (early) add(`Un mouvement d'épargne du ${early.date} précède la date de départ de son compte.`);
  const neg = findNegativeBalance(clean.savingsAccounts, clean.savingsMovements);
  if (neg) add(`Le compte d'épargne « ${clean.savingsAccounts.find((a) => a.id === neg.accountId)?.name} » deviendrait négatif le ${neg.date}.`);

  // Paramètres
  const settings = {};
  const rawSettings = src.settings && typeof src.settings === 'object' ? src.settings : {};
  for (const [k, check] of Object.entries(SETTINGS_CHECK)) {
    if (!(k in rawSettings)) continue;
    if (check(rawSettings[k])) settings[k] = rawSettings[k];
    else add(`Paramètre « ${k} » invalide.`);
  }
  if (!clean.categories.length) add('Aucune catégorie dans le fichier.');

  if (errors.length) return { ok: false, errors };
  const months = [...clean.transactions.map((t) => t.month)].sort();
  return {
    ok: true, errors: [],
    data: { ...clean, settings: { ...pick(DEFAULT_SETTINGS, Object.keys(SETTINGS_CHECK)), ...settings } },
    summary: {
      exportedAt: isStamp(json.exportedAt) ? json.exportedAt : null,
      counts: Object.fromEntries(STORE_NAMES.map((n) => [n, clean[n].length])),
      firstMonth: months[0] ?? null, lastMonth: months[months.length - 1] ?? null,
    },
  };
}

/** Message d'erreur précis pour un enregistrement refusé. */
function describeProblem(name, r, ctx) {
  if (!isId(r.id)) return 'identifiant manquant ou invalide.';
  const amountField = name === 'goals' ? 'targetCents' : 'amountCents';
  if (SCHEMAS[name].keys.includes(amountField) && !isAmount(r[amountField])) {
    return `montant invalide (${JSON.stringify(r[amountField] ?? null)} : un entier positif en centimes est attendu).`;
  }
  if (r.date !== undefined && !isValidISODate(r.date)) return `date invalide (${JSON.stringify(r.date)}).`;
  if (name === 'transactions' && r.kind === 'expense' && !ctx.categoryIds.has(r.categoryId)) return 'catégorie inconnue.';
  if (name === 'savingsMovements' && !ctx.accountIds.has(r.accountId)) return 'compte d\'épargne inconnu.';
  if (name === 'savingsMovements' && r.goalId && !ctx.goalIds.has(r.goalId)) return 'objectif inconnu.';
  return 'champ manquant ou de type inattendu.';
}

/**
 * Fusionne une sauvegarde validée avec les données locales.
 * Règle : un élément présent des deux côtés garde la version la plus récemment modifiée (updatedAt) ;
 * une échéance récurrente déjà présente localement (même clé) n'est pas dupliquée.
 * Les paramètres locaux sont conservés.
 * @returns {{ data: object, added: number, updated: number }}
 */
export function mergeData(local, incoming) {
  const data = {};
  let added = 0;
  let updated = 0;
  for (const name of STORE_NAMES) {
    const map = new Map(local[name].map((r) => [r.id, r]));
    const localKeys = name === 'transactions' ? new Set(local.transactions.map((t) => t.occurrenceKey).filter(Boolean)) : null;
    for (const r of incoming[name]) {
      const existing = map.get(r.id);
      if (!existing) {
        if (localKeys && r.occurrenceKey && localKeys.has(r.occurrenceKey)) continue;
        map.set(r.id, r); added += 1;
      } else if ((r.updatedAt ?? '') > (existing.updatedAt ?? '')) {
        map.set(r.id, r); updated += 1;
      }
    }
    data[name] = [...map.values()];
  }
  data.settings = local.settings;
  return { data, added, updated };
}
