/**
 * incomes.js — Page Revenus : liste filtrable, totaux par type de revenu, plus gros revenus.
 * Les revenus récurrents (salaire mensuel…) arrivent avec le moteur de récurrences (lot 5).
 */
import { createLedgerPage } from './ledger-page.js';

export const render = createLedgerPage('income');
