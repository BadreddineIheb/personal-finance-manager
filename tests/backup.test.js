import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup, mergeData, STORE_NAMES } from '../js/data/backup-validate.js';
import { DEFAULT_CATEGORIES } from '../js/data/schema.js';

const base = () => ({
  app: 'personal-finance-manager', schemaVersion: 1, exportedAt: '2026-11-09T10:00:00.000Z',
  data: {
    settings: { theme: 'dark', openingBalanceCents: 100000, openingBalanceDate: '2026-11-01', lastExportAt: null, simulatorDefaultRate: '3', installedAt: '2026-11-01T00:00:00.000Z' },
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    transactions: [
      { id: 't1', kind: 'expense', label: 'Courses', amountCents: 6420, date: '2026-11-08', month: '1999-01', categoryId: 'cat_groceries', expenseType: 'variable', description: '', createdAt: '2026-11-08T10:00:00.000Z', updatedAt: '2026-11-08T10:00:00.000Z', pirate: '<script>' },
      { id: 't2', kind: 'income', label: 'Salaire', amountCents: 124500, date: '2026-11-05', incomeType: 'apprenticeship', recurringId: 'r1', occurrenceKey: 'r1@2026-11-05' },
    ],
    savingsAccounts: [{ id: 'A', name: 'Livret A', type: 'livretA', openingBalanceCents: 150000, openingDate: '2026-11-01', color: '#3d4fd6', archived: false, order: 0 }],
    savingsMovements: [{ id: 'm1', type: 'deposit', amountCents: 20000, date: '2026-11-07', accountId: 'A', goalId: 'g1', label: '', description: '' }],
    goals: [{ id: 'g1', name: 'Réserve', targetCents: 300000, deadline: '2027-06-30', archived: false }],
    budgets: [{ id: 'default:global', scope: 'global', amountCents: 120000 }, { id: 'default:cat_groceries', scope: 'category', categoryId: 'cat_groceries', amountCents: 25000 }],
    recurrences: [{ id: 'r1', kind: 'income', label: 'Salaire', amountCents: 124500, incomeType: 'apprenticeship', frequency: 'monthly', interval: 1, dayOfMonth: 5, monthOfYear: null, startDate: '2026-09-05', endDate: null, active: true, skippedKeys: [] }],
  },
});

test('sauvegarde valide : normalisée (mois recalculé, champs inconnus retirés), résumé', () => {
  const r = validateBackup(base());
  assert.equal(r.ok, true, r.errors.join(' | '));
  assert.equal(r.data.transactions[0].month, '2026-11', 'le mois est recalculé depuis la date');
  assert.equal(r.data.transactions[0].pirate, undefined, 'champ inconnu supprimé');
  assert.equal(r.data.savingsMovements[0].month, '2026-11');
  assert.equal(r.data.settings.theme, 'dark');
  assert.equal(r.summary.counts.transactions, 2);
  assert.equal(r.summary.firstMonth, '2026-11');
  assert.deepEqual(Object.keys(r.summary.counts), STORE_NAMES);
});

test('fichiers refusés : autre application, version future, mauvaise structure', () => {
  assert.match(validateBackup(null).errors[0], /pas une sauvegarde/);
  assert.match(validateBackup([]).errors[0], /pas une sauvegarde/);
  assert.match(validateBackup({ ...base(), app: 'autre' }).errors[0], /ne provient pas/);
  assert.match(validateBackup({ ...base(), schemaVersion: 99 }).errors[0], /plus récente/);
  assert.match(validateBackup({ ...base(), data: null }).errors[0], /data/);
  const b = base(); b.data.transactions = 'oups';
  assert.match(validateBackup(b).errors[0], /liste/);
});

test('enregistrements invalides : montant flottant, date impossible, référence inconnue, doublons', () => {
  const cases = [
    [(d) => { d.transactions[0].amountCents = 64.2; }, /montant invalide \(64\.2/],
    [(d) => { d.transactions[0].amountCents = -100; }, /montant invalide/],
    [(d) => { d.transactions[0].amountCents = '6420'; }, /montant invalide/],
    [(d) => { d.transactions[0].date = '2026-02-30'; }, /date invalide/],
    [(d) => { d.transactions[0].categoryId = 'cat_inconnue'; }, /catégorie inconnue/],
    [(d) => { d.transactions.push({ ...d.transactions[0] }); }, /identifiant en double/],
    [(d) => { d.savingsMovements[0].accountId = 'Z'; }, /compte d'épargne inconnu/],
    [(d) => { d.savingsMovements[0].goalId = 'Z'; }, /objectif inconnu/],
    [(d) => { d.savingsMovements.push({ id: 'm2', type: 'withdrawal', amountCents: 999999, date: '2026-11-08', accountId: 'A' }); }, /deviendrait négatif/],
    [(d) => { d.savingsMovements[0].date = '2026-10-01'; }, /précède la date de départ/],
    [(d) => { d.transactions.push({ ...d.transactions[1], id: 't3' }); }, /Échéance récurrente en double/],
    [(d) => { d.settings.theme = 'rose'; }, /Paramètre « theme »/],
    [(d) => { d.recurrences[0].dayOfMonth = 40; }, /récurrence/],
    [(d) => { d.transactions[0].label = ''; }, /opération n° 1/],
  ];
  for (const [mutate, re] of cases) {
    const b = base();
    mutate(b.data);
    const r = validateBackup(b);
    assert.equal(r.ok, false, `devrait être refusé : ${re}`);
    assert.match(r.errors.join(' | '), re);
  }
});

test('nombre d\'erreurs plafonné, message localisé', () => {
  const b = base();
  b.data.transactions = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, kind: 'expense', label: `Ligne ${i}`, amountCents: 1.5, date: '2026-11-01', categoryId: 'cat_other', expenseType: 'variable' }));
  const r = validateBackup(b);
  assert.equal(r.errors.length, 12);
  assert.match(r.errors[0], /opération n° 1 \(« Ligne 0 »\)/);
});

test('fusion : ajouts, version la plus récente conservée, pas de doublon d\'échéance, paramètres locaux gardés', () => {
  const incoming = validateBackup(base()).data;
  const local = { ...Object.fromEntries(STORE_NAMES.map((n) => [n, []])), settings: { theme: 'light' } };
  local.categories = incoming.categories;
  local.transactions = [
    { ...incoming.transactions[0], label: 'Courses (local, plus récent)', updatedAt: '2026-11-09T09:00:00.000Z' },
    { id: 'local-salary', kind: 'income', label: 'Salaire', amountCents: 124500, date: '2026-11-05', month: '2026-11', incomeType: 'apprenticeship', recurringId: 'r1', occurrenceKey: 'r1@2026-11-05' },
  ];
  const { data, added, updated } = mergeData(local, incoming);
  assert.equal(data.transactions.length, 2, 'l\'échéance r1@2026-11-05 existe déjà localement : pas de doublon');
  assert.equal(data.transactions.find((t) => t.id === 't1').label, 'Courses (local, plus récent)');
  assert.equal(updated, 0);
  assert.ok(added >= 5);
  assert.equal(data.settings.theme, 'light');
  // un élément entrant plus récent remplace le local
  const newer = { ...incoming, transactions: [{ ...incoming.transactions[0], label: 'Nouveau', updatedAt: '2026-12-01T00:00:00.000Z' }] };
  assert.equal(mergeData(local, newer).data.transactions.find((t) => t.id === 't1').label, 'Nouveau');
});
