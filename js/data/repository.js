/**
 * repository.js — Accès aux données métier.
 * Les pages n'appellent jamais IndexedDB directement : elles passent par ce module,
 * qui horodate les enregistrements, maintient les champs dérivés (month) et notifie l'UI.
 */
import { transaction, openDB, getAll, get } from './db.js';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './schema.js';
import { runMigrations } from './migrations.js';
import { monthKeyOf, monthBounds } from '../core/dates.js';
import { emit } from '../core/events.js';
import { findNegativeBalance, findMovementBeforeOpening } from '../domain/savings.js';
import { dueOccurrences, transactionFromOccurrence, occurrenceKey } from '../domain/recurrence.js';
import { budgetId } from '../domain/budgets.js';
import { formatMoney } from '../core/money.js';
import { formatDate } from '../core/dates.js';

/** Identifiant unique (UUID v4). */
export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const nowStamp = () => new Date().toISOString();
const changed = (store, detail = {}) => emit('data:changed', { store, ...detail });

/** Ouvre la base, applique les migrations, crée les données initiales. */
export async function initRepository() {
  await openDB();
  await runMigrations();
  await transaction(['categories', 'settings'], 'readwrite', async (s) => {
    if ((await s.categories.count()) === 0) {
      for (const c of DEFAULT_CATEGORIES) await s.categories.put({ ...c, createdAt: nowStamp(), updatedAt: nowStamp() });
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if ((await s.settings.get(key)) === undefined) {
        await s.settings.put({ key, value: key === 'installedAt' ? nowStamp() : value });
      }
    }
  });
}

// ---------------------------------------------------------------- Paramètres

export async function getSettings() {
  const rows = await getAll('settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSetting(key, value) {
  await transaction('settings', 'readwrite', (s) => s.settings.put({ key, value }));
  changed('settings', { key });
}

// ---------------------------------------------------------------- Catégories

export async function listCategories({ includeArchived = true } = {}) {
  const all = await getAll('categories');
  return all
    .filter((c) => includeArchived || !c.archived)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'fr'));
}

export async function saveCategory(data) {
  const existing = data.id ? await get('categories', data.id) : null;
  const all = existing ? null : await getAll('categories');
  const record = existing
    ? { ...existing, ...data, updatedAt: nowStamp() }
    : { archived: false, system: false, icon: 'tag', order: all.length, ...data, id: uid(), createdAt: nowStamp(), updatedAt: nowStamp() };
  await transaction('categories', 'readwrite', (s) => s.categories.put(record));
  changed('categories');
  return record;
}

/** Nombre de dépenses rattachées à une catégorie (pour décider archivage / suppression). */
export async function countTransactionsInCategory(categoryId) {
  return transaction('transactions', 'readonly', async (s) => (await s.transactions.byIndex('categoryId', categoryId)).length);
}

/** Supprime une catégorie personnelle jamais utilisée (sinon : archiver). */
export async function deleteCategory(id) {
  await transaction(['categories', 'transactions', 'budgets', 'recurrences'], 'readwrite', async (s) => {
    const c = await s.categories.get(id);
    if (!c) return;
    if (c.system) throw new Error('Les catégories par défaut peuvent être archivées, pas supprimées.');
    if ((await s.transactions.byIndex('categoryId', id)).length) throw new Error('Cette catégorie est utilisée par des dépenses : archive-la plutôt.');
    if ((await s.recurrences.getAll()).some((r) => r.categoryId === id)) throw new Error('Cette catégorie est utilisée par une récurrence : archive-la plutôt.');
    for (const b of await s.budgets.getAll()) if (b.categoryId === id) await s.budgets.delete(b.id);
    await s.categories.delete(id);
  });
  changed('categories');
}

// ---------------------------------------------------------------- Transactions

/** Revenus et dépenses d'un mois ("AAAA-MM"). */
export async function listTransactionsByMonth(monthKey) {
  return transaction('transactions', 'readonly', (s) => s.transactions.byIndex('month', monthKey));
}

/** Revenus et dépenses entre deux dates ISO incluses. */
export async function listTransactionsBetween(fromISO, toISO) {
  return transaction('transactions', 'readonly', (s) => s.transactions.byIndex('date', IDBKeyRange.bound(fromISO, toISO)));
}

/** Revenus et dépenses d'une plage de mois incluse. */
export async function listTransactionsForMonths(fromMonth, toMonth) {
  return listTransactionsBetween(monthBounds(fromMonth)[0], monthBounds(toMonth)[1]);
}

export async function listAllTransactions() {
  return getAll('transactions');
}

export async function getTransaction(id) {
  return get('transactions', id);
}

/**
 * Crée ou met à jour une transaction déjà validée (voir validateTransaction).
 * Les champs propres à l'autre type (ex. categoryId pour un revenu) sont retirés.
 */
export async function saveTransaction(value, id = null) {
  const existing = id ? await get('transactions', id) : null;
  if (id && !existing) throw new Error('Transaction introuvable (supprimée entre-temps ?).');
  const base = {
    kind: value.kind,
    label: value.label,
    amountCents: value.amountCents,
    date: value.date,
    month: monthKeyOf(value.date),
    description: value.description ?? '',
  };
  if (value.kind === 'expense') Object.assign(base, { categoryId: value.categoryId, expenseType: value.expenseType });
  else Object.assign(base, { incomeType: value.incomeType });

  const record = existing
    ? { ...pick(existing, ['id', 'createdAt', 'recurringId', 'occurrenceKey']), ...base, updatedAt: nowStamp() }
    : { id: uid(), ...base, createdAt: nowStamp(), updatedAt: nowStamp() };
  // Ne jamais stocker undefined pour les index : on retire les clés absentes.
  for (const k of Object.keys(record)) if (record[k] === undefined || record[k] === null) delete record[k];

  await transaction('transactions', 'readwrite', (s) => s.transactions.put(record));
  changed('transactions', { id: record.id, action: existing ? 'update' : 'create' });
  return record;
}

/**
 * Supprime une transaction et renvoie l'enregistrement supprimé (pour « Annuler »).
 * Si elle provient d'une récurrence, son occurrence est mémorisée pour ne jamais être recréée.
 */
export async function deleteTransaction(id) {
  const deleted = await transaction(['transactions', 'recurrences'], 'readwrite', async (s) => {
    const rec = await s.transactions.get(id);
    if (!rec) return null;
    await s.transactions.delete(id);
    if (rec.recurringId && rec.occurrenceKey) {
      const r = await s.recurrences.get(rec.recurringId);
      if (r && !r.skippedKeys?.includes(rec.occurrenceKey)) {
        await s.recurrences.put({ ...r, skippedKeys: [...(r.skippedKeys ?? []), rec.occurrenceKey] });
      }
    }
    return rec;
  });
  if (deleted) changed('transactions', { id, action: 'delete' });
  return deleted;
}

/** Restaure une transaction supprimée (bouton « Annuler »), avec son identifiant d'origine. */
export async function restoreTransaction(record) {
  await transaction(['transactions', 'recurrences'], 'readwrite', async (s) => {
    await s.transactions.put(record);
    if (record.recurringId && record.occurrenceKey) {
      const r = await s.recurrences.get(record.recurringId);
      if (r?.skippedKeys?.includes(record.occurrenceKey)) {
        await s.recurrences.put({ ...r, skippedKeys: r.skippedKeys.filter((k) => k !== record.occurrenceKey) });
      }
    }
  });
  changed('transactions', { id: record.id, action: 'restore' });
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ---------------------------------------------------------------- Épargne : contrôles

/**
 * Vérifie la cohérence de l'épargne après une modification simulée :
 * aucun mouvement avant la date de départ de son compte, aucun solde négatif.
 * Lève une erreur explicite sinon (la transaction IndexedDB est alors annulée).
 */
function assertSavingsConsistent(accounts, movements) {
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const early = findMovementBeforeOpening(accounts, movements);
  if (early) {
    throw new Error(`Le mouvement du ${formatDate(early.date)} est antérieur à la date de départ du compte. Avance la date du mouvement ou recule celle du solde de départ.`);
  }
  const neg = findNegativeBalance(accounts, movements);
  if (neg) {
    throw new Error(`Opération refusée : le compte « ${names.get(neg.accountId) ?? '?'} » serait à ${formatMoney(neg.balanceCents)} le ${formatDate(neg.date)}. Un compte d'épargne ne peut pas être négatif.`);
  }
}

// ---------------------------------------------------------------- Comptes d'épargne

export async function listSavingsAccounts() {
  const all = await getAll('savingsAccounts');
  return all.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'fr'));
}

/** Crée ou met à jour un compte (valeur déjà validée par validateAccount). */
export async function saveSavingsAccount(value, id = null) {
  const record = await transaction(['savingsAccounts', 'savingsMovements'], 'readwrite', async (s) => {
    const accounts = await s.savingsAccounts.getAll();
    const existing = id ? accounts.find((a) => a.id === id) : null;
    if (id && !existing) throw new Error('Compte introuvable.');
    const rec = existing
      ? { ...existing, ...value, color: value.color ?? existing.color, updatedAt: nowStamp() }
      : { id: uid(), archived: false, order: accounts.length, ...value, color: value.color ?? null, createdAt: nowStamp(), updatedAt: nowStamp() };
    const next = existing ? accounts.map((a) => (a.id === id ? rec : a)) : [...accounts, rec];
    assertSavingsConsistent(next, await s.savingsMovements.getAll());
    await s.savingsAccounts.put(rec);
    return rec;
  });
  changed('savingsAccounts');
  return record;
}

export async function setSavingsAccountArchived(id, archived) {
  await transaction('savingsAccounts', 'readwrite', async (s) => {
    const a = await s.savingsAccounts.get(id);
    if (a) await s.savingsAccounts.put({ ...a, archived, updatedAt: nowStamp() });
  });
  changed('savingsAccounts');
}

/** Supprime un compte sans aucun mouvement (sinon : archiver pour garder l'historique). */
export async function deleteSavingsAccount(id) {
  await transaction(['savingsAccounts', 'savingsMovements'], 'readwrite', async (s) => {
    const used = (await s.savingsMovements.getAll()).some((m) => m.accountId === id || m.toAccountId === id);
    if (used) throw new Error('Ce compte a des mouvements : archive-le pour conserver l\'historique.');
    await s.savingsAccounts.delete(id);
  });
  changed('savingsAccounts');
}

// ---------------------------------------------------------------- Mouvements d'épargne

export async function listAllMovements() {
  return getAll('savingsMovements');
}

export async function listMovementsBetween(fromISO, toISO) {
  return transaction('savingsMovements', 'readonly', (s) => s.savingsMovements.byIndex('date', IDBKeyRange.bound(fromISO, toISO)));
}

/** Crée ou met à jour un mouvement (valeur déjà validée par validateMovement). */
export async function saveMovement(value, id = null) {
  const record = await transaction(['savingsAccounts', 'savingsMovements'], 'readwrite', async (s) => {
    const movements = await s.savingsMovements.getAll();
    const existing = id ? movements.find((m) => m.id === id) : null;
    if (id && !existing) throw new Error('Mouvement introuvable (supprimé entre-temps ?).');
    const rec = {
      ...(existing ? { id: existing.id, createdAt: existing.createdAt } : { id: uid(), createdAt: nowStamp() }),
      type: value.type, amountCents: value.amountCents, date: value.date, month: monthKeyOf(value.date),
      accountId: value.accountId, label: value.label ?? '', description: value.description ?? '', updatedAt: nowStamp(),
    };
    if (value.type === 'transfer') rec.toAccountId = value.toAccountId;
    else if (value.goalId) rec.goalId = value.goalId;
    const next = existing ? movements.map((m) => (m.id === id ? rec : m)) : [...movements, rec];
    assertSavingsConsistent(await s.savingsAccounts.getAll(), next);
    await s.savingsMovements.put(rec);
    return rec;
  });
  changed('savingsMovements', { id: record.id });
  return record;
}

/** Supprime un mouvement, s'il ne rend aucun compte négatif ; renvoie l'enregistrement pour « Annuler ». */
export async function deleteMovement(id) {
  const deleted = await transaction(['savingsAccounts', 'savingsMovements'], 'readwrite', async (s) => {
    const movements = await s.savingsMovements.getAll();
    const rec = movements.find((m) => m.id === id);
    if (!rec) return null;
    assertSavingsConsistent(await s.savingsAccounts.getAll(), movements.filter((m) => m.id !== id));
    await s.savingsMovements.delete(id);
    return rec;
  });
  if (deleted) changed('savingsMovements', { id, action: 'delete' });
  return deleted;
}

export async function restoreMovement(record) {
  await transaction(['savingsAccounts', 'savingsMovements'], 'readwrite', async (s) => {
    const movements = await s.savingsMovements.getAll();
    assertSavingsConsistent(await s.savingsAccounts.getAll(), [...movements.filter((m) => m.id !== record.id), record]);
    await s.savingsMovements.put(record);
  });
  changed('savingsMovements', { id: record.id, action: 'restore' });
}

// ---------------------------------------------------------------- Objectifs

export async function listGoals() {
  const all = await getAll('goals');
  return all.sort((a, b) => Number(a.archived) - Number(b.archived) || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.name.localeCompare(b.name, 'fr'));
}

export async function saveGoal(value, id = null) {
  const existing = id ? await get('goals', id) : null;
  if (id && !existing) throw new Error('Objectif introuvable.');
  const rec = existing
    ? { ...existing, ...value, color: value.color ?? existing.color, updatedAt: nowStamp() }
    : { id: uid(), archived: false, ...value, createdAt: nowStamp(), updatedAt: nowStamp() };
  if (rec.deadline === null) delete rec.deadline;
  await transaction('goals', 'readwrite', (s) => s.goals.put(rec));
  changed('goals');
  return rec;
}

export async function setGoalArchived(id, archived) {
  await transaction('goals', 'readwrite', async (s) => {
    const g = await s.goals.get(id);
    if (g) await s.goals.put({ ...g, archived, updatedAt: nowStamp() });
  });
  changed('goals');
}

/** Supprime un objectif ; les mouvements qui lui étaient affectés deviennent de l'épargne libre. */
export async function deleteGoal(id) {
  await transaction(['goals', 'savingsMovements'], 'readwrite', async (s) => {
    for (const m of await s.savingsMovements.byIndex('goalId', id)) {
      const { goalId, ...rest } = m;
      await s.savingsMovements.put({ ...rest, updatedAt: nowStamp() });
    }
    await s.goals.delete(id);
  });
  changed('goals');
  changed('savingsMovements');
}

// ---------------------------------------------------------------- Récurrences

export async function listRecurrences() {
  const all = await getAll('recurrences');
  return all.sort((a, b) => Number(b.active) - Number(a.active) || a.dayOfMonth - b.dayOfMonth || a.label.localeCompare(b.label, 'fr'));
}

/** Champs d'une récurrence (valeur déjà validée par validateRecurrence). */
function recurrenceRecord(value, existing) {
  const rec = {
    ...(existing ? { id: existing.id, createdAt: existing.createdAt, skippedKeys: existing.skippedKeys ?? [] } : { id: uid(), createdAt: nowStamp(), skippedKeys: [] }),
    kind: value.kind, label: value.label, amountCents: value.amountCents, description: value.description ?? '',
    frequency: value.frequency, interval: value.interval, dayOfMonth: value.dayOfMonth, monthOfYear: value.monthOfYear,
    startDate: value.startDate, endDate: value.endDate, active: value.active !== false, updatedAt: nowStamp(),
  };
  if (value.kind === 'expense') Object.assign(rec, { categoryId: value.categoryId, expenseType: value.expenseType });
  else rec.incomeType = value.incomeType;
  return rec;
}

/**
 * Crée ou modifie une récurrence. Une modification ne s'applique qu'aux occurrences futures :
 * les transactions déjà créées ne sont jamais réécrites.
 */
export async function saveRecurrence(value, id = null) {
  const existing = id ? await get('recurrences', id) : null;
  if (id && !existing) throw new Error('Récurrence introuvable.');
  const rec = recurrenceRecord(value, existing);
  await transaction('recurrences', 'readwrite', (s) => s.recurrences.put(rec));
  changed('recurrences', { id: rec.id });
  return rec;
}

export async function setRecurrenceActive(id, active) {
  await transaction('recurrences', 'readwrite', async (s) => {
    const r = await s.recurrences.get(id);
    if (r) await s.recurrences.put({ ...r, active, updatedAt: nowStamp() });
  });
  changed('recurrences', { id });
}

/** Supprime une récurrence. Les transactions déjà créées sont conservées (sans lien). */
export async function deleteRecurrence(id) {
  await transaction(['recurrences', 'transactions'], 'readwrite', async (s) => {
    for (const t of await s.transactions.byIndex('recurringId', id)) {
      const { recurringId, ...rest } = t; // la clé d'occurrence reste : unicité préservée
      await s.transactions.put({ ...rest, updatedAt: nowStamp() });
    }
    await s.recurrences.delete(id);
  });
  changed('recurrences', { id });
  changed('transactions');
}

/**
 * Crée une transaction ET la récurrence mensuelle qui la répète (« Répéter chaque mois »).
 * La transaction devient la première occurrence : elle ne sera pas recréée.
 */
export async function saveTransactionAsRecurring(value) {
  const day = Number(value.date.slice(8, 10));
  const rec = recurrenceRecord({ ...value, frequency: 'monthly', interval: 1, dayOfMonth: day, monthOfYear: null, startDate: value.date, endDate: null, active: true }, null);
  const tx = { id: uid(), ...transactionFromOccurrence(rec, value.date), month: monthKeyOf(value.date), createdAt: nowStamp(), updatedAt: nowStamp() };
  await transaction(['recurrences', 'transactions'], 'readwrite', async (s) => {
    await s.recurrences.put(rec);
    await s.transactions.put(tx);
  });
  changed('recurrences', { id: rec.id });
  changed('transactions', { id: tx.id, action: 'create' });
  return { recurrence: rec, transaction: tx };
}

/**
 * Crée les occurrences échues manquantes de toutes les récurrences actives.
 * Idempotent : la clé unique d'occurrence empêche tout doublon, même si deux onglets
 * lancent la génération en même temps (l'insertion en double échoue et est ignorée).
 * @returns {Promise<number>} nombre de transactions créées
 */
export async function generateDueOccurrences(today) {
  const created = await transaction(['recurrences', 'transactions'], 'readwrite', async (s) => {
    const recurrences = await s.recurrences.getAll();
    if (!recurrences.some((r) => r.active)) return 0;
    const existing = new Set((await s.transactions.getAll()).map((t) => t.occurrenceKey).filter(Boolean));
    const due = dueOccurrences(recurrences, existing, today);
    for (const { recurrence, date } of due) {
      await s.transactions.add({ id: uid(), ...transactionFromOccurrence(recurrence, date), month: monthKeyOf(date), createdAt: nowStamp(), updatedAt: nowStamp() });
    }
    return due.length;
  }).catch((err) => {
    if (err?.name === 'ConstraintError') return 0; // un autre onglet vient de les créer
    throw err;
  });
  if (created) changed('transactions', { action: 'generate', count: created });
  return created;
}

// ---------------------------------------------------------------- Budgets

export async function listBudgets() {
  return getAll('budgets');
}

/**
 * Remplace tous les budgets d'une portée : par défaut (month = null) ou propres à un mois.
 * @param {string|null} month
 * @param {{ globalCents: number|null, categories: Record<string, number|null> }} values montants validés ; null = pas de budget
 */
export async function setBudgets(month, { globalCents, categories }) {
  await transaction('budgets', 'readwrite', async (s) => {
    for (const b of await s.budgets.getAll()) if ((b.month ?? null) === month) await s.budgets.delete(b.id);
    const put = (scope, categoryId, amountCents) => {
      const rec = { id: budgetId(month, categoryId), scope, amountCents, updatedAt: nowStamp() };
      if (month) rec.month = month;
      if (categoryId) rec.categoryId = categoryId;
      return s.budgets.put(rec);
    };
    if (globalCents) await put('global', null, globalCents);
    for (const [categoryId, cents] of Object.entries(categories)) if (cents) await put('category', categoryId, cents);
  });
  changed('budgets');
}

/** Supprime les budgets propres à un mois (le mois revient aux budgets par défaut). */
export async function clearMonthBudgets(month) {
  await transaction('budgets', 'readwrite', async (s) => {
    for (const b of await s.budgets.byIndex('month', month)) await s.budgets.delete(b.id);
  });
  changed('budgets');
}

export { occurrenceKey };
