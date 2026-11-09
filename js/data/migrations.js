/**
 * migrations.js — Évolutions des données entre versions du schéma.
 *
 * La structure des tables est gérée par IndexedDB (db.js, onupgradeneeded).
 * Ce module transforme le CONTENU quand le format d'un enregistrement change.
 * Chaque migration est idempotente et indexée par la version qu'elle produit.
 * Les sauvegardes JSON importées passent par les mêmes fonctions (backup.js).
 */
import { transaction } from './db.js';
import { SCHEMA_VERSION } from './schema.js';

/** version cible → fonction(stores) */
export const MIGRATIONS = {
  // 1 : schéma initial, rien à transformer.
  1: async () => {},
};

/** Applique les migrations manquantes à la base locale. */
export async function runMigrations() {
  await transaction(['settings', 'categories', 'transactions', 'savingsAccounts', 'savingsMovements', 'goals', 'budgets', 'recurrences'], 'readwrite', async (s) => {
    const row = await s.settings.get('schemaVersion');
    let current = row?.value ?? 0;
    if (current > SCHEMA_VERSION) {
      throw new Error('Ces données proviennent d\'une version plus récente de l\'application. Rechargez la page pour obtenir la dernière version.');
    }
    while (current < SCHEMA_VERSION) {
      current += 1;
      await MIGRATIONS[current]?.(s);
    }
    await s.settings.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  });
}
