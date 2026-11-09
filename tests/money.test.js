import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, formatMoney, sumCents, percent, distributePercents, formatPercent, formatPoints, centsToInput, toPlainSpaces,
} from '../js/core/money.js';

const plain = (s) => toPlainSpaces(s);

test('parseAmount : formats acceptés', () => {
  const cases = {
    '12': 1200, '12,5': 1250, '12,50': 1250, '12.50': 1250, '0,01': 1, ',5': 50,
    '1 234,56': 123456, '1 234,56': 123456, '1234.56': 123456, '1.234,56': 123456, '1,234.56': 123456,
    '1.234.567': 123456700, '12 €': 1200, '  7,05 ': 705, '999999,99': 99999999,
  };
  for (const [input, cents] of Object.entries(cases)) {
    const r = parseAmount(input);
    assert.equal(r.ok, true, `${input} devrait être accepté : ${r.error}`);
    assert.equal(r.cents, cents, input);
  }
});

test('parseAmount : pas d\'erreur d\'arrondi flottant (0,1 + 0,2, 19,99, 1,005 refusé)', () => {
  assert.equal(parseAmount('19,99').cents, 1999);
  assert.equal(parseAmount('0,29').cents, 29); // 0.29 * 100 = 28.999999999999996 en flottant
  assert.equal(parseAmount('1,15').cents, 115);
  assert.equal(parseAmount('4,35').cents, 435);
  assert.equal(parseAmount('1,005').ok, false);
});

test('parseAmount : saisies refusées', () => {
  for (const input of ['', '   ', 'abc', '12a', '-5', '−5', '0', '0,00', '1,234', '12,345', '1..2', '1,2,3', '12.3.4', null, undefined]) {
    assert.equal(parseAmount(input).ok, false, `« ${input} » devrait être refusé`);
  }
  assert.equal(parseAmount('0', { allowZero: true }).cents, 0);
  assert.equal(parseAmount('10000000,01').ok, false, 'plafond 10 000 000 €');
  assert.equal(parseAmount('10000000').ok, true);
});

test('formatMoney : format français exact', () => {
  assert.equal(plain(formatMoney(123456)), '1 234,56 €');
  assert.equal(plain(formatMoney(5)), '0,05 €');
  assert.equal(plain(formatMoney(0)), '0,00 €');
  assert.equal(plain(formatMoney(-6420)), '-64,20 €');
  assert.equal(formatMoney(-6420).startsWith('−'), true, 'vrai signe moins');
  assert.equal(plain(formatMoney(124500, { sign: 'always' })), '+1 245,00 €');
  assert.equal(plain(formatMoney(-124500, { sign: 'never' })), '1 245,00 €');
  assert.equal(plain(formatMoney(124500, { compact: true })), '1 245 €');
  assert.equal(plain(formatMoney(124550, { compact: true })), '1 245,50 €');
  assert.equal(plain(formatMoney(900719925474099)), '9 007 199 254 740,99 €');
  assert.equal(formatMoney(NaN), '—');
  assert.equal(formatMoney(1.5), '—');
});

test('centsToInput', () => {
  assert.equal(centsToInput(123456), '1234,56');
  assert.equal(centsToInput(5), '0,05');
  assert.equal(centsToInput(-100), '-1,00');
});

test('sumCents : exact et refuse les non-entiers', () => {
  assert.equal(sumCents([10, 20, 1]), 31);
  assert.equal(sumCents([{ a: 199 }, { a: 1 }], (x) => x.a), 200);
  assert.throws(() => sumCents([1, 0.5]));
  // 0,10 € + 0,20 € = 0,30 € exactement
  assert.equal(sumCents([10, 20]), 30);
});

test('percent : arrondi demi vers le haut, division par zéro', () => {
  assert.equal(percent(54632, 184250), 29.7); // taux d'épargne de la maquette
  assert.equal(percent(1, 3), 33.3);
  assert.equal(percent(2, 3), 66.7);
  assert.equal(percent(1, 8), 12.5);
  assert.equal(percent(-1, 8), -12.5);
  assert.equal(percent(1, 0), null);
  assert.equal(percent(5, 1000, 2), 0.5);
});

test('distributePercents : somme exactement 100 (plus fort reste)', () => {
  const p = distributePercents([1, 1, 1]);
  assert.deepEqual(p, [33.4, 33.3, 33.3]);
  const q = distributePercents([52000, 28600, 21240, 14800, 9850, 3128]);
  assert.deepEqual(q, [40.1, 22.1, 16.4, 11.4, 7.6, 2.4]);
  assert.equal(Math.round(q.reduce((a, b) => a + b, 0) * 10), 1000);
  assert.deepEqual(distributePercents([0, 0]), [0, 0]);
  for (let i = 0; i < 200; i += 1) {
    const vals = Array.from({ length: 1 + (i % 9) }, (_, k) => ((i * 7919 + k * 104729) % 50000) + 1);
    const s = distributePercents(vals).reduce((a, b) => a + b * 10, 0);
    assert.equal(Math.round(s), 1000);
  }
});

test('formatPercent et formatPoints', () => {
  assert.equal(plain(formatPercent(29.7)), '29,7 %');
  assert.equal(plain(formatPercent(-3.4)), '-3,4 %');
  assert.equal(plain(formatPercent(3.1, 1, { sign: 'always' })), '+3,1 %');
  assert.equal(formatPercent(null), '—');
  assert.equal(plain(formatPoints(-3.4)), '-3,4 pts');
  assert.equal(plain(formatPoints(0.4)), '+0,4 pt');
});
