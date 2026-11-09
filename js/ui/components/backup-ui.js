/**
 * backup-ui.js — Interface de sauvegarde : export, import avec aperçu (fusionner / remplacer),
 * réinitialisation confirmée, bandeau de rappel de sauvegarde.
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { exportToFile, readBackupFile, importData, resetAllData } from '../../data/backup.js';
import { setSetting } from '../../data/repository.js';
import { formatMonth, formatDate, diffDays, todayISO, addDays } from '../../core/dates.js';

const COUNT_LABELS = {
  transactions: ['opération', 'opérations'], recurrences: ['récurrence', 'récurrences'], savingsAccounts: ['compte d\'épargne', 'comptes d\'épargne'],
  savingsMovements: ['mouvement d\'épargne', 'mouvements d\'épargne'], goals: ['objectif', 'objectifs'], budgets: ['budget', 'budgets'], categories: ['catégorie', 'catégories'],
};
const plural = (n, [one, many]) => `${n} ${n > 1 ? many : one}`;

export async function runExport() {
  try {
    const r = await exportToFile();
    toast(`Sauvegarde téléchargée : ${r.filename}`);
  } catch (err) {
    console.error(err);
    toast(`Export impossible : ${err.message}`);
  }
}

/** Ouvre le sélecteur de fichier puis l'aperçu d'import. */
export function startImport() {
  const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const result = await readBackupFile(file);
    if (!result.ok) { showRejected(file.name, result.errors); return; }
    showPreview(file.name, result);
  });
  document.body.append(input);
  input.click();
}

function showRejected(name, errors) {
  const m = openModal({
    title: 'Import refusé',
    body: h('div', { class: 'stack-sm' },
      h('div', { class: 'alert alert-error', role: 'alert' }, icon('alert'), h('div', {},
        h('div', { class: 'alert-title' }, `Le fichier « ${name} » ne peut pas être importé.`),
        h('div', { class: 'alert-body' }, 'Aucune donnée n\'a été modifiée.'))),
      h('ul', { class: 'error-list' }, errors.map((e) => h('li', {}, e)))),
    footer: [h('button', { class: 'btn btn-primary', type: 'button', onClick: () => m.close() }, 'Fermer')],
  });
}

function showPreview(name, { data, summary }) {
  const c = summary.counts;
  const rows = Object.keys(COUNT_LABELS).filter((k) => c[k]).map((k) => h('li', {}, plural(c[k], COUNT_LABELS[k])));
  const doImport = async (mode) => {
    if (mode === 'replace') {
      const ok = await confirmDialog({
        title: 'Remplacer toutes tes données ?',
        message: 'Les données actuelles de ce navigateur seront entièrement remplacées par celles du fichier. Cette action est irréversible : exporte d\'abord une sauvegarde si tu veux pouvoir revenir en arrière.',
        confirmLabel: 'Remplacer mes données', danger: true,
      });
      if (!ok) return;
    }
    try {
      const r = await importData(data, mode);
      m.close();
      toast(mode === 'replace' ? 'Données remplacées par la sauvegarde' : `Fusion terminée : ${r.added} élément(s) ajouté(s), ${r.updated} mis à jour`);
    } catch (err) {
      console.error(err);
      m.dialog.querySelector('.modal-body').prepend(h('div', { class: 'alert alert-error', role: 'alert' }, icon('alert'), h('div', { class: 'alert-body' }, `${err.message} Aucune donnée n'a été modifiée.`)));
    }
  };
  const m = openModal({
    title: 'Importer une sauvegarde',
    wide: true,
    body: h('div', { class: 'stack' },
      h('div', { class: 'alert alert-good' }, icon('check'), h('div', {},
        h('div', { class: 'alert-title' }, `Fichier valide : ${name}`),
        h('div', { class: 'alert-body' },
          summary.exportedAt ? `Sauvegarde du ${formatDate(summary.exportedAt.slice(0, 10))}. ` : '',
          summary.firstMonth ? `Opérations de ${formatMonth(summary.firstMonth)} à ${formatMonth(summary.lastMonth)}.` : 'Aucune opération.'))),
      h('div', {}, h('span', { class: 'field-label' }, 'Contenu'), h('ul', { class: 'report-summary' }, rows)),
      h('div', { class: 'import-choices' },
        h('div', { class: 'stack-sm' }, h('strong', {}, 'Fusionner'),
          h('p', { class: 'muted fs-13' }, 'Ajoute les éléments absents. Pour un même élément présent des deux côtés, la version la plus récemment modifiée est gardée. Tes paramètres sont conservés.')),
        h('div', { class: 'stack-sm' }, h('strong', {}, 'Remplacer'),
          h('p', { class: 'muted fs-13' }, 'Efface les données de ce navigateur et les remplace par celles du fichier (paramètres compris). Idéal pour transférer tes données sur un autre appareil.')))),
    footer: [
      h('button', { class: 'btn btn-ghost spacer', type: 'button', onClick: runExport }, icon('income', 'icon icon-sm'), 'Exporter d\'abord'),
      h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => doImport('merge') }, 'Fusionner'),
      h('button', { class: 'btn btn-danger', type: 'button', onClick: () => doImport('replace') }, 'Remplacer mes données'),
    ],
  });
}

/** Réinitialisation : saisie du mot EFFACER pour confirmer. */
export function startReset() {
  const word = 'EFFACER';
  const input = h('input', { class: 'input', id: 'reset-confirm', autocomplete: 'off', placeholder: word, aria: { describedby: 'reset-help' } });
  const go = h('button', { class: 'btn btn-danger', type: 'button', disabled: true }, 'Tout effacer');
  input.addEventListener('input', () => { go.disabled = input.value.trim().toUpperCase() !== word; });
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      await resetAllData();
      m.close();
      toast('Toutes les données ont été effacées');
      location.hash = '#/dashboard';
    } catch (err) { toast(`Réinitialisation impossible : ${err.message}`); go.disabled = false; }
  });
  const m = openModal({
    title: 'Effacer toutes les données ?',
    body: h('div', { class: 'stack-sm' },
      h('div', { class: 'alert alert-error' }, icon('alert'), h('div', { class: 'alert-body' },
        'Revenus, dépenses, épargne, objectifs, budgets, récurrences, catégories personnalisées et paramètres de ce navigateur seront définitivement supprimés. Les autres appareils ne sont pas concernés.')),
      h('button', { class: 'btn btn-secondary', type: 'button', style: { alignSelf: 'flex-start' }, onClick: runExport }, 'Exporter une sauvegarde avant'),
      h('label', { class: 'field-label', for: 'reset-confirm', id: 'reset-help' }, `Pour confirmer, tape ${word} :`), input),
    footer: [h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => m.close() }, 'Annuler'), go],
    initialFocus: input,
  });
}

/**
 * Bandeau de rappel : jamais exporté avec au moins 20 opérations, ou dernier export il y a plus de 30 jours.
 * @returns {HTMLElement|null}
 */
export function backupReminder(settings, operationCount) {
  const today = todayISO();
  if (!operationCount) return null;
  if (settings.backupReminderSnoozedUntil && settings.backupReminderSnoozedUntil.slice(0, 10) > today) return null;
  let title;
  if (!settings.lastExportAt) {
    if (operationCount < 20) return null;
    title = 'Tu n\'as encore jamais sauvegardé tes données';
  } else {
    const days = diffDays(settings.lastExportAt.slice(0, 10), today);
    if (days <= 30) return null;
    title = `Dernière sauvegarde il y a ${days} jours`;
  }
  return h('div', { class: 'alert alert-warn', role: 'status' }, icon('alert'),
    h('div', {}, h('div', { class: 'alert-title' }, title),
      h('div', { class: 'alert-body' }, 'Tes données ne sont stockées que dans ce navigateur : une sauvegarde JSON te protège d\'une perte (nettoyage du navigateur, changement d\'appareil).')),
    h('div', { class: 'alert-actions' },
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => setSetting('backupReminderSnoozedUntil', `${addDays(today, 7)}T00:00:00.000Z`) }, 'Plus tard'),
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: runExport }, 'Exporter')));
}
