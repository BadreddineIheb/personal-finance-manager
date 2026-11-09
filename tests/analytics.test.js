import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlySummaries, averageSavingsRate, topSpendingMonths, topCategories, calendarMonth, insights } from '../js/domain/analytics.js';
import { simulate, monthsToReach, monthlyInterest, formatDuration } from '../js/domain/simulator.js';

const tx = (kind, cents, date, extra = {}) => ({ kind, amountCents: cents, date, month: date.slice(0, 7), ...extra });
const e = (cents, date, categoryId, expenseType = 'variable') => tx('expense', cents, date, { categoryId, expenseType });
const i = (cents, date) => tx('income', cents, date, { incomeType: 'salary' });

const DATA = [
  i(150000, '2026-08-05'), e(50000, '2026-08-01', 'housing', 'fixed'), e(10000, '2026-08-10', 'resto'),
  i(150000, '2026-09-05'), e(50000, '2026-09-01', 'housing', 'fixed'), e(12000, '2026-09-10', 'resto'),
  i(150000, '2026-10-05'), e(50000, '2026-10-01', 'housing', 'fixed'), e(11000, '2026-10-10', 'resto'),
  i(150000, '2026-11-05'), e(50000, '2026-11-01', 'housing', 'fixed'), e(19000, '2026-11-10', 'resto'), e(60000, '2026-11-03', 'car', 'exceptional'),
];

test('séries mensuelles, taux moyen pondéré, mois les plus dépensiers, top catégories', () => {
  const s = monthlySummaries(DATA, [], '2026-07', '2026-11');
  assert.equal(s.length, 5);
  assert.equal(s[0].expenses, 0);
  assert.equal(s[4].expenses, 129000);
  // Σ(R − D) / ΣR = (90000 + 88000 + 89000 + 21000) / 600000 = 48 %
  assert.equal(averageSavingsRate(s), 48);
  assert.equal(averageSavingsRate([{ income: 0, surplus: -10 }]), null);
  assert.deepEqual(topSpendingMonths(s, 2).map((x) => x.month), ['2026-11', '2026-09']);
  assert.deepEqual(topCategories(DATA).map((c) => c.categoryId), ['housing', 'car', 'resto']);
});

test('calendrier : semaines commençant le lundi, totaux par jour, échéances', () => {
  const c = calendarMonth('2026-11', DATA.filter((t) => t.month === '2026-11'), [{ date: '2026-11-15', recurrence: { label: 'Netflix' } }]);
  assert.equal(c.weeks[0].slice(0, 6).every((d) => d === null), true, 'le 1er novembre 2026 est un dimanche');
  assert.equal(c.weeks[0][6].date, '2026-11-01');
  assert.equal(c.weeks[0][6].expense, 50000);
  assert.equal(c.weeks.flat().filter(Boolean).length, 30);
  assert.equal(c.weeks.every((w) => w.length === 7), true);
  assert.equal(c.maxExpense, 60000);
  assert.equal(c.weeks.flat().find((d) => d?.date === '2026-11-15').upcoming.length, 1);
  assert.equal(c.weeks.flat().find((d) => d?.date === '2026-11-05').income, 150000);
});

test('pistes d\'amélioration fondées sur les données', () => {
  const summaries = monthlySummaries(DATA, [], '2026-08', '2026-11');
  const budgets = [{ scope: 'category', categoryId: 'resto', amountCents: 9000 }];
  const recurrences = [{ active: true, kind: 'expense', categoryId: 'cat_subscriptions', label: 'Netflix', amountCents: 1349, frequency: 'monthly', interval: 1 },
    { active: false, kind: 'expense', categoryId: 'cat_subscriptions', label: 'Ancien', amountCents: 999, frequency: 'monthly', interval: 1 }];
  const list = insights({ month: '2026-11', transactions: DATA, summaries, budgets, recurrences, categoriesById: new Map([['resto', { name: 'Restaurants' }]]) });
  const keys = list.map((x) => x.key);
  assert.ok(keys.includes('cat-resto'), 'restaurants : 190 € vs moyenne 110 €');
  assert.equal(list.find((x) => x.key === 'cat-resto').detail.average, 11000);
  assert.ok(!keys.includes('cat-housing'), 'loyer stable : pas de piste');
  assert.ok(!keys.includes('cat-car'), 'aucun historique pour la voiture : pas de comparaison inventée');
  assert.ok(keys.includes('budget-resto'), 'budget dépassé en sept., oct. et nov.');
  assert.ok(keys.includes('rate-down'));
  assert.ok(keys.includes('exceptional'));
  assert.deepEqual(list.find((x) => x.key === 'subscriptions').detail, { count: 1, monthly: 1349, yearly: 16188, items: [{ label: 'Netflix', monthly: 1349 }] });
  // historique insuffisant : aucune piste comparative
  const one = insights({ month: '2026-08', transactions: DATA, summaries });
  assert.equal(one.filter((x) => x.key.startsWith('cat-') || x.key.startsWith('rate')).length, 0);
});

test('simulateur : sans intérêts, avec intérêts au centime, durée pour un objectif', () => {
  const plain = simulate({ startCents: 100000, monthlyCents: 20000, months: 12 });
  assert.equal(plain[2].balanceCents, 160000);
  assert.equal(plain[11].balanceCents, 340000);
  assert.equal(plain[11].interestCents, 0);
  assert.equal(monthlyInterest(100000, 300), 250); // 1 000 € à 3 % → 2,50 € par mois
  assert.equal(monthlyInterest(33333, 240), 67); // 0,6666… arrondi au centime
  const r = simulate({ startCents: 100000, monthlyCents: 0, rateBp: 300, months: 12 });
  assert.equal(r[11].balanceCents, 103042); // capitalisation mensuelle
  assert.equal(r[11].depositedCents, 0);
  assert.equal(monthsToReach({ targetCents: 300000, startCents: 100000, monthlyCents: 20000 }), 10);
  assert.equal(monthsToReach({ targetCents: 300000, startCents: 300000, monthlyCents: 0 }), 0);
  assert.equal(monthsToReach({ targetCents: 300000, startCents: 0, monthlyCents: 0 }), null);
  assert.ok(monthsToReach({ targetCents: 300000, startCents: 100000, monthlyCents: 20000, rateBp: 300 }) <= 10);
  assert.equal(formatDuration(14), '1 an et 2 mois');
  assert.equal(formatDuration(24), '2 ans');
  assert.equal(formatDuration(5), '5 mois');
});
