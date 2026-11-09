import test from 'node:test';
import assert from 'node:assert/strict';
import {
  occurrencesBetween, dueOccurrences, upcomingOccurrences, transactionFromOccurrence, nextOccurrence, describeFrequency, monthlyEquivalentCents, occurrenceKey,
} from '../js/domain/recurrence.js';
import { validateRecurrence } from '../js/core/validation.js';

const rent = { id: 'r1', kind: 'expense', label: 'Loyer', amountCents: 52000, categoryId: 'cat_housing', expenseType: 'fixed', frequency: 'monthly', interval: 1, dayOfMonth: 1, startDate: '2026-09-01', endDate: null, active: true, skippedKeys: [] };

test('mensuelle : une occurrence par mois, bornes incluses', () => {
  assert.deepEqual(occurrencesBetween(rent, '2026-09-01', '2026-11-30'), ['2026-09-01', '2026-10-01', '2026-11-01']);
  assert.deepEqual(occurrencesBetween(rent, '2026-11-02', '2026-11-30'), []);
  assert.deepEqual(occurrencesBetween(rent, '2025-01-01', '2026-09-30'), ['2026-09-01'], 'rien avant la date de début');
  assert.deepEqual(occurrencesBetween({ ...rent, endDate: '2026-10-15' }, '2026-09-01', '2026-12-31'), ['2026-09-01', '2026-10-01'], 'date de fin respectée');
});

test('le 31 est ramené au dernier jour (février, années bissextiles)', () => {
  const r = { ...rent, dayOfMonth: 31, startDate: '2027-01-31' };
  assert.deepEqual(occurrencesBetween(r, '2027-01-01', '2027-05-31'), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  assert.deepEqual(occurrencesBetween({ ...r, startDate: '2028-01-31' }, '2028-02-01', '2028-02-29'), ['2028-02-29']);
});

test('date de début après le jour du mois : premier mois ignoré', () => {
  const r = { ...rent, dayOfMonth: 5, startDate: '2026-11-20' };
  assert.deepEqual(occurrencesBetween(r, '2026-11-01', '2027-01-31'), ['2026-12-05', '2027-01-05']);
});

test('tous les 3 mois, annuelle, hebdomadaire', () => {
  const q = { ...rent, frequency: 'everyNMonths', interval: 3, dayOfMonth: 15, startDate: '2026-01-15' };
  assert.deepEqual(occurrencesBetween(q, '2026-01-01', '2026-12-31'), ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
  assert.deepEqual(occurrencesBetween(q, '2030-05-01', '2030-10-31'), ['2030-07-15', '2030-10-15'], 'saut direct sur une période lointaine');
  const y = { ...rent, frequency: 'yearly', monthOfYear: 9, dayOfMonth: 10, startDate: '2026-11-01' };
  assert.deepEqual(occurrencesBetween(y, '2026-01-01', '2028-12-31'), ['2027-09-10', '2028-09-10']);
  const y2 = { ...y, monthOfYear: 2, dayOfMonth: 29, startDate: '2027-01-01' };
  assert.deepEqual(occurrencesBetween(y2, '2027-01-01', '2028-12-31'), ['2027-02-28', '2028-02-29']);
  const w = { ...rent, frequency: 'weekly', interval: 2, startDate: '2026-11-02' }; // lundi
  assert.deepEqual(occurrencesBetween(w, '2026-11-01', '2026-12-01'), ['2026-11-02', '2026-11-16', '2026-11-30']);
  assert.deepEqual(occurrencesBetween(w, '2026-11-17', '2026-12-15'), ['2026-11-30', '2026-12-14']);
});

test('génération idempotente : rattrapage, aucune occurrence en double, suppressions respectées', () => {
  const due = dueOccurrences([rent], new Set(), '2026-11-09');
  assert.deepEqual(due.map((d) => d.date), ['2026-09-01', '2026-10-01', '2026-11-01']);
  // 2e passage : tout existe déjà
  const existing = new Set(due.map((d) => d.key));
  assert.equal(dueOccurrences([rent], existing, '2026-11-09').length, 0);
  // occurrence supprimée volontairement : jamais recréée
  const skipped = { ...rent, skippedKeys: [occurrenceKey('r1', '2026-10-01')] };
  assert.deepEqual(dueOccurrences([skipped], new Set(), '2026-11-09').map((d) => d.date), ['2026-09-01', '2026-11-01']);
  // récurrence en pause : rien
  assert.equal(dueOccurrences([{ ...rent, active: false }], new Set(), '2026-11-09').length, 0);
  // le jour même est inclus, le lendemain non
  assert.equal(dueOccurrences([rent], existing, '2026-12-01').length, 1);
  assert.equal(dueOccurrences([rent], existing, '2026-11-30').length, 0);
});

test('échéances à venir, prochaine occurrence, transaction générée', () => {
  const salary = { ...rent, id: 'r2', kind: 'income', label: 'Salaire', amountCents: 124500, incomeType: 'apprenticeship', dayOfMonth: 5 };
  const up = upcomingOccurrences([rent, salary], '2026-11-10', '2026-12-31');
  assert.deepEqual(up.map((u) => `${u.date} ${u.recurrence.label}`), ['2026-12-01 Loyer', '2026-12-05 Salaire']);
  assert.equal(nextOccurrence(rent, '2026-11-02'), '2026-12-01');
  assert.equal(nextOccurrence({ ...rent, skippedKeys: ['r1@2026-12-01'] }, '2026-11-02'), '2027-01-01');
  assert.equal(nextOccurrence({ ...rent, endDate: '2026-11-15' }, '2026-11-02'), null);
  assert.deepEqual(transactionFromOccurrence(rent, '2026-11-01'), {
    kind: 'expense', label: 'Loyer', amountCents: 52000, date: '2026-11-01', description: '', recurringId: 'r1', occurrenceKey: 'r1@2026-11-01', categoryId: 'cat_housing', expenseType: 'fixed',
  });
  assert.deepEqual(Object.keys(transactionFromOccurrence(salary, '2026-11-05')).sort(), ['amountCents', 'date', 'description', 'incomeType', 'kind', 'label', 'occurrenceKey', 'recurringId']);
});

test('libellés et équivalent mensuel', () => {
  assert.equal(describeFrequency(rent), 'Tous les mois, le 1er');
  assert.equal(describeFrequency({ ...rent, dayOfMonth: 31 }), 'Tous les mois, le 31 (ou dernier jour du mois)');
  assert.equal(describeFrequency({ ...rent, frequency: 'yearly', monthOfYear: 9, dayOfMonth: 10 }), 'Chaque année, le 10 septembre');
  assert.equal(describeFrequency({ ...rent, frequency: 'weekly', interval: 1, startDate: '2026-11-09' }), 'Toutes les semaines, le lundi');
  assert.equal(monthlyEquivalentCents({ ...rent, frequency: 'yearly', amountCents: 12000 }), 1000);
  assert.equal(monthlyEquivalentCents({ ...rent, frequency: 'weekly', interval: 1, amountCents: 1000 }), 4333);
});

test('validateRecurrence', () => {
  const ids = new Set(['cat_housing']);
  const r = validateRecurrence({ kind: 'expense', label: 'Loyer', amount: '520', categoryId: 'cat_housing', expenseType: 'fixed', frequency: 'monthly', startDate: '2026-09-01', dayOfMonth: '', endDate: '' }, { categoryIds: ids });
  assert.equal(r.ok, true);
  assert.equal(r.value.dayOfMonth, 1);
  assert.equal(r.value.endDate, null);
  assert.equal(r.value.date, undefined);
  const bad = validateRecurrence({ kind: 'expense', label: 'X', amount: '5', categoryId: 'cat_housing', expenseType: 'fixed', frequency: 'everyNMonths', interval: '0', startDate: '2026-09-01', dayOfMonth: '32', endDate: '2026-01-01' }, { categoryIds: ids });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['dayOfMonth', 'endDate', 'interval']);
  const y = validateRecurrence({ kind: 'income', label: 'Prime', amount: '300', incomeType: 'bonus', frequency: 'yearly', startDate: '2026-12-15', dayOfMonth: '', endDate: '' });
  assert.equal(y.value.monthOfYear, 12);
  assert.equal(validateRecurrence({ kind: 'income', label: 'Prime', amount: '300', incomeType: 'bonus', frequency: 'x', startDate: '' }).errors.startDate, 'Date requise.');
});
