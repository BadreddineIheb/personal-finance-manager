/**
 * transaction-form.js — Formulaire d'ajout / modification d'un revenu ou d'une dépense.
 * - Ajout : choix Dépense / Revenu en haut du formulaire.
 * - Le type de dépense est prérempli selon la catégorie, tant que l'utilisateur ne l'a pas choisi.
 * - Validation complète avant enregistrement ; erreurs affichées sous chaque champ.
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { validateTransaction, LIMITS } from '../../core/validation.js';
import { centsToInput } from '../../core/money.js';
import { todayISO, monthKeyOf, formatMonth, monthBounds } from '../../core/dates.js';
import { EXPENSE_TYPES, INCOME_TYPES } from '../../data/schema.js';
import { saveTransaction, deleteTransaction, saveTransactionAsRecurring } from '../../data/repository.js';
import { getCategories } from '../cache.js';
import { deleteWithUndo } from './transaction-row.js';

/** Date proposée par défaut : aujourd'hui si on consulte le mois en cours, sinon le 1er du mois consulté. */
export function defaultDateFor(month) {
  const today = todayISO();
  return monthKeyOf(today) === month ? today : monthBounds(month)[0];
}

/**
 * Ouvre le formulaire.
 * @param {object} opts
 * @param {'expense'|'income'} [opts.kind]   type proposé à l'ouverture
 * @param {object} [opts.record]              transaction à modifier
 * @param {object} [opts.duplicateOf]         transaction à dupliquer (nouvelle date proposée)
 * @param {string} [opts.month]               mois consulté (pour la date par défaut)
 * @param {boolean} [opts.lockKind]           masquer le choix Dépense / Revenu
 * @param {string} [opts.date]                date proposée (ex. jour choisi dans le calendrier)
 * @returns {Promise<object|null>} transaction enregistrée, ou null si annulé
 */
export async function openTransactionForm({ kind = 'expense', record = null, duplicateOf = null, month, lockKind = false, date: presetDate = null } = {}) {
  const { active, byId } = await getCategories();
  const source = record ?? duplicateOf;
  const isEdit = Boolean(record);
  let currentKind = source?.kind ?? kind;
  let typeTouched = Boolean(source); // en modification, on respecte le type existant

  return new Promise((resolve) => {
    let saved = null;

    // ---------- Champs ----------
    const amount = h('input', { class: 'input', id: 'tf-amount', name: 'amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00',
      value: source ? centsToInput(source.amountCents) : '', aria: { describedby: 'tf-amount-err' } });
    const label = h('input', { class: 'input', id: 'tf-label', name: 'label', maxlength: String(LIMITS.label), autocomplete: 'off',
      value: source?.label ?? '', aria: { describedby: 'tf-label-err' } });
    const date = h('input', { class: 'input', id: 'tf-date', name: 'date', type: 'date', required: true,
      value: duplicateOf ? (presetDate ?? defaultDateFor(month ?? monthKeyOf(todayISO()))) : (record?.date ?? presetDate ?? defaultDateFor(month ?? monthKeyOf(todayISO()))),
      aria: { describedby: 'tf-date-err' } });

    // Catégories : celles actives + celle de la transaction si elle a été archivée depuis
    const catOptions = [...active];
    if (source?.categoryId && !active.some((c) => c.id === source.categoryId) && byId.has(source.categoryId)) catOptions.push(byId.get(source.categoryId));
    const category = h('select', { class: 'select', id: 'tf-category', name: 'categoryId', aria: { describedby: 'tf-category-err' } },
      h('option', { value: '' }, 'Choisir une catégorie…'),
      catOptions.map((c) => h('option', { value: c.id, selected: c.id === source?.categoryId }, c.archived ? `${c.name} (archivée)` : c.name)));

    let expenseType = source?.expenseType ?? null;
    const typeButtons = Object.entries(EXPENSE_TYPES).map(([key, t]) => h('button', {
      type: 'button', dataset: { value: key }, aria: { pressed: String(key === expenseType) },
      onClick: () => { typeTouched = true; setExpenseType(key); },
    }, h('span', { class: `badge-${key === 'fixed' ? 'fixed' : key === 'variable' ? 'variable' : 'exceptional'}`, style: { display: 'inline-flex' } },
      h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' } })), t.label));
    const typeSeg = h('div', { class: 'seg seg-block', role: 'group', aria: { label: 'Type de dépense', describedby: 'tf-expenseType-err' } }, typeButtons);
    function setExpenseType(key) {
      expenseType = key;
      for (const b of typeButtons) b.setAttribute('aria-pressed', String(b.dataset.value === key));
    }

    const incomeType = h('select', { class: 'select', id: 'tf-incomeType', name: 'incomeType', aria: { describedby: 'tf-incomeType-err' } },
      Object.entries(INCOME_TYPES).map(([key, t]) => h('option', { value: key, selected: key === (source?.incomeType ?? 'salary') }, t.label)));

    const description = h('textarea', { class: 'input textarea', id: 'tf-description', name: 'description', rows: '2', maxlength: String(LIMITS.description) });
    description.value = source?.description ?? '';

    category.addEventListener('change', () => {
      const c = byId.get(category.value);
      if (c && !typeTouched) setExpenseType(c.defaultExpenseType);
    });

    const err = (name) => h('span', { class: 'field-error', id: `tf-${name}-err`, role: 'alert', hidden: true });
    const field = (lbl, control, name, extra = {}) => h('div', { class: ['field', extra.full && 'full'], dataset: { field: name } },
      h('label', { class: 'field-label', for: control.id ?? undefined }, lbl), control, err(name), extra.hint ? h('span', { class: 'field-hint' }, extra.hint) : null);

    // Un seul champ date, partagé : seul son libellé change selon la nature de la transaction.
    const dateField = field('Date', date, 'date');
    const dateLabel = dateField.querySelector('.field-label');
    const expenseFields = [
      field('Catégorie', category, 'categoryId'),
      dateField,
      h('div', { class: 'field full', dataset: { field: 'expenseType' } }, h('span', { class: 'field-label' }, 'Type de dépense'), typeSeg, err('expenseType'),
        h('span', { class: 'field-hint' }, 'Prérempli selon la catégorie. Fixe : loyer, abonnements… Variable : courses, carburant… Exceptionnelle : réparations, gros achats.')),
    ];
    const incomeFields = [field('Type de revenu', incomeType, 'incomeType'), dateField];
    const dynamic = h('div', { class: 'form-grid' });

    const kindButtons = [['expense', 'Dépense'], ['income', 'Revenu']].map(([k, l]) => h('button', {
      type: 'button', dataset: { value: k }, aria: { pressed: String(k === currentKind) }, onClick: () => setKind(k),
    }, l));
    const kindSeg = h('div', { class: 'seg seg-block', role: 'group', aria: { label: 'Nature de la transaction' } }, kindButtons);

    function setKind(k) {
      currentKind = k;
      for (const b of kindButtons) b.setAttribute('aria-pressed', String(b.dataset.value === k));
      dynamic.replaceChildren(...(k === 'expense' ? expenseFields : incomeFields));
      dateLabel.textContent = k === 'expense' ? 'Date' : 'Date de réception';
      label.placeholder = k === 'expense' ? 'Ex. Courses Leclerc' : 'Ex. Salaire alternance';
      modal && (modal.dialog.querySelector('.modal-title').textContent = titleFor(k));
      clearErrors();
    }
    const titleFor = (k) => {
      const noun = k === 'expense' ? 'dépense' : 'revenu';
      if (isEdit) return `Modifier ${k === 'expense' ? 'la' : 'le'} ${noun}`;
      if (duplicateOf) return `Dupliquer ${k === 'expense' ? 'la' : 'le'} ${noun}`;
      return k === 'expense' ? 'Nouvelle dépense' : 'Nouveau revenu';
    };

    // « Répéter chaque mois » : uniquement à la création (crée aussi la récurrence mensuelle)
    const repeat = h('input', { type: 'checkbox', id: 'tf-repeat' });
    const repeatHint = h('span', { class: 'field-hint' });
    const updateRepeatHint = () => {
      const d = Number(date.value.slice(8, 10));
      repeatHint.textContent = d ? `Ajoutée automatiquement chaque mois le ${d === 1 ? '1er' : d}${d >= 29 ? ' (ou le dernier jour du mois)' : ''}. Modifiable dans l'onglet « Récurrents ».` : '';
    };
    date.addEventListener('input', updateRepeatHint);
    updateRepeatHint();
    const repeatField = !isEdit && !duplicateOf ? h('div', { class: 'stack-sm' },
      h('label', { class: 'row', style: { gap: '8px' }, for: 'tf-repeat' }, repeat, h('span', { class: 'fw-600' }, 'Répéter tous les mois à cette date')),
      repeatHint) : null;

    const form = h('form', { class: 'stack', novalidate: true, onSubmit: (e) => { e.preventDefault(); submit(); } },
      !isEdit && !lockKind ? kindSeg : null,
      h('div', { class: 'field', dataset: { field: 'amount' } }, h('label', { class: 'field-label', for: 'tf-amount' }, 'Montant'),
        h('span', { class: 'amount' }, amount), err('amount')),
      h('div', { class: 'field', dataset: { field: 'label' } }, h('label', { class: 'field-label', for: 'tf-label' }, 'Nom'), label, err('label')),
      dynamic,
      h('div', { class: 'field', dataset: { field: 'description' } },
        h('label', { class: 'field-label', for: 'tf-description' }, 'Description ', h('span', { class: 'subtle' }, '(facultatif)')), description, err('description')),
      repeatField,
      record?.recurringId ? h('div', { class: 'alert alert-info' }, icon('info'), h('div', { class: 'alert-body' },
        'Occurrence d\'une récurrence. La modifier ne change pas les prochaines échéances.')) : null,
      h('button', { type: 'submit', hidden: true, tabindex: '-1' }), // validation par Entrée
    );

    function clearErrors() {
      for (const el of form.querySelectorAll('.field-error')) { el.hidden = true; el.textContent = ''; }
      for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    }
    function showErrors(errors) {
      clearErrors();
      let first = null;
      for (const [name, msg] of Object.entries(errors)) {
        const box = form.querySelector(`#tf-${name}-err`);
        if (!box) continue;
        box.textContent = msg;
        box.hidden = false;
        const control = form.querySelector(`#tf-${name}`) ?? form.querySelector(`[data-field="${name}"] button`);
        control?.setAttribute('aria-invalid', 'true');
        first ??= control;
      }
      first?.focus();
    }

    async function submit() {
      const raw = {
        kind: currentKind,
        label: label.value,
        amount: amount.value,
        date: date.value,
        description: description.value,
        categoryId: category.value,
        expenseType,
        incomeType: incomeType.value,
      };
      const r = validateTransaction(raw, { categoryIds: new Set(byId.keys()) });
      if (!r.ok) { showErrors(r.errors); return; }
      saveBtn.disabled = true;
      try {
        if (repeat.checked && !isEdit) saved = (await saveTransactionAsRecurring(r.value)).transaction;
        else saved = await saveTransaction(r.value, record?.id ?? null);
        modal.close();
        const where = monthKeyOf(saved.date) !== month && month ? ` (en ${formatMonth(monthKeyOf(saved.date))})` : '';
        toast(`${saved.kind === 'expense' ? 'Dépense' : 'Revenu'} ${isEdit ? 'modifié' : 'enregistré'}${saved.kind === 'expense' ? 'e' : ''}${where}${repeat.checked && !isEdit ? ', répété chaque mois' : ''}`);
      } catch (e) {
        console.error(e);
        saveBtn.disabled = false;
        toast(`Enregistrement impossible : ${e.message}`);
      }
    }

    // ---------- Pied ----------
    const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onClick: submit }, isEdit ? 'Enregistrer' : 'Ajouter');
    const footer = [];
    if (isEdit) {
      footer.push(
        h('button', { class: 'btn btn-ghost spacer', type: 'button', onClick: async () => { modal.close(); await deleteWithUndo(record); } }, icon('trash'), 'Supprimer'),
        h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => { modal.close(); openTransactionForm({ duplicateOf: record, month }); } }, icon('copy'), 'Dupliquer'),
      );
    }
    footer.push(h('button', { class: 'btn btn-secondary hide-mobile', type: 'button', onClick: () => modal.close() }, 'Annuler'), saveBtn);

    let modal = null;
    setKind(currentKind);
    if (source?.expenseType) setExpenseType(source.expenseType);
    modal = openModal({
      title: titleFor(currentKind),
      body: form,
      footer,
      initialFocus: amount,
      onClose: () => resolve(saved),
    });
  });
}

export { deleteTransaction };
