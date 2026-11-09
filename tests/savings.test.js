import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectOn, accountBalanceAt, totalSavingsAt, findNegativeBalance, findMovementBeforeOpening,
  summarizeMovements, savingsSeries, goalProgress, monthlyNeeded, freeSavings,
} from '../js/domain/savings.js';
import { summarizeMonth, accountBalance } from '../js/domain/ledger.js';
import { validateAccount, validateMovement, validateGoal } from '../js/core/validation.js';

const A = { id: 'A', openingBalanceCents: 150000, openingDate: '2026-11-01' }; // Livret A 1 500 €
const B = { id: 'B', openingBalanceCents: 0, openingDate: '2026-11-01' };      // LEP
const mv = (id, type, cents, date, accountId, extra = {}) => ({ id, type, amountCents: cents, date, accountId, ...extra });

const MOVES = [
  mv('m1', 'deposit', 40000, '2026-11-05', 'A', { goalId: 'g1' }),
  mv('m2', 'transfer', 30000, '2026-11-10', 'A', { toAccountId: 'B' }),
  mv('m3', 'withdrawal', 5000, '2026-11-20', 'B', { goalId: 'g1' }),
  mv('m4', 'interest', 1234, '2026-12-31', 'A'),
  mv('m5', 'deposit', 10000, '2026-12-05', 'B', { goalId: 'g2' }),
];

test('effet des mouvements par compte', () => {
  assert.equal(effectOn(MOVES[1], 'A'), -30000);
  assert.equal(effectOn(MOVES[1], 'B'), 30000);
  assert.equal(effectOn(MOVES[1], 'X'), 0);
  assert.equal(effectOn(MOVES[2], 'B'), -5000);
  assert.equal(effectOn(MOVES[3], 'A'), 1234);
});

test('soldes : transferts neutres pour le total, intérêts comptés', () => {
  assert.equal(accountBalanceAt(A, MOVES, '2026-11-30'), 150000 + 40000 - 30000);
  assert.equal(accountBalanceAt(B, MOVES, '2026-11-30'), 30000 - 5000);
  assert.equal(totalSavingsAt([A, B], MOVES, '2026-11-30'), 150000 + 40000 - 5000);
  assert.equal(totalSavingsAt([A, B], MOVES, '2026-12-31'), 150000 + 40000 - 5000 + 10000 + 1234);
  assert.equal(accountBalanceAt(A, MOVES, '2026-10-31'), 0, 'avant la date de départ');
});

test('épargne mensuelle (T) : ni transfert ni intérêts', () => {
  const nov = MOVES.filter((m) => m.date.startsWith('2026-11'));
  assert.deepEqual(summarizeMovements(nov), { deposits: 40000, withdrawals: 5000, transfers: 30000, interest: 0, net: 35000 });
  const s = summarizeMonth([], MOVES.filter((m) => m.date.startsWith('2026-12')));
  assert.equal(s.saved, 10000);
  assert.equal(s.interest, 1234);
  assert.equal(s.income, 0, 'les intérêts ne sont pas un revenu');
});

test('anti double comptage : compte courant + épargne = patrimoine cohérent', () => {
  const opening = { openingBalanceCents: 200000, openingBalanceDate: '2026-11-01' };
  const tx = [
    { kind: 'income', amountCents: 124500, date: '2026-11-05' },
    { kind: 'expense', amountCents: 52000, date: '2026-11-02' },
  ];
  const nov = MOVES.filter((m) => m.date.startsWith('2026-11'));
  const current = accountBalance(opening, '2026-11-30', tx, nov);
  assert.equal(current, 200000 + 124500 - 52000 - 40000 + 5000);
  const savings = totalSavingsAt([A, B], nov, '2026-11-30');
  // Le patrimoine n'augmente que de R − D (le versement déplace de l'argent, il ne le crée pas).
  const before = 200000 + 150000;
  assert.equal(current + savings - before, 124500 - 52000);
});

test('détection d\'un solde négatif, crédits avant débits le même jour', () => {
  assert.equal(findNegativeBalance([A, B], MOVES), null);
  const bad = [...MOVES, mv('x', 'withdrawal', 30000, '2026-11-15', 'B')];
  assert.deepEqual(findNegativeBalance([A, B], bad), { accountId: 'B', date: '2026-11-20', balanceCents: -5000 });
  const sameDay = [mv('d', 'deposit', 1000, '2026-11-02', 'B'), mv('w', 'withdrawal', 1000, '2026-11-02', 'B')];
  assert.equal(findNegativeBalance([B], sameDay), null);
  const early = [mv('w', 'withdrawal', 100, '2026-10-30', 'A')];
  assert.equal(findMovementBeforeOpening([A], early).id, 'w');
});

test('évolution mensuelle', () => {
  const s = savingsSeries([A, B], MOVES, '2026-10', '2026-12');
  assert.deepEqual(s.map((x) => x.totalCents), [0, 185000, 196234]);
  assert.deepEqual(s.map((x) => x.savedCents), [0, 35000, 10000]);
  assert.deepEqual(s.map((x) => x.interestCents), [0, 0, 1234]);
});

test('objectifs : progression, plafond 100 %, mensualité nécessaire, épargne libre', () => {
  const g1 = { id: 'g1', targetCents: 300000, deadline: '2027-06-30' };
  const p1 = goalProgress(g1, MOVES);
  assert.deepEqual(p1, { savedCents: 35000, remainingCents: 265000, percent: 11.6, reached: false });
  const need = monthlyNeeded(g1, p1, '2026-11-09');
  assert.equal(need.months, 8); // nov → juin inclus
  assert.equal(need.perMonthCents, 33125);
  const g2 = { id: 'g2', targetCents: 5000 };
  assert.equal(goalProgress(g2, MOVES).reached, true);
  assert.equal(goalProgress(g2, MOVES).percent, 100);
  assert.equal(monthlyNeeded(g2, goalProgress(g2, MOVES), '2026-11-09'), null);
  assert.equal(monthlyNeeded({ ...g1, deadline: '2026-10-31' }, p1, '2026-11-09').overdue, true);
  assert.equal(monthlyNeeded({ id: 'g', targetCents: 100, deadline: '2026-11-30' }, { remainingCents: 100, reached: false }, '2026-11-09').perMonthCents, 100);
  const free = freeSavings(196234, [g1, g2, { id: 'g3', targetCents: 1, archived: true }], MOVES);
  assert.deepEqual(free, { allocatedCents: 45000, freeCents: 151234 });
});

test('validation épargne', () => {
  assert.equal(validateAccount({ name: 'Livret A', type: 'livretA', openingBalance: '1 500', openingDate: '2026-11-01' }).value.openingBalanceCents, 150000);
  assert.equal(validateAccount({ name: 'X', type: 'livretA', openingBalance: '', openingDate: '2026-11-01' }).value.openingBalanceCents, 0);
  assert.equal(validateAccount({ name: '', type: 'nope', openingBalance: '-5', openingDate: '' }).ok, false);
  const ids = new Set(['A', 'B']);
  assert.equal(validateMovement({ type: 'transfer', amount: '10', date: '2026-11-02', accountId: 'A', toAccountId: 'A' }, { accountIds: ids }).errors.toAccountId, 'Choisis un compte différent du compte de départ.');
  const ok = validateMovement({ type: 'transfer', amount: '10', date: '2026-11-02', accountId: 'A', toAccountId: 'B', goalId: 'g1' }, { accountIds: ids });
  assert.equal(ok.value.goalId, null, 'un transfert n\'est jamais rattaché à un objectif');
  assert.equal(validateMovement({ type: 'deposit', amount: '0', date: '2026-11-02', accountId: 'Z' }, { accountIds: ids }).ok, false);
  assert.equal(validateGoal({ name: 'Voiture', target: '3000', deadline: '' }).value.deadline, null);
  assert.equal(validateGoal({ name: 'Voiture', target: '', deadline: '31/02/2027' }).ok, false);
});
