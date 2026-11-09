import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidISODate, daysInMonth, addMonths, addDays, diffDays, diffMonths, monthBounds, clampDayInMonth,
  monthRange, weekdayIndex, formatMonth, formatDate, parseFrenchDate, todayISO, isValidMonthKey,
} from '../js/core/dates.js';

test('validité des dates, années bissextiles', () => {
  assert.equal(isValidISODate('2026-11-09'), true);
  assert.equal(isValidISODate('2026-02-29'), false);
  assert.equal(isValidISODate('2028-02-29'), true);
  assert.equal(isValidISODate('2100-02-29'), false);
  assert.equal(isValidISODate('2000-02-29'), true);
  assert.equal(isValidISODate('2026-04-31'), false);
  assert.equal(isValidISODate('2026-13-01'), false);
  assert.equal(isValidISODate('2026-1-01'), false);
  assert.equal(isValidISODate(20261109), false);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(isValidMonthKey('2026-11'), true);
  assert.equal(isValidMonthKey('2026-00'), false);
});

test('arithmétique des mois et jours', () => {
  assert.equal(addMonths('2026-11', 1), '2026-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-03', -14), '2025-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30', 'passage à l\'heure d\'été sans effet');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(diffDays('2026-11-01', '2026-11-30'), 29);
  assert.equal(diffDays('2026-10-24', '2026-10-26'), 2, 'passage à l\'heure d\'hiver sans effet');
  assert.equal(diffMonths('2026-11', '2027-02'), 3);
  assert.deepEqual(monthBounds('2026-02'), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(monthBounds('2028-02'), ['2028-02-01', '2028-02-29']);
  assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('jour ramené en fin de mois (récurrences le 31)', () => {
  assert.equal(clampDayInMonth('2026-02', 31), '2026-02-28');
  assert.equal(clampDayInMonth('2028-02', 30), '2028-02-29');
  assert.equal(clampDayInMonth('2026-04', 31), '2026-04-30');
  assert.equal(clampDayInMonth('2026-05', 31), '2026-05-31');
});

test('jour de la semaine (lundi = 0)', () => {
  assert.equal(weekdayIndex('2026-11-09'), 0); // lundi
  assert.equal(weekdayIndex('2026-11-15'), 6); // dimanche
});

test('affichage en français', () => {
  assert.equal(formatMonth('2026-11'), 'novembre 2026');
  assert.equal(formatMonth('2026-02', { short: true }), 'févr. 2026');
  assert.equal(formatDate('2026-11-09'), '09/11/2026');
  assert.equal(formatDate('2026-11-09', 'medium'), '9 nov. 2026');
  assert.equal(formatDate('2026-11-09', 'long'), 'lundi 9 novembre 2026');
  assert.equal(formatDate('2026-02-31'), '—');
});

test('lecture d\'une date saisie', () => {
  assert.equal(parseFrenchDate('09/11/2026'), '2026-11-09');
  assert.equal(parseFrenchDate('9/1/2026'), '2026-01-09');
  assert.equal(parseFrenchDate('09.11.26'), '2026-11-09');
  assert.equal(parseFrenchDate('2026-11-09'), '2026-11-09');
  assert.equal(parseFrenchDate('31/02/2026'), null);
  assert.equal(parseFrenchDate('11/09'), null);
  assert.equal(parseFrenchDate(''), null);
});

test('date du jour dans le fuseau local', () => {
  assert.equal(todayISO(new Date(2026, 10, 9, 23, 59)), '2026-11-09');
  assert.equal(todayISO(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});
