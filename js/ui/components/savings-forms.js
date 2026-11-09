/**
 * savings-forms.js — Formulaires de l'épargne (compte, mouvement, objectif)
 * et ligne de mouvement avec suppression annulable.
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { validateAccount, validateMovement, validateGoal, LIMITS } from '../../core/validation.js';
import { centsToInput, formatMoney } from '../../core/money.js';
import { todayISO, monthKeyOf, formatDate } from '../../core/dates.js';
import { ACCOUNT_TYPES, MOVEMENT_TYPES } from '../../domain/savings.js';
import {
  saveSavingsAccount, deleteSavingsAccount, setSavingsAccountArchived, saveMovement, deleteMovement, restoreMovement,
  saveGoal, deleteGoal, setGoalArchived, listSavingsAccounts, listGoals,
} from '../../data/repository.js';
import { defaultDateFor } from './transaction-form.js';

// ------------------------------------------------------------------ Outils de formulaire

/** Crée un champ avec libellé et zone d'erreur ; `id` relie le libellé et le message. */
function field(label, control, name, { hint, full } = {}) {
  // Le contrôle réel peut être enveloppé (ex. champ montant dans <span class="amount">).
  const input = control.matches('input, select, textarea') ? control : control.querySelector('input, select, textarea');
  if (input && !input.id) input.id = `f-${name}`;
  input?.setAttribute('aria-describedby', `f-${name}-err`);
  return h('div', { class: ['field', full && 'full'], dataset: { field: name } },
    h('label', { class: 'field-label', for: input?.id }, label), control,
    h('span', { class: 'field-error', id: `f-${name}-err`, role: 'alert', hidden: true }),
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

function showErrors(form, errors) {
  for (const el of form.querySelectorAll('.field-error')) { el.hidden = true; el.textContent = ''; }
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  let first = null;
  for (const [name, msg] of Object.entries(errors)) {
    const box = form.querySelector(`#f-${name}-err`);
    if (!box) continue;
    box.textContent = msg; box.hidden = false;
    const c = form.querySelector(`#f-${name}`) ?? form.querySelector(`[data-field="${name}"] button`);
    c?.setAttribute('aria-invalid', 'true');
    first ??= c;
  }
  first?.focus();
}

/** Affiche une erreur générale (ex. solde négatif refusé) en haut du formulaire. */
function formAlert(form, message) {
  form.querySelector('.form-alert')?.remove();
  form.prepend(h('div', { class: 'alert alert-error form-alert', role: 'alert' }, icon('alert'), h('div', { class: 'alert-body' }, message)));
}

/** Ouvre une modale de formulaire standard et gère l'enregistrement. */
function formModal({ title, form, submitLabel, onSubmit, extraFooter = [], initialFocus }) {
  return new Promise((resolve) => {
    let result = null;
    const save = h('button', { class: 'btn btn-primary', type: 'button' }, submitLabel);
    const submit = async () => {
      save.disabled = true;
      try {
        result = await onSubmit();
        if (result) m.close();
      } catch (err) {
        formAlert(form, err.message);
      } finally { save.disabled = false; }
    };
    save.addEventListener('click', submit);
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    form.append(h('button', { type: 'submit', hidden: true, tabindex: '-1' }));
    const m = openModal({
      title, body: form, initialFocus,
      footer: [...extraFooter, h('button', { class: 'btn btn-secondary hide-mobile', type: 'button', onClick: () => m.close() }, 'Annuler'), save],
      onClose: () => resolve(result),
    });
  });
}

/** Ferme la modale de formulaire ouverte (via son bouton, pour un nettoyage complet). */
function closeTopModal() {
  const roots = document.querySelectorAll('.modal-root');
  roots[roots.length - 1]?.querySelector('.modal-head .btn')?.click();
}

const DEFAULT_ACCOUNT_COLORS = ['#3d4fd6', '#0f7a55', '#0a7671', '#7a5af8', '#b04e08', '#0e86ad', '#b5408f', '#57606f'];

// ------------------------------------------------------------------ Compte d'épargne

export async function openAccountForm({ account = null } = {}) {
  const existing = await listSavingsAccounts();
  const name = h('input', { class: 'input', maxlength: String(LIMITS.name), value: account?.name ?? '', placeholder: 'Ex. Livret A' });
  const type = h('select', { class: 'select' }, Object.entries(ACCOUNT_TYPES).map(([k, l]) => h('option', { value: k, selected: k === (account?.type ?? 'livretA') }, l)));
  const opening = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0,00', value: account ? centsToInput(account.openingBalanceCents) : '' });
  const date = h('input', { class: 'input', type: 'date', value: account?.openingDate ?? todayISO() });
  const color = h('input', { type: 'color', class: 'input', style: { padding: '4px', width: '64px' }, value: account?.color ?? DEFAULT_ACCOUNT_COLORS[existing.length % DEFAULT_ACCOUNT_COLORS.length] });
  type.addEventListener('change', () => { if (!name.value.trim()) name.value = ACCOUNT_TYPES[type.value]; });

  const form = h('form', { class: 'form-grid', novalidate: true },
    field('Nom du compte', name, 'name', { full: true }),
    field('Type', type, 'type'),
    field('Couleur', color, 'color'),
    field('Solde de départ', h('span', { class: 'amount' }, opening), 'openingBalance', { hint: 'Montant présent sur le compte à la date ci-contre.' }),
    field('À la date du', date, 'openingDate', { hint: 'Les mouvements antérieurs à cette date sont refusés.' }));
  opening.id = 'f-openingBalance';

  const extraFooter = [];
  if (account) {
    extraFooter.push(h('button', { class: 'btn btn-ghost spacer', type: 'button', onClick: async () => {
      try {
        if (!(await confirmDialog({ title: `Supprimer « ${account.name} » ?`, message: 'Seul un compte sans aucun mouvement peut être supprimé. Sinon, archive-le pour conserver l\'historique.', confirmLabel: 'Supprimer', danger: true }))) return;
        await deleteSavingsAccount(account.id);
        closeTopModal();
        toast('Compte supprimé');
      } catch (err) { formAlert(form, err.message); }
    } }, icon('trash'), 'Supprimer'),
    h('button', { class: 'btn btn-secondary', type: 'button', onClick: async () => {
      await setSavingsAccountArchived(account.id, !account.archived);
      closeTopModal();
      toast(account.archived ? 'Compte réactivé' : 'Compte archivé : son solde reste compté dans l\'épargne totale.');
    } }, account.archived ? 'Réactiver' : 'Archiver'));
  }

  return formModal({
    title: account ? 'Modifier le compte' : 'Nouveau compte d\'épargne',
    form, submitLabel: account ? 'Enregistrer' : 'Créer le compte', initialFocus: name, extraFooter,
    onSubmit: async () => {
      const r = validateAccount({ name: name.value, type: type.value, openingBalance: opening.value, openingDate: date.value, color: color.value });
      if (!r.ok) { showErrors(form, r.errors); return null; }
      const rec = await saveSavingsAccount(r.value, account?.id ?? null);
      toast(account ? 'Compte modifié' : `Compte « ${rec.name} » créé`);
      return rec;
    },
  });
}

// ------------------------------------------------------------------ Mouvement

/**
 * @param {object} opts
 * @param {object} [opts.movement]   mouvement à modifier
 * @param {string} [opts.type]       type proposé à l'ouverture
 * @param {string} [opts.accountId]  compte proposé
 * @param {string} [opts.goalId]     objectif proposé
 * @param {string} [opts.month]      mois consulté (date par défaut)
 */
export async function openMovementForm({ movement = null, type = 'deposit', accountId = null, goalId = null, month } = {}) {
  const [accounts, goals] = await Promise.all([listSavingsAccounts(), listGoals()]);
  const usable = accounts.filter((a) => !a.archived || a.id === movement?.accountId || a.id === movement?.toAccountId);
  if (!usable.length) {
    toast('Crée d\'abord un compte d\'épargne.');
    return openAccountForm();
  }
  let currentType = movement?.type ?? type;

  const typeButtons = Object.entries(MOVEMENT_TYPES).map(([k, t]) => h('button', {
    type: 'button', dataset: { value: k }, aria: { pressed: String(k === currentType) }, onClick: () => setType(k),
  }, t.label));
  const typeSeg = h('div', { class: 'seg seg-block', role: 'group', aria: { label: 'Type de mouvement' } }, typeButtons);
  const help = h('p', { class: 'field-hint full' });

  const amount = h('input', { class: 'input', id: 'f-amount', inputmode: 'decimal', placeholder: '0,00', value: movement ? centsToInput(movement.amountCents) : '' });
  const date = h('input', { class: 'input', type: 'date', value: movement?.date ?? defaultDateFor(month ?? monthKeyOf(todayISO())) });
  const accountOptions = (selected) => usable.map((a) => h('option', { value: a.id, selected: a.id === selected }, a.archived ? `${a.name} (archivé)` : a.name));
  const from = h('select', { class: 'select' }, accountOptions(movement?.accountId ?? accountId ?? usable[0].id));
  const to = h('select', { class: 'select' }, h('option', { value: '' }, 'Choisir…'), accountOptions(movement?.toAccountId ?? usable.find((a) => a.id !== from.value)?.id));
  const activeGoals = goals.filter((g) => !g.archived || g.id === movement?.goalId);
  const goal = h('select', { class: 'select' }, h('option', { value: '' }, 'Aucun (épargne libre)'),
    activeGoals.map((g) => h('option', { value: g.id, selected: g.id === (movement?.goalId ?? goalId) }, g.name)));
  const label = h('input', { class: 'input', maxlength: String(LIMITS.label), value: movement?.label ?? '', placeholder: 'Facultatif' });
  const description = h('textarea', { class: 'input textarea', rows: '2', maxlength: String(LIMITS.description) });
  description.value = movement?.description ?? '';

  const fromField = field('Compte', from, 'accountId');
  const fromLabel = fromField.querySelector('.field-label');
  const toField = field('Vers le compte', to, 'toAccountId');
  const goalField = field('Objectif', goal, 'goalId', { hint: 'Affecter ce mouvement à un objectif fait progresser sa barre.' });

  const HELP = {
    deposit: 'Argent viré depuis ton compte courant. Il quitte le solde disponible sans être compté comme une dépense.',
    withdrawal: 'Argent rapatrié vers ton compte courant. Il n\'est pas compté comme un revenu.',
    transfer: 'Déplacement entre deux comptes d\'épargne : l\'épargne totale ne change pas.',
    interest: 'Intérêts versés par la banque : ils augmentent l\'épargne sans être un revenu ni toucher au compte courant.',
  };
  function setType(k) {
    currentType = k;
    for (const b of typeButtons) b.setAttribute('aria-pressed', String(b.dataset.value === k));
    toField.hidden = k !== 'transfer';
    goalField.hidden = k === 'transfer';
    fromLabel.textContent = k === 'transfer' ? 'Depuis le compte' : k === 'deposit' ? 'Vers le compte' : k === 'withdrawal' ? 'Depuis le compte' : 'Sur le compte';
    help.textContent = HELP[k];
    if (m) m.dialog.querySelector('.modal-title').textContent = titleFor(k);
  }
  const titleFor = (k) => (movement ? 'Modifier le mouvement' : { deposit: 'Nouveau versement', withdrawal: 'Nouveau retrait', transfer: 'Nouveau transfert', interest: 'Intérêts reçus' }[k]);

  const form = h('form', { class: 'form-grid', novalidate: true },
    h('div', { class: 'full' }, typeSeg), help,
    h('div', { class: 'full' }, field('Montant', h('span', { class: 'amount' }, amount), 'amount')),
    fromField, toField, field('Date', date, 'date'), goalField,
    field('Libellé', label, 'label'),
    field('Description', description, 'description', { full: true }));

  let m = null;
  setType(currentType);
  const extraFooter = movement ? [h('button', { class: 'btn btn-ghost spacer', type: 'button', onClick: async () => {
    try { await deleteMovementWithUndo(movement); closeTopModal(); } catch (err) { formAlert(form, err.message); }
  } }, icon('trash'), 'Supprimer')] : [];

  const promise = formModal({
    title: titleFor(currentType), form, submitLabel: movement ? 'Enregistrer' : 'Ajouter', initialFocus: amount, extraFooter,
    onSubmit: async () => {
      const r = validateMovement({
        type: currentType, amount: amount.value, date: date.value, accountId: from.value, toAccountId: to.value,
        goalId: goal.value, label: label.value, description: description.value,
      }, { accountIds: new Set(accounts.map((a) => a.id)), goalIds: new Set(goals.map((g) => g.id)) });
      if (!r.ok) { showErrors(form, r.errors); return null; }
      const rec = await saveMovement(r.value, movement?.id ?? null);
      toast(movement ? 'Mouvement modifié' : `${MOVEMENT_TYPES[rec.type].label} enregistré${rec.type === 'interest' ? 's' : ''} : ${formatMoney(rec.amountCents)}`);
      return rec;
    },
  });
  m = { dialog: document.querySelector('.modal-root:last-of-type .modal') };
  return promise;
}

/** Supprime un mouvement avec « Annuler » (refusé si un compte devenait négatif). */
export async function deleteMovementWithUndo(movement) {
  const deleted = await deleteMovement(movement.id);
  if (!deleted) return;
  toast('Mouvement supprimé', { action: { label: 'Annuler', onClick: () => restoreMovement(deleted).then(() => toast('Suppression annulée')).catch((e) => toast(e.message)) } });
}

/** Libellé affiché d'un mouvement. */
export function movementTitle(m, accountsById) {
  if (m.label) return m.label;
  const a = accountsById.get(m.accountId)?.name ?? 'compte supprimé';
  if (m.type === 'transfer') return `Transfert ${a} → ${accountsById.get(m.toAccountId)?.name ?? '?'}`;
  return `${MOVEMENT_TYPES[m.type].label} · ${a}`;
}

/** Ligne de mouvement (liste de la page Épargne). */
export function movementRow(m, { accountsById, goalsById, onOpen }) {
  const sign = m.type === 'withdrawal' ? -1 : m.type === 'transfer' ? 0 : 1;
  const iconName = { deposit: 'income', withdrawal: 'expense', transfer: 'repeat', interest: 'coins' }[m.type];
  const acc = accountsById.get(m.accountId);
  const color = acc?.color ?? 'var(--accent)';
  const goal = m.goalId ? goalsById.get(m.goalId) : null;
  const amountText = sign === 0 ? formatMoney(m.amountCents) : formatMoney(sign * m.amountCents, { sign: 'always' });
  const row = h('div', {
    class: 'tx', role: 'button', tabindex: '0', aria: { label: `${movementTitle(m, accountsById)}, ${amountText}, ${formatDate(m.date, 'long')}` },
    onClick: (e) => { if (!e.target.closest('.tx-actions')) onOpen(m); },
    onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); onOpen(m); } },
  },
  h('span', { class: 'tx-icon', style: { color } }, icon(iconName)),
  h('span', { class: 'tx-main' }, h('span', { class: 'tx-title' }, movementTitle(m, accountsById)),
    h('span', { class: 'tx-meta' }, formatDate(m.date, 'medium'),
      h('span', { class: 'badge' }, MOVEMENT_TYPES[m.type].label),
      goal ? h('span', { class: 'badge badge-accent' }, goal.name) : null)),
  h('span', { class: ['tx-amount', sign > 0 && 'in'] }, amountText),
  h('span', { class: 'tx-actions' }, h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Supprimer', aria: { label: 'Supprimer le mouvement' },
    onClick: () => deleteMovementWithUndo(m).catch((e) => toast(e.message)) }, icon('trash', 'icon icon-sm'))));
  return row;
}

// ------------------------------------------------------------------ Objectif

export async function openGoalForm({ goal = null } = {}) {
  const name = h('input', { class: 'input', maxlength: String(LIMITS.name), value: goal?.name ?? '', placeholder: 'Ex. Réserve d\'urgence' });
  const target = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0,00', value: goal ? centsToInput(goal.targetCents) : '' });
  target.id = 'f-target';
  const deadline = h('input', { class: 'input', type: 'date', value: goal?.deadline ?? '' });
  const color = h('input', { type: 'color', class: 'input', style: { padding: '4px', width: '64px' }, value: goal?.color ?? '#3d4fd6' });
  const form = h('form', { class: 'form-grid', novalidate: true },
    field('Nom de l\'objectif', name, 'name', { full: true }),
    h('div', { class: 'full' }, field('Montant visé', h('span', { class: 'amount' }, target), 'target')),
    field('Échéance', deadline, 'deadline', { hint: 'Facultative : permet de calculer l\'effort mensuel.' }),
    field('Couleur', color, 'color'),
    h('p', { class: 'field-hint full' }, 'Pour faire progresser l\'objectif, affecte-lui des versements depuis l\'onglet Comptes.'));

  const extraFooter = goal ? [
    h('button', { class: 'btn btn-ghost spacer', type: 'button', onClick: async () => {
      if (!(await confirmDialog({ title: `Supprimer « ${goal.name} » ?`, message: 'Les versements affectés à cet objectif sont conservés et deviennent de l\'épargne libre.', confirmLabel: 'Supprimer', danger: true }))) return;
      await deleteGoal(goal.id);
      closeTopModal();
      toast('Objectif supprimé');
    } }, icon('trash'), 'Supprimer'),
    h('button', { class: 'btn btn-secondary', type: 'button', onClick: async () => {
      await setGoalArchived(goal.id, !goal.archived);
      closeTopModal();
      toast(goal.archived ? 'Objectif réactivé' : 'Objectif archivé');
    } }, goal.archived ? 'Réactiver' : 'Archiver'),
  ] : [];

  return formModal({
    title: goal ? 'Modifier l\'objectif' : 'Nouvel objectif d\'épargne',
    form, submitLabel: goal ? 'Enregistrer' : 'Créer l\'objectif', initialFocus: name, extraFooter,
    onSubmit: async () => {
      const r = validateGoal({ name: name.value, target: target.value, deadline: deadline.value, color: color.value });
      if (!r.ok) { showErrors(form, r.errors); return null; }
      const rec = await saveGoal(r.value, goal?.id ?? null);
      toast(goal ? 'Objectif modifié' : `Objectif « ${rec.name} » créé`);
      return rec;
    },
  });
}
