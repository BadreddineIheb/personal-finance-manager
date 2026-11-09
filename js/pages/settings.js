/**
 * settings.js — Paramètres : apparence, solde de départ du compte courant, catégories,
 * sauvegarde / restauration JSON, application hors ligne, confidentialité, réinitialisation.
 */
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setSetting, saveCategory, deleteCategory, countTransactionsInCategory } from '../data/repository.js';
import { getCategories, getCachedSettings } from '../ui/cache.js';
import { pageHead } from '../ui/components/widgets.js';
import { toast } from '../ui/components/toast.js';
import { confirmDialog } from '../ui/components/modal.js';
import { validateSignedAmount, cleanText, LIMITS } from '../core/validation.js';
import { centsToInput, formatMoney } from '../core/money.js';
import { todayISO, isValidISODate, formatDate } from '../core/dates.js';
import { EXPENSE_TYPES, categoryColor } from '../data/schema.js';
import { runExport, startImport, startReset } from '../ui/components/backup-ui.js';
import { installState, promptInstall } from '../pwa.js';

export async function render(view) {
  const [settings, cats] = await Promise.all([getCachedSettings(), getCategories()]);
  mount(view,
    pageHead('Paramètres', 'Réglages de l\'application et données de référence'),
    h('section', { class: 'card' },
      appearanceSection(settings),
      balanceSection(settings),
      categoriesSection(cats),
      backupSection(settings),
      await appSection(),
      privacySection(),
      dangerSection()));
}

function section(title, desc, ...content) {
  return h('div', { class: 'settings-section' },
    h('div', {}, h('h2', {}, title), desc ? h('p', { class: 'desc' }, desc) : null),
    h('div', { class: 'stack' }, content));
}

// ------------------------------------------------------------------ Apparence

function appearanceSection(settings) {
  const options = [['system', 'Système', 'monitor'], ['light', 'Clair', 'sun'], ['dark', 'Sombre', 'moon']];
  const seg = h('div', { class: 'seg', role: 'group', aria: { label: 'Thème' } }, options.map(([v, l, i]) => h('button', {
    type: 'button', aria: { pressed: String(settings.theme === v) },
    onClick: async () => { await setSetting('theme', v); toast(`Thème : ${l.toLowerCase()}`); },
  }, icon(i, 'icon icon-sm'), l)));
  return section('Apparence', '« Système » suit le réglage clair / sombre de l\'appareil.', h('div', {}, seg));
}

// ------------------------------------------------------------------ Solde de départ

function balanceSection(settings) {
  const amount = h('input', { class: 'input', id: 'opening-amount', inputmode: 'decimal', placeholder: '0,00',
    value: settings.openingBalanceDate ? centsToInput(settings.openingBalanceCents) : '' });
  const date = h('input', { class: 'input', id: 'opening-date', type: 'date', value: settings.openingBalanceDate ?? todayISO() });
  const error = h('span', { class: 'field-error', role: 'alert', hidden: true });
  const status = h('p', { class: 'subtle fs-13' }, settings.openingBalanceDate
    ? `Actuellement : ${formatMoney(settings.openingBalanceCents)} au ${formatDate(settings.openingBalanceDate)}.`
    : 'Aucun solde de départ défini : le « Solde disponible » du tableau de bord affiche « — ».');

  const save = async (e) => {
    e.preventDefault();
    const r = validateSignedAmount(amount.value);
    error.hidden = true;
    if (!r.ok) { error.textContent = r.error; error.hidden = false; amount.setAttribute('aria-invalid', 'true'); amount.focus(); return; }
    if (!isValidISODate(date.value)) { error.textContent = 'Date invalide.'; error.hidden = false; date.focus(); return; }
    amount.removeAttribute('aria-invalid');
    await setSetting('openingBalanceCents', r.cents);
    await setSetting('openingBalanceDate', date.value);
    toast('Solde de départ enregistré');
  };

  return section('Compte courant',
    'Le solde réel de ton compte à une date donnée. Les revenus et dépenses datés à partir de ce jour (inclus) s\'y ajoutent pour calculer le solde disponible. Un solde négatif s\'écrit avec « - ».',
    h('form', { class: 'form-grid', onSubmit: save, novalidate: true },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'opening-amount' }, 'Solde du compte'), h('span', { class: 'amount' }, amount)),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'opening-date' }, 'À la date du'), date),
      h('div', { class: 'full stack-sm' }, error, status, h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer le solde')))));
}

// ------------------------------------------------------------------ Catégories

function cssColorToHex(cssValue) {
  // Résout une variable CSS (couleur de token) en hexadécimal pour le sélecteur de couleur.
  const probe = h('span', { style: { color: cssValue, display: 'none' } });
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color.match(/\d+/g) ?? ['0', '0', '0'];
  probe.remove();
  return `#${rgb.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

function categoriesSection({ list }) {
  const rows = list.map((c) => {
    const name = h('input', { class: 'input input-sm', value: c.name, maxlength: String(LIMITS.name), aria: { label: `Nom de la catégorie ${c.name}` } });
    const color = h('input', { type: 'color', value: cssColorToHex(categoryColor(c.color)), aria: { label: `Couleur de ${c.name}` }, title: 'Couleur' });
    const type = h('select', { class: 'select select-sm', aria: { label: `Type par défaut de ${c.name}` } },
      Object.entries(EXPENSE_TYPES).map(([k, t]) => h('option', { value: k, selected: k === c.defaultExpenseType }, t.label)));

    name.addEventListener('change', async () => {
      const v = cleanText(name.value);
      if (!v) { name.value = c.name; toast('Le nom ne peut pas être vide.'); return; }
      await saveCategory({ ...c, name: v });
      toast('Catégorie renommée');
    });
    color.addEventListener('change', () => saveCategory({ ...c, color: color.value }));
    type.addEventListener('change', () => saveCategory({ ...c, defaultExpenseType: type.value }));

    const actions = h('span', { class: 'row', style: { gap: '2px' } },
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: async () => {
        await saveCategory({ ...c, archived: !c.archived });
        toast(c.archived ? 'Catégorie réactivée' : 'Catégorie archivée : elle n\'est plus proposée, l\'historique est conservé.');
      } }, c.archived ? 'Réactiver' : 'Archiver'),
      !c.system ? h('button', { class: 'btn btn-ghost btn-icon', type: 'button', aria: { label: `Supprimer ${c.name}` }, title: 'Supprimer', onClick: async () => {
        const used = await countTransactionsInCategory(c.id);
        if (used) { toast(`Utilisée par ${used} dépense(s) : archive-la plutôt.`); return; }
        if (!(await confirmDialog({ title: `Supprimer « ${c.name} » ?`, message: 'Cette catégorie n\'est utilisée par aucune dépense. Ses éventuels budgets seront aussi supprimés.', confirmLabel: 'Supprimer', danger: true }))) return;
        try { await deleteCategory(c.id); toast('Catégorie supprimée'); } catch (err) { toast(err.message); }
      } }, icon('trash', 'icon icon-sm')) : null);

    return h('div', { class: ['cat-edit', c.archived && 'is-archived'] }, color, name, type, actions);
  });

  const newName = h('input', { class: 'input input-sm', placeholder: 'Nouvelle catégorie', maxlength: String(LIMITS.name), aria: { label: 'Nom de la nouvelle catégorie' } });
  const newType = h('select', { class: 'select select-sm', aria: { label: 'Type par défaut' } },
    Object.entries(EXPENSE_TYPES).map(([k, t]) => h('option', { value: k, selected: k === 'variable' }, t.label)));
  const add = async (e) => {
    e.preventDefault();
    const v = cleanText(newName.value);
    if (!v) { newName.focus(); return; }
    if (list.some((c) => c.name.toLowerCase() === v.toLowerCase())) { toast('Une catégorie porte déjà ce nom.'); return; }
    await saveCategory({ name: v, color: '#64748b', defaultExpenseType: newType.value, icon: 'tag' });
    toast('Catégorie ajoutée');
  };

  return section('Catégories de dépenses',
    'Le type par défaut préremplit le formulaire de dépense. Archiver une catégorie la retire des listes de choix sans toucher à l\'historique.',
    h('div', {}, rows),
    h('form', { class: 'cat-edit', onSubmit: add }, h('span', { class: 'tx-icon', style: { width: '28px', height: '28px' } }, icon('plus', 'icon icon-sm')), newName, newType,
      h('button', { class: 'btn btn-secondary btn-sm', type: 'submit' }, 'Ajouter')));
}

// ------------------------------------------------------------------ Sauvegarde

function backupSection(settings) {
  const last = settings.lastExportAt;
  return section('Sauvegarde et restauration',
    'Exporte régulièrement tes données dans un fichier JSON : c\'est ta seule sauvegarde. Le même fichier permet de les transférer sur un autre appareil.',
    h('p', { class: 'fs-13 muted' }, last ? `Dernière sauvegarde : ${formatDate(last.slice(0, 10), 'long')}.` : 'Aucune sauvegarde effectuée pour l\'instant.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn btn-primary', type: 'button', id: 'export-btn', onClick: runExport }, icon('income'), 'Exporter mes données (JSON)'),
      h('button', { class: 'btn btn-secondary', type: 'button', id: 'import-btn', onClick: startImport }, icon('expense'), 'Importer une sauvegarde')),
    h('p', { class: 'subtle fs-13' }, 'À l\'import, le fichier est entièrement vérifié avant toute modification. Tu choisis ensuite de fusionner avec tes données ou de les remplacer.'));
}

// ------------------------------------------------------------------ Application (PWA)

async function appSection() {
  const st = await installState();
  let persisted = null;
  let usage = null;
  try {
    persisted = await navigator.storage?.persisted?.();
    const est = await navigator.storage?.estimate?.();
    if (est?.usage !== undefined) usage = est.usage;
  } catch { /* API indisponible */ }
  const ko = usage !== null ? `${Math.max(1, Math.round(usage / 1024)).toLocaleString('fr-FR')} Ko utilisés` : null;

  const install = st.installed
    ? h('p', { class: 'fs-13' }, h('span', { class: 'badge badge-pos' }, icon('check', 'icon icon-sm'), 'Installée'), ' L\'application est ouverte comme une application installée.')
    : st.canPrompt
      ? h('button', { class: 'btn btn-primary', type: 'button', onClick: async () => { const r = await promptInstall(); if (r === 'accepted') toast('Application installée'); } }, icon('plus'), 'Installer l\'application')
      : h('p', { class: 'fs-13 muted' }, st.ios
        ? 'Sur iPhone / iPad : ouvre ce site dans Safari, touche « Partager » puis « Sur l\'écran d\'accueil ». Sur iOS, c\'est aussi ce qui protège tes données de l\'effacement automatique après 7 jours sans visite.'
        : 'Pour installer l\'application, utilise le menu de ton navigateur (« Installer l\'application » ou « Ajouter à l\'écran d\'accueil »). Le bouton apparaît ici quand le navigateur le propose.');

  const persistBtn = !persisted && navigator.storage?.persist
    ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: async () => {
      const ok = await navigator.storage.persist();
      toast(ok ? 'Stockage persistant accordé' : 'Le navigateur a refusé (il l\'accorde souvent aux applications installées ou souvent visitées).');
      if (ok) document.dispatchEvent(new CustomEvent('pfm:rerender'));
    } }, 'Demander le stockage persistant') : null;

  return section('Application',
    'Installée, l\'application s\'ouvre comme une appli classique et fonctionne sans connexion Internet.',
    install,
    h('p', { class: 'fs-13 muted' }, st.offlineReady ? 'Mode hors ligne : prêt (l\'application est enregistrée sur cet appareil).' : 'Mode hors ligne : se prépare au premier chargement (nécessite HTTPS ou localhost).'),
    h('div', { class: 'row wrap' }, h('p', { class: 'fs-13 muted' },
      persisted ? 'Stockage persistant accordé : le navigateur ne purgera pas ces données en cas de manque d\'espace.' : 'Stockage persistant non accordé.',
      ko ? ` · ${ko}.` : ''), persistBtn));
}

// ------------------------------------------------------------------ Confidentialité

function privacySection() {
  return section('Données et confidentialité', null,
    h('div', { class: 'alert alert-info' }, icon('info'), h('div', {},
      h('div', { class: 'alert-title' }, 'Tes données restent dans ce navigateur'),
      h('div', { class: 'alert-body' }, 'Rien n\'est envoyé sur Internet. Les données ne sont pas synchronisées entre tes appareils (ordinateur, téléphone) : utilise l\'export puis l\'import JSON pour les transférer. Vider les données du navigateur ou utiliser la navigation privée les efface. L\'application ne demande et ne stocke aucun identifiant bancaire.'))));
}

// ------------------------------------------------------------------ Zone de danger

function dangerSection() {
  return section('Réinitialisation', 'Efface définitivement toutes les données de ce navigateur.',
    h('div', {}, h('button', { class: 'btn btn-secondary btn-danger-outline', type: 'button', id: 'reset-btn', onClick: startReset }, icon('trash'), 'Effacer toutes les données…')));
}
