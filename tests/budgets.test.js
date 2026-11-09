import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBudgets, budgetStatus, budgetOverview, budgetId } from '../js/domain/budgets.js';
import { forecastMonth } from '../js/domain/forecast.js';

const B = (month, scope, categoryId, cents) => ({ id: budgetId(month, categoryId), month, scope, categoryId, amountCents: cents });
const exp = (cents, categoryId, expenseType = 'variable', date = '2026-11-05') => ({ kind: 'expense', amountCents: cents, categoryId, expenseType, date });
const inc = (cents, date = '2026-11-05') => ({ kind: 'income', amountCents: cents, date, incomeType: 'salary' });

test('budget du mois prioritaire sur le budget par défaut', () => {
  const budgets = [B(null, 'global', null, 150000), B(null, 'category', 'food', 35000), B('2026-12', 'category', 'food', 50000), B('2026-12', 'global', null, 200000)];
  const nov = resolveBudgets(budgets, '2026-11');
  assert.deepEqual(nov.global, { amountCents: 150000, source: 'default' });
  assert.deepEqual(nov.categories.get('food'), { amountCents: 35000, source: 'default' });
  const dec = resolveBudgets(budgets, '2026-12');
  assert.deepEqual(dec.global, { amountCents: 200000, source: 'month' });
  assert.deepEqual(dec.categories.get('food'), { amountCents: 50000, source: 'month' });
  assert.equal(resolveBudgets([], '2026-11').global, null);
});

test('seuils exacts 80 % / 100 % / dépassement', () => {
  assert.equal(budgetStatus(7999, 10000).state, 'ok');
  assert.equal(budgetStatus(8000, 10000).state, 'warn');
  assert.equal(budgetStatus(9999, 10000).state, 'warn');
  assert.equal(budgetStatus(10000, 10000).state, 'reached');
  assert.equal(budgetStatus(10001, 10000).state, 'over');
  assert.deepEqual(budgetStatus(12410, 10000), { spentCents: 12410, budgetCents: 10000, remainingCents: -2410, percent: 124.1, state: 'over' });
  assert.equal(budgetStatus(0, 10000).percent, 0);
  // 2/3 de 1 € : 66,7 % (pas d'erreur flottante sur le seuil)
  assert.equal(budgetStatus(67, 100).state, 'ok');
  assert.equal(budgetStatus(80, 100).state, 'warn');
});

test('synthèse : exceptionnelles incluses, catégories sans budget, alertes, cohérence global', () => {
  const budgets = [B(null, 'global', null, 100000), B(null, 'category', 'food', 35000), B(null, 'category', 'resto', 8000), B(null, 'category', 'car', 70000)];
  const tx = [exp(21240, 'food'), exp(9850, 'resto'), exp(28600, 'car', 'exceptional'), exp(52000, 'housing', 'fixed'), inc(124500)];
  const o = budgetOverview(budgets, tx, '2026-11');
  assert.equal(o.totalSpent, 111690);
  assert.equal(o.global.state, 'over');
  assert.equal(o.global.remainingCents, -11690);
  assert.deepEqual(o.categories.map((c) => [c.categoryId, c.state]), [['resto', 'over'], ['food', 'ok'], ['car', 'ok']]);
  assert.deepEqual(o.unbudgeted, [{ categoryId: 'housing', spentCents: 52000 }]);
  assert.deepEqual(o.alerts.map((a) => a.categoryId), [null, 'resto']);
  assert.equal(o.sumOfCategoryBudgets, 113000);
  assert.equal(o.exceedsGlobal, true);
});

const rec = (id, kind, cents, day, extra = {}) => ({ id, kind, label: id, amountCents: cents, frequency: 'monthly', interval: 1, dayOfMonth: day, startDate: '2026-01-01', endDate: null, active: true, skippedKeys: [], ...extra });

test('estimation du mois en cours : récurrences à venir + projection des variables', () => {
  const tx = [inc(124500, '2026-11-05'), exp(52000, 'housing', 'fixed', '2026-11-01'), exp(21240, 'food', 'variable', '2026-11-08'), exp(28600, 'car', 'exceptional', '2026-11-03'), exp(5760, 'fuel', 'variable', '2026-11-07')];
  const recs = [rec('netflix', 'expense', 1349, 15), rec('mobile', 'expense', 999, 20), rec('apl', 'income', 18500, 25), rec('loyer', 'expense', 52000, 1)];
  const f = forecastMonth({ month: '2026-11', today: '2026-11-09', transactions: tx, recurrences: recs });
  assert.equal(f.mode, 'current');
  assert.equal(f.upcomingIncome, 18500);
  assert.equal(f.upcomingExpenses, 2348, 'le loyer du 1er est déjà passé : non compté deux fois');
  assert.equal(f.variableDone, 27000);
  assert.equal(f.daysElapsed, 9);
  assert.equal(f.daysRemaining, 21);
  assert.equal(f.projectedVariable, 63000); // 27 000 × 21 / 9
  assert.equal(f.high, 124500 + 18500 - 107600 - 2348);
  assert.equal(f.low, f.high - 63000);
});

test('estimation : mois passé = réel, mois futur = récurrences + moyenne des variables', () => {
  const past = forecastMonth({ month: '2026-10', today: '2026-11-09', transactions: [inc(1000, '2026-10-01'), exp(400, 'x', 'variable', '2026-10-02')], recurrences: [] });
  assert.deepEqual([past.mode, past.high, past.low], ['final', 600, 600]);
  const recs = [rec('salaire', 'income', 124500, 5), rec('loyer', 'expense', 52000, 1)];
  const fut = forecastMonth({ month: '2026-12', today: '2026-11-09', transactions: [], recurrences: recs, averageVariableCents: 40000 });
  assert.deepEqual([fut.mode, fut.high, fut.low, fut.projectedVariable], ['future', 72500, 32500, 40000]);
  // dernier jour du mois : plus rien à projeter
  const last = forecastMonth({ month: '2026-11', today: '2026-11-30', transactions: [exp(3000, 'f', 'variable', '2026-11-10')], recurrences: [] });
  assert.equal(last.projectedVariable, 0);
});

test('estimation : les dépenses variables saisies à l\'avance ne gonflent pas le rythme', () => {
  const tx = [exp(9000, 'food', 'variable', '2026-11-03'), exp(5000, 'resto', 'variable', '2026-11-20')];
  const f = forecastMonth({ month: '2026-11', today: '2026-11-09', transactions: tx, recurrences: [] });
  // rythme : 90 € en 9 jours → 210 € sur 21 jours, dont 50 € déjà saisis le 20/11 → 160 € à projeter
  assert.equal(f.variableDone, 9000);
  assert.equal(f.projectedVariable, 16000);
  assert.equal(f.high, -14000);
  assert.equal(f.low, -30000);
});
