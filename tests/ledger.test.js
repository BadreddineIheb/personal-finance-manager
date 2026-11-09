import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMonth, variation, variationTone } from '../js/domain/ledger.js';
import {
  filterTransactions, sortTransactions, totalsByCategory, totalsByExpenseType, topTransactions, total, normalize,
} from '../js/domain/transactions.js';
import { validateTransaction, validateSignedAmount } from '../js/core/validation.js';

const inc = (id, cents, date = '2026-11-05', incomeType = 'salary', label = 'Salaire') => ({ id, kind: 'income', label, amountCents: cents, date, incomeType });
const exp = (id, cents, categoryId, expenseType, date = '2026-11-08', label = id) => ({ id, kind: 'expense', label, amountCents: cents, date, categoryId, expenseType });

// Jeu de données de la maquette du dashboard, calculé à la main.
const NOV = [
  inc('i1', 124500, '2026-11-05', 'apprenticeship', 'Salaire alternance'),
  inc('i2', 59750, '2026-11-06', 'benefit', 'APL'),
  exp('loyer', 52000, 'cat_housing', 'fixed', '2026-11-01', 'Loyer novembre'),
  exp('assur', 22200, 'cat_insurance', 'fixed'),
  exp('courses', 21240, 'cat_groceries', 'variable'),
  exp('essence', 5578, 'cat_transport', 'variable'),
  exp('frein', 28600, 'cat_car', 'exceptional', '2026-11-03', 'Plaquettes de frein'),
];

test('summarizeMonth : revenus, dépenses par type, excédent, taux', () => {
  const s = summarizeMonth(NOV);
  assert.equal(s.income, 184250); // 1 245,00 + 597,50
  assert.equal(s.fixed, 74200);
  assert.equal(s.variable, 26818);
  assert.equal(s.exceptional, 28600);
  assert.equal(s.expenses, 129618); // 1 296,18 €
  assert.equal(s.surplus, 54632);
  assert.equal(s.savingsRate, 29.7);
  assert.equal(s.saved, 0);
  assert.equal(s.remaining, 54632);
  assert.equal(s.incomeCount, 2);
  assert.equal(s.expenseCount, 5);
});

test('summarizeMonth : l\'épargne n\'est jamais comptée comme une dépense', () => {
  const movements = [
    { type: 'deposit', amountCents: 40000 },
    { type: 'deposit', amountCents: 5000 },
    { type: 'withdrawal', amountCents: 5000 },
    { type: 'transfer', amountCents: 99999 }, // entre comptes d'épargne : neutre
    { type: 'interest', amountCents: 1234 }, // intérêts : ni revenu, ni T
  ];
  const s = summarizeMonth(NOV, movements);
  assert.equal(s.expenses, 129618, 'les dépenses ne changent pas');
  assert.equal(s.income, 184250, 'les intérêts ne sont pas des revenus');
  assert.equal(s.savingsRate, 29.7, 'le taux reste (R − D) / R');
  assert.equal(s.saved, 40000);
  assert.equal(s.interest, 1234);
  assert.equal(s.remaining, 54632 - 40000);
});

test('summarizeMonth : mois vide et mois sans revenu', () => {
  const empty = summarizeMonth([]);
  assert.equal(empty.income, 0);
  assert.equal(empty.savingsRate, null, 'pas de NaN');
  const noIncome = summarizeMonth([exp('a', 1000, 'cat_other', 'variable')]);
  assert.equal(noIncome.surplus, -1000);
  assert.equal(noIncome.savingsRate, null);
});

test('variation et tonalité', () => {
  assert.deepEqual(variation(110, 100), { diff: 10, pct: 10 });
  assert.deepEqual(variation(100, 0), { diff: 100, pct: null });
  assert.equal(variationTone(10, 'up', 10), 'good');
  assert.equal(variationTone(10, 'down', 10), 'bad');
  assert.equal(variationTone(-10, 'down', -10), 'good');
  assert.equal(variationTone(1, 'up', 0.2), 'flat');
  assert.equal(variationTone(0, 'up'), 'flat');
});

test('filtres, recherche sans accents, tri', () => {
  const cats = new Map([['cat_car', { name: 'Voiture / Entretien' }]]);
  assert.equal(normalize('Électricité'), 'electricite');
  assert.equal(filterTransactions(NOV, { kind: 'expense' }).length, 5);
  assert.equal(filterTransactions(NOV, { query: 'voiture' }, cats)[0].id, 'frein', 'recherche dans le nom de catégorie');
  assert.equal(filterTransactions(NOV, { query: 'PLAQUETTES frein' }).length, 1, 'plusieurs mots, casse ignorée');
  assert.equal(filterTransactions(NOV, { expenseTypes: ['fixed'] }).length, 2);
  assert.equal(filterTransactions(NOV, { categoryIds: ['cat_groceries', 'cat_transport'] }).length, 2);
  assert.equal(filterTransactions(NOV, { minCents: 50000 }).length, 3);
  assert.equal(filterTransactions(NOV, { minCents: 20000, maxCents: 30000, kind: 'expense' }).length, 3);
  assert.equal(filterTransactions(NOV, { from: '2026-11-04', to: '2026-11-06' }).length, 2);
  assert.deepEqual(sortTransactions(NOV, 'amount', 'desc').slice(0, 2).map((t) => t.id), ['i1', 'i2']);
  assert.equal(sortTransactions(NOV, 'date', 'asc')[0].id, 'loyer');
  assert.equal(sortTransactions(NOV, 'label', 'asc')[0].label, 'APL');
});

test('totaux par catégorie (pourcentages = 100 %), par type, top', () => {
  const expenses = NOV.filter((t) => t.kind === 'expense');
  const rows = totalsByCategory(expenses);
  assert.equal(rows[0].categoryId, 'cat_housing');
  assert.equal(rows[0].totalCents, 52000);
  assert.equal(Math.round(rows.reduce((s, r) => s + r.percent * 10, 0)), 1000);
  assert.equal(total(expenses), 129618);
  assert.deepEqual(totalsByExpenseType(expenses), { fixed: 74200, variable: 26818, exceptional: 28600 });
  assert.deepEqual(topTransactions(expenses, 2).map((t) => t.id), ['loyer', 'frein']);
});

test('validateTransaction', () => {
  const ids = new Set(['cat_groceries']);
  const ok = validateTransaction({ kind: 'expense', label: '  Courses   Leclerc ', amount: '64,20', date: '08/11/2026', categoryId: 'cat_groceries', expenseType: 'variable' }, { categoryIds: ids });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { kind: 'expense', label: 'Courses Leclerc', amountCents: 6420, date: '2026-11-08', description: '', categoryId: 'cat_groceries', expenseType: 'variable' });

  const bad = validateTransaction({ kind: 'expense', label: '', amount: '12,345', date: '31/02/2026', categoryId: 'inconnue', expenseType: 'x' }, { categoryIds: ids });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'categoryId', 'date', 'expenseType', 'label']);

  const income = validateTransaction({ kind: 'income', label: 'Salaire', amount: '1245', date: '2026-11-05', incomeType: 'apprenticeship' });
  assert.equal(income.ok, true);
  assert.equal(income.value.amountCents, 124500);
  assert.equal(validateTransaction({ kind: 'income', label: 'x', amount: '1', date: '2026-11-05', incomeType: 'nope' }).ok, false);
  assert.equal(validateTransaction({ kind: 'expense', label: 'x'.repeat(81), amount: '1', date: '2026-11-05', categoryId: 'cat_groceries', expenseType: 'fixed' }).errors.label, '80 caractères maximum.');
});

test('validateSignedAmount (solde de départ)', () => {
  assert.deepEqual(validateSignedAmount('-150,25'), { ok: true, cents: -15025 });
  assert.deepEqual(validateSignedAmount('−150'), { ok: true, cents: -15000 });
  assert.deepEqual(validateSignedAmount(''), { ok: true, cents: 0 });
  assert.deepEqual(validateSignedAmount('0'), { ok: true, cents: 0 });
  assert.equal(validateSignedAmount('abc').ok, false);
});

test('accountBalance : solde de départ + flux, épargne déduite, transferts neutres', async () => {
  const { accountBalance } = await import('../js/domain/ledger.js');
  const opening = { openingBalanceCents: 100000, openingBalanceDate: '2026-11-01' };
  const tx = [
    inc('a', 124500, '2026-11-05'),
    exp('b', 52000, 'cat_housing', 'fixed', '2026-11-01'),
    exp('c', 1000, 'cat_other', 'variable', '2026-10-31'), // avant le solde de départ : ignorée
    exp('d', 2000, 'cat_other', 'variable', '2026-12-02'), // après la date demandée : ignorée
  ];
  const mv = [
    { type: 'deposit', amountCents: 40000, date: '2026-11-06' },
    { type: 'withdrawal', amountCents: 5000, date: '2026-11-20' },
    { type: 'transfer', amountCents: 9999, date: '2026-11-21' },
    { type: 'interest', amountCents: 300, date: '2026-11-21' },
  ];
  assert.equal(accountBalance(opening, '2026-11-30', tx, mv), 100000 + 124500 - 52000 - 40000 + 5000);
  assert.equal(accountBalance(opening, '2026-11-04', tx, mv), 100000 - 52000);
  assert.equal(accountBalance(opening, '2026-10-31', tx, mv), null);
  assert.equal(accountBalance({ openingBalanceCents: 0, openingBalanceDate: null }, '2026-11-30', tx), null);
  assert.equal(accountBalance({ openingBalanceCents: -25050, openingBalanceDate: '2026-11-01' }, '2026-11-01', []), -25050);
});
