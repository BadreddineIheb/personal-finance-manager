import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyReport, buildAnnualReport, pdfText } from '../js/reports/report-data.js';

const tx = (kind, cents, date, extra = {}) => ({ kind, amountCents: cents, date, month: date.slice(0, 7), label: extra.label ?? kind, ...extra });
const DATA = [
  tx('income', 150000, '2026-10-05', { incomeType: 'salary' }), tx('expense', 50000, '2026-10-01', { categoryId: 'housing', expenseType: 'fixed' }), tx('expense', 20000, '2026-10-12', { categoryId: 'food', expenseType: 'variable' }),
  tx('income', 150000, '2026-11-05', { incomeType: 'salary' }), tx('income', 18500, '2026-11-06', { incomeType: 'benefit' }),
  tx('expense', 50000, '2026-11-01', { categoryId: 'housing', expenseType: 'fixed' }), tx('expense', 25000, '2026-11-12', { categoryId: 'food', expenseType: 'variable' }),
  tx('expense', 30000, '2026-11-03', { categoryId: 'car', expenseType: 'exceptional', label: 'Freins' }),
];
const MOVES = [{ type: 'deposit', amountCents: 40000, date: '2026-11-07', month: '2026-11', accountId: 'A', goalId: 'g' }];
const ACC = [{ id: 'A', openingBalanceCents: 100000, openingDate: '2026-10-01' }];
const CATS = new Map([['housing', { name: 'Logement / Loyer' }], ['food', { name: 'Courses' }], ['car', { name: 'Voiture' }]]);
const plain = (a) => a.map(pdfText);

test('rapport mensuel : chiffres, comparaison, résumé rédigé', () => {
  const r = buildMonthlyReport({ month: '2026-11', transactions: DATA, movements: MOVES, accounts: ACC, goals: [{ id: 'g', name: 'Réserve', targetCents: 300000 }],
    settings: { openingBalanceCents: 200000, openingBalanceDate: '2026-10-01' }, categoriesById: CATS });
  assert.equal(r.s.income, 168500);
  assert.equal(r.s.expenses, 105000);
  assert.equal(r.s.saved, 40000);
  assert.equal(r.incomes.length, 2);
  assert.deepEqual(r.byCategory.map((c) => c.categoryId), ['housing', 'car', 'food']);
  assert.equal(r.exceptional.length, 1);
  assert.equal(r.balance, 200000 + 150000 - 70000 + 168500 - 105000 - 40000);
  assert.equal(r.savingsTotal, 140000);
  assert.equal(r.goals[0].savedCents, 40000);
  assert.equal(r.comparison.find((c) => c.label === 'Total des dépenses').pct, 50);
  assert.deepEqual(plain(r.summary), [
    'En novembre 2026, les revenus s\'élèvent à 1 685,00 € et les dépenses à 1 050,00 € (+50,0 % par rapport à octobre).',
    'Le mois dégage un excédent de 635,00 €, soit un taux d\'épargne de 37,7 %.',
    'Le taux d\'épargne recule de 15,6 pts par rapport au mois précédent.',
    '400,00 € ont été virés vers l\'épargne.',
    'Les dépenses exceptionnelles (300,00 €) représentent 28,6 % des dépenses du mois.',
    'Le premier poste de dépenses est « Logement / Loyer » (500,00 €, 47,6 %).',
    'Le solde du compte courant en fin de mois est de 3 035,00 € et l\'épargne totale de 1 400,00 €.',
  ]);
});

test('rapport mensuel d\'un mois vide', () => {
  const r = buildMonthlyReport({ month: '2026-05', transactions: DATA, movements: [] });
  assert.deepEqual(r.summary, ['Aucune opération n\'a été enregistrée en mai 2026.']);
  assert.equal(r.hasPrevious, false);
});

test('rapport annuel : 12 lignes, totaux, moyennes sur les mois actifs, patrimoine', () => {
  const r = buildAnnualReport({ year: '2026', transactions: DATA, movements: MOVES, accounts: ACC, settings: { openingBalanceCents: 200000, openingBalanceDate: '2026-10-01' }, categoriesById: CATS });
  assert.equal(r.rows.length, 12);
  assert.equal(r.active.length, 2);
  assert.equal(r.totals.income, 318500);
  assert.equal(r.totals.expenses, 175000);
  assert.equal(r.averages.expenses, 87500);
  assert.equal(r.avgRate, 45.1); // 143 500 / 318 500
  assert.equal(r.topMonths[0].month, '2026-11');
  assert.equal(r.wealthStart, 200000 + 150000 - 70000 + 100000, 'pas de donnée au 1er janvier : fin du premier mois suivi');
  assert.equal(r.wealthStartLabel, 'octobre 2026');
  assert.equal(r.wealthEnd, 200000 + 100000 + 143500);
  assert.equal(r.rows[9].balance, 280000);
  assert.ok(pdfText(r.summary[0]).startsWith('En 2026, 2 mois comportent des opérations.'));
});

test('pdfText : uniquement des caractères des polices PDF standard', () => {
  assert.equal(pdfText('−1 234,56 € → Σ'), '-1 234,56 € -> Somme');
});
