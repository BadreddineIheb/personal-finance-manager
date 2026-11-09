import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTrend } from '../js/domain/trend.js';

const m = (income, expenses, interest = 0) => ({
  income, expenses, surplus: income - expenses, interest,
  savingsRate: income ? Math.round(((income - expenses) * 1000) / income) / 10 : null,
  incomeCount: income ? 1 : 0, expenseCount: expenses ? 1 : 0,
});

test('amélioration : taux en hausse, dépenses en baisse, patrimoine en hausse', () => {
  const t = computeTrend(m(200000, 120000), [m(200000, 150000), m(200000, 160000), m(200000, 140000)]);
  assert.equal(t.status, 'up');
  assert.equal(t.score, 3);
  assert.deepEqual(t.signals.map((s) => s.value), [1, 1, 1]);
});

test('dégradation : dépenses en forte hausse et patrimoine en baisse', () => {
  const t = computeTrend(m(150000, 180000), [m(150000, 120000), m(150000, 125000)]);
  assert.equal(t.status, 'down');
  assert.equal(t.score, -3);
});

test('stable : écarts sous les seuils', () => {
  const t = computeTrend(m(200000, 151000), [m(200000, 150000)]);
  // taux 24,5 vs 25 (−0,5 pt → 0), dépenses +0,7 % (0), patrimoine +490 € (+1)
  assert.deepEqual(t.signals.map((s) => s.value), [0, 0, 1]);
  assert.equal(t.status, 'stable');
});

test('seuils exacts : 2 points et 5 %', () => {
  assert.equal(computeTrend(m(100000, 73000), [m(100000, 75000)]).signals[0].value, 1); // 27 vs 25
  assert.equal(computeTrend(m(100000, 95000), [m(100000, 100000)]).signals[1].value, 1); // −5 % pile
  assert.equal(computeTrend(m(100000, 105000), [m(100000, 100000)]).signals[1].value, -1); // +5 % pile
});

test('historique insuffisant ou mois vide', () => {
  assert.equal(computeTrend(m(100000, 50000), []).status, 'unknown');
  assert.equal(computeTrend(m(100000, 50000), [m(0, 0)]).status, 'unknown');
  assert.equal(computeTrend(m(0, 0), [m(100000, 50000)]).status, 'unknown');
});

test('seuls les 3 derniers mois avec données comptent ; mois sans revenu exclu du taux', () => {
  const t = computeTrend(m(100000, 50000), [m(100000, 10000), m(0, 0), m(100000, 60000), m(0, 40000), m(100000, 60000)]);
  // références : [60000/100000, 40000 sans revenu, 60000/100000] → moyenne taux 40 ; dépenses moy. 53333
  assert.equal(t.signals[0].detail.average, 40);
  assert.equal(t.signals[1].detail.average, 53333);
  assert.equal(t.status, 'up');
});

test('les intérêts comptent dans la variation du patrimoine', () => {
  const t = computeTrend(m(0, 0, 0), [m(1, 1)]);
  assert.equal(t.status, 'unknown');
  const t2 = computeTrend({ ...m(100000, 100000), interest: 500 }, [m(100000, 100000)]);
  assert.equal(t2.signals.find((s) => s.key === 'wealth').value, 1);
});
