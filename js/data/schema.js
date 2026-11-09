/**
 * schema.js — Définition de la base IndexedDB et des valeurs de référence.
 * Toute évolution de structure passe par une nouvelle version + une migration (migrations.js).
 */

export const DB_NAME = 'pfm';
export const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;
export const APP_ID = 'personal-finance-manager';

/** Tables (object stores) et leurs index. */
export const STORES = {
  settings: { keyPath: 'key', indexes: [] },
  categories: { keyPath: 'id', indexes: [] },
  transactions: {
    keyPath: 'id',
    indexes: [
      ['month', 'month'],
      ['date', 'date'],
      ['kind', 'kind'],
      ['categoryId', 'categoryId'],
      ['recurringId', 'recurringId'],
      // Clé anti-doublon des occurrences récurrentes. Les transactions saisies
      // à la main n'ont pas ce champ et ne sont donc pas indexées.
      ['occurrenceKey', 'occurrenceKey', { unique: true }],
    ],
  },
  savingsAccounts: { keyPath: 'id', indexes: [] },
  savingsMovements: {
    keyPath: 'id',
    indexes: [['month', 'month'], ['date', 'date'], ['accountId', 'accountId'], ['goalId', 'goalId']],
  },
  goals: { keyPath: 'id', indexes: [] },
  budgets: { keyPath: 'id', indexes: [['month', 'month']] },
  recurrences: { keyPath: 'id', indexes: [] },
};

export const EXPENSE_TYPES = {
  fixed: { label: 'Fixe', plural: 'Dépenses fixes', color: 'type-fixed' },
  variable: { label: 'Variable', plural: 'Dépenses variables', color: 'type-variable' },
  exceptional: { label: 'Exceptionnelle', plural: 'Dépenses exceptionnelles', color: 'type-exceptional' },
};

export const INCOME_TYPES = {
  salary: { label: 'Salaire', icon: 'briefcase' },
  apprenticeship: { label: 'Alternance', icon: 'graduation' },
  benefit: { label: 'Aide / allocation', icon: 'hand' },
  refund: { label: 'Remboursement', icon: 'refund' },
  bonus: { label: 'Prime', icon: 'gift' },
  sale: { label: 'Vente', icon: 'tag' },
  other: { label: 'Autre', icon: 'coins' },
};

/** Les 14 catégories du cahier des charges, créées à l'initialisation. */
export const DEFAULT_CATEGORIES = [
  { id: 'cat_housing', name: 'Logement / Loyer', icon: 'home', color: 'cat-housing', defaultExpenseType: 'fixed' },
  { id: 'cat_utilities', name: 'Électricité et eau', icon: 'zap', color: 'cat-utilities', defaultExpenseType: 'fixed' },
  { id: 'cat_telecom', name: 'Téléphone et Internet', icon: 'wifi', color: 'cat-telecom', defaultExpenseType: 'fixed' },
  { id: 'cat_insurance', name: 'Assurances', icon: 'shield', color: 'cat-insurance', defaultExpenseType: 'fixed' },
  { id: 'cat_transport', name: 'Transport / Carburant', icon: 'fuel', color: 'cat-transport', defaultExpenseType: 'variable' },
  { id: 'cat_groceries', name: 'Alimentation / Courses', icon: 'cart', color: 'cat-groceries', defaultExpenseType: 'variable' },
  { id: 'cat_restaurants', name: 'Restaurants', icon: 'utensils', color: 'cat-restaurants', defaultExpenseType: 'variable' },
  { id: 'cat_shopping', name: 'Shopping / Vêtements', icon: 'bag', color: 'cat-shopping', defaultExpenseType: 'variable' },
  { id: 'cat_subscriptions', name: 'Abonnements', icon: 'repeat', color: 'cat-subscriptions', defaultExpenseType: 'fixed' },
  { id: 'cat_health', name: 'Santé', icon: 'heart', color: 'cat-health', defaultExpenseType: 'variable' },
  { id: 'cat_leisure', name: 'Loisirs', icon: 'ticket', color: 'cat-leisure', defaultExpenseType: 'variable' },
  { id: 'cat_travel', name: 'Voyages', icon: 'plane', color: 'cat-travel', defaultExpenseType: 'exceptional' },
  { id: 'cat_car', name: 'Voiture / Entretien', icon: 'car', color: 'cat-car', defaultExpenseType: 'exceptional' },
  { id: 'cat_other', name: 'Autres', icon: 'dots', color: 'cat-other', defaultExpenseType: 'variable' },
].map((c, order) => ({ ...c, order, archived: false, system: true }));

/** Paramètres par défaut (un enregistrement par clé dans la table settings). */
export const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  theme: 'system',
  openingBalanceCents: 0,
  openingBalanceDate: null,
  lastExportAt: null,
  simulatorDefaultRate: null,
  installedAt: null,
  backupReminderSnoozedUntil: null,
};

/** Couleur CSS d'une catégorie : nom de token ("cat-housing") ou hexadécimal personnalisé. */
export function categoryColor(color) {
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) return color;
  return `var(--${color || 'cat-other'})`;
}
