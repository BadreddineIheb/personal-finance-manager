/**
 * backup.js — Export, import et réinitialisation des données (IndexedDB).
 * L'import et la réinitialisation se font en UNE transaction : en cas d'erreur, rien n'est modifié.
 */
import { transaction } from './db.js';
import { APP_ID, SCHEMA_VERSION, DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './schema.js';
import { STORE_NAMES, validateBackup, mergeData } from './backup-validate.js';
import { findNegativeBalance, findMovementBeforeOpening } from '../domain/savings.js';
import { emit } from '../core/events.js';
import { todayISO } from '../core/dates.js';

const ALL = ['settings', ...STORE_NAMES];
const nowStamp = () => new Date().toISOString();

/** Lit toutes les données locales. */
export async function readAllData() {
  return transaction(ALL, 'readonly', async (s) => {
    const out = {};
    for (const n of STORE_NAMES) out[n] = await s[n].getAll();
    const settings = {};
    for (const row of await s.settings.getAll()) settings[row.key] = row.value;
    out.settings = settings;
    return out;
  });
}

/** Construit l'objet de sauvegarde (sans le télécharger). */
export async function buildBackup() {
  const data = await readAllData();
  const { schemaVersion, ...settings } = data.settings;
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: nowStamp(), data: { ...data, settings } };
}

/** Télécharge la sauvegarde JSON et mémorise la date d'export. */
export async function exportToFile() {
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mes-finances-sauvegarde-${todayISO()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  await transaction('settings', 'readwrite', (s) => s.settings.put({ key: 'lastExportAt', value: backup.exportedAt }));
  emit('data:changed', { store: 'settings', key: 'lastExportAt' });
  return { filename: a.download, counts: Object.fromEntries(STORE_NAMES.map((n) => [n, backup.data[n].length])) };
}

/** Lit et valide un fichier choisi par l'utilisateur. */
export async function readBackupFile(file) {
  if (!file) return { ok: false, errors: ['Aucun fichier choisi.'] };
  if (file.size > 50 * 1024 * 1024) return { ok: false, errors: ['Fichier trop volumineux (50 Mo maximum).'] };
  let json;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return { ok: false, errors: ['Ce fichier n\'est pas un JSON valide (fichier abîmé ou d\'un autre type).'] };
  }
  return validateBackup(json);
}

/**
 * Importe une sauvegarde validée.
 * @param {object} data données normalisées (validateBackup().data)
 * @param {'replace'|'merge'} mode
 */
export async function importData(data, mode) {
  const result = await transaction(ALL, 'readwrite', async (s) => {
    let target = data;
    let stats = null;
    if (mode === 'merge') {
      const local = {};
      for (const n of STORE_NAMES) local[n] = await s[n].getAll();
      const merged = mergeData(local, data);
      target = merged.data;
      stats = { added: merged.added, updated: merged.updated };
      // Après fusion, l'épargne doit rester cohérente
      if (findMovementBeforeOpening(target.savingsAccounts, target.savingsMovements) || findNegativeBalance(target.savingsAccounts, target.savingsMovements)) {
        throw new Error('La fusion rendrait un compte d\'épargne incohérent (solde négatif ou mouvement antérieur à son ouverture). Utilise « Remplacer » ou corrige le fichier.');
      }
    }
    for (const n of STORE_NAMES) {
      await s[n].clear();
      for (const rec of target[n]) await s[n].put(rec);
    }
    if (mode === 'replace') {
      const installedAt = (await s.settings.get('installedAt'))?.value ?? nowStamp();
      await s.settings.clear();
      for (const [key, value] of Object.entries({ ...DEFAULT_SETTINGS, ...data.settings, installedAt, schemaVersion: SCHEMA_VERSION })) {
        await s.settings.put({ key, value });
      }
    }
    return stats ?? { added: Object.values(data).filter(Array.isArray).reduce((a, l) => a + l.length, 0), updated: 0 };
  });
  emit('data:changed', { store: '*' });
  return result;
}

/** Efface toutes les données et recrée les catégories et paramètres par défaut. */
export async function resetAllData() {
  await transaction(ALL, 'readwrite', async (s) => {
    for (const n of ALL) await s[n].clear();
    for (const c of DEFAULT_CATEGORIES) await s.categories.put({ ...c, createdAt: nowStamp(), updatedAt: nowStamp() });
    for (const [key, value] of Object.entries({ ...DEFAULT_SETTINGS, schemaVersion: SCHEMA_VERSION, installedAt: nowStamp() })) {
      await s.settings.put({ key, value });
    }
  });
  try { localStorage.removeItem('pfm-theme'); } catch { /* sans effet */ }
  emit('data:changed', { store: '*' });
}
