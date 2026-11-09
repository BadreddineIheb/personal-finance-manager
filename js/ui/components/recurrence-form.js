/**
 * recurrence-form.js — Formulaire d'une opération récurrente (salaire, loyer, abonnement…),
 * avec aperçu en direct des prochaines dates, et carte de récurrence pour les listes.
 */
import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { validateRecurrence, LIMITS } from '../../core/validation.js';
import { centsToInput, formatMoney } from '../../core/money.js';
import { todayISO, formatDate, MONTHS, addDays } from '../../core/dates.js';
import { EXPENSE_TYPES, INCOME_TYPES, categoryColor } from '../../data/schema.js';
import { saveRecurrence, deleteRecurrence, setRecurrenceActive, generateDueOccurrences } from '../../data/repository.js';
import { FREQUENCIES, describeFrequency, nextOccurrence, occurrencesBetween } from '../../domain/recurrence.js';
import { getCategories } from '../cache.js';

/** Après enregistrement : crée immédiatement les occurrences déjà échues (rattrapage). */
async function catchUp() {
  const n = await generateDueOccurrences(todayISO());
  if (n) toast(`${n} occurrence${n > 1 ? 's' : ''} passée${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} à l'historique`);
}

function field(label, control, name, { hint, full } = {}) {
  const input = control.matches('input, select, textarea') ? control : control.querySelector('input, select, textarea');
  if (input && !input.id) input.id = `r-${name}`;
  input?.setAttribute('aria-describedby', `r-${name}-err`);
  return h('div', { class: ['field', full && 'full'], dataset: { field: name } },
    h('label', { class: 'field-label', for: input?.id }, label), control,
    h('span', { class: 'field-error', id: `r-${name}-err`, role: 'alert', hidden: true }),
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

/**
 * @param {object} opts
 * @param {'expense'|'income'} opts.kind
 * @param {object} [opts.recurrence] récurrence à modifier
 */
export async function openRecurrenceForm({ kind = 'expense', recurrence = null } = {}) {
  const { active: cats, byId } = await getCategories();
  const r = recurrence;
  kind = r?.kind ?? kind;
  const isExpense = kind === 'expense';

  const label = h('input', { class: 'input', maxlength: String(LIMITS.label), value: r?.label ?? '', placeholder: isExpense ? 'Ex. Loyer, Netflix, Assurance auto' : 'Ex. Salaire alternance, APL' });
  const amount = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0,00', value: r ? centsToInput(r.amountCents) : '' });
  amount.id = 'r-amount';
  const catList = [...cats];
  if (r?.categoryId && !cats.some((c) => c.id === r.categoryId) && byId.has(r.categoryId)) catList.push(byId.get(r.categoryId));
  const category = h('select', { class: 'select' }, h('option', { value: '' }, 'Choisir…'), catList.map((c) => h('option', { value: c.id, selected: c.id === r?.categoryId }, c.name)));
  const expenseType = h('select', { class: 'select' }, Object.entries(EXPENSE_TYPES).map(([k, t]) => h('option', { value: k, selected: k === (r?.expenseType ?? 'fixed') }, t.label)));
  let typeTouched = Boolean(r);
  expenseType.addEventListener('change', () => { typeTouched = true; });
  category.addEventListener('change', () => { const c = byId.get(category.value); if (c && !typeTouched) expenseType.value = c.defaultExpenseType; });
  const incomeType = h('select', { class: 'select' }, Object.entries(INCOME_TYPES).map(([k, t]) => h('option', { value: k, selected: k === (r?.incomeType ?? 'salary') }, t.label)));

  const frequency = h('select', { class: 'select' }, Object.entries(FREQUENCIES).map(([k, l]) => h('option', { value: k, selected: k === (r?.frequency ?? 'monthly') }, l)));
  const interval = h('input', { class: 'input', type: 'number', min: '1', max: '52', step: '1', value: String(r?.interval ?? 2) });
  const day = h('input', { class: 'input', type: 'number', min: '1', max: '31', step: '1', value: r ? String(r.dayOfMonth) : '', placeholder: 'Jour de la date de début' });
  const monthOfYear = h('select', { class: 'select' }, MONTHS.map((m, i) => h('option', { value: String(i + 1), selected: i + 1 === (r?.monthOfYear ?? Number(todayISO().slice(5, 7))) }, m)));
  const start = h('input', { class: 'input', type: 'date', value: r?.startDate ?? todayISO() });
  const end = h('input', { class: 'input', type: 'date', value: r?.endDate ?? '' });
  const description = h('textarea', { class: 'input textarea', rows: '2', maxlength: String(LIMITS.description) });
  description.value = r?.description ?? '';
  const activeBox = h('input', { type: 'checkbox', checked: r ? r.active : true });

  const intervalField = field('Intervalle', interval, 'interval');
  const intervalLabel = intervalField.querySelector('.field-label');
  const dayField = field('Jour du mois', day, 'dayOfMonth', { hint: '29, 30 ou 31 : ramené au dernier jour des mois plus courts.' });
  const monthField = field('Mois', monthOfYear, 'monthOfYear');
  const preview = h('div', { class: 'alert alert-info full' });

  const raw = () => ({
    kind, label: label.value, amount: amount.value, categoryId: category.value, expenseType: expenseType.value, incomeType: incomeType.value,
    frequency: frequency.value, interval: interval.value, dayOfMonth: day.value, monthOfYear: monthOfYear.value,
    startDate: start.value, endDate: end.value, description: description.value, active: activeBox.checked,
  });

  function updateVisibility() {
    const f = frequency.value;
    intervalField.hidden = !(f === 'everyNMonths' || f === 'weekly');
    intervalLabel.textContent = f === 'weekly' ? 'Toutes les … semaines' : 'Tous les … mois';
    dayField.hidden = f === 'weekly';
    monthField.hidden = f !== 'yearly';
    updatePreview();
  }
  function updatePreview() {
    const v = validateRecurrence({ ...raw(), label: raw().label || 'x', amount: raw().amount || '1', categoryId: isExpense ? (raw().categoryId || catList[0]?.id) : undefined }, { categoryIds: new Set(byId.keys()) });
    if (!v.ok) { mount(preview, icon('info'), h('div', { class: 'alert-body' }, 'Complète la fréquence et les dates pour voir les prochaines échéances.')); return; }
    const today = todayISO();
    const passed = occurrencesBetween(v.value, v.value.startDate, today).length;
    const next = [];
    let from = addDays(today, 1);
    for (let i = 0; i < 3; i += 1) {
      const d = nextOccurrence({ ...v.value, id: 'preview', skippedKeys: [] , active: true }, from);
      if (!d) break;
      next.push(d); from = addDays(d, 1);
    }
    mount(preview, icon('calendar'), h('div', {},
      h('div', { class: 'alert-title' }, describeFrequency(v.value)),
      h('div', { class: 'alert-body' },
        next.length ? `Prochaines échéances : ${next.map((d) => formatDate(d)).join(', ')}.` : 'Aucune échéance à venir (date de fin atteinte).',
        !r && passed ? ` ${passed} occurrence${passed > 1 ? 's' : ''} déjà passée${passed > 1 ? 's' : ''} (depuis le ${formatDate(v.value.startDate)}) ser${passed > 1 ? 'ont' : 'a'} ajoutée${passed > 1 ? 's' : ''} à l'historique.` : '')));
  }
  for (const el of [frequency, interval, day, monthOfYear, start, end]) el.addEventListener('input', updateVisibility);
  frequency.addEventListener('change', updateVisibility);

  const form = h('form', { class: 'form-grid', novalidate: true },
    field('Nom', label, 'label', { full: true }),
    h('div', { class: 'full' }, field('Montant', h('span', { class: 'amount' }, amount), 'amount')),
    isExpense ? field('Catégorie', category, 'categoryId') : field('Type de revenu', incomeType, 'incomeType'),
    isExpense ? field('Type de dépense', expenseType, 'expenseType') : h('span'),
    field('Fréquence', frequency, 'frequency'), intervalField, dayField, monthField,
    field('Date de début', start, 'startDate', { hint: 'Première échéance possible.' }),
    field('Date de fin', end, 'endDate', { hint: 'Facultative.' }),
    field('Description', description, 'description', { full: true }),
    r ? h('label', { class: 'row full', style: { gap: '8px' } }, activeBox, 'Récurrence active (décocher pour la mettre en pause)') : null,
    preview,
    h('p', { class: 'field-hint full' }, r
      ? 'Les modifications s\'appliquent aux prochaines échéances. Les opérations déjà créées ne changent pas.'
      : 'Chaque échéance devient automatiquement une opération réelle le jour venu, sans doublon.'),
    h('button', { type: 'submit', hidden: true, tabindex: '-1' }));

  function showErrors(errors) {
    for (const el of form.querySelectorAll('.field-error')) { el.hidden = true; el.textContent = ''; }
    let first = null;
    for (const [name, msg] of Object.entries(errors)) {
      const box = form.querySelector(`#r-${name}-err`);
      if (!box) continue;
      box.textContent = msg; box.hidden = false;
      first ??= form.querySelector(`#r-${name}`);
    }
    first?.focus();
  }

  return new Promise((resolve) => {
    let saved = null;
    const save = h('button', { class: 'btn btn-primary', type: 'button' }, r ? 'Enregistrer' : 'Créer la récurrence');
    const submit = async () => {
      const v = validateRecurrence(raw(), { categoryIds: new Set(byId.keys()) });
      if (!v.ok) { showErrors(v.errors); return; }
      save.disabled = true;
      try {
        saved = await saveRecurrence(v.value, r?.id ?? null);
        m.close();
        toast(r ? 'Récurrence modifiée' : `Récurrence « ${saved.label} » créée`);
        await catchUp();
      } catch (err) { save.disabled = false; toast(err.message); }
    };
    save.addEventListener('click', submit);
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    const footer = [];
    if (r) footer.push(h('button', { class: 'btn btn-ghost spacer', type: 'button', onClick: async () => { m.close(); await confirmDeleteRecurrence(r); } }, icon('trash'), 'Supprimer'));
    footer.push(h('button', { class: 'btn btn-secondary hide-mobile', type: 'button', onClick: () => m.close() }, 'Annuler'), save);
    const m = openModal({
      title: r ? 'Modifier la récurrence' : (isExpense ? 'Nouvelle dépense récurrente' : 'Nouveau revenu récurrent'),
      body: form, footer, wide: true, initialFocus: label, onClose: () => resolve(saved),
    });
    updateVisibility();
  });
}

export async function confirmDeleteRecurrence(r) {
  const ok = await confirmDialog({
    title: `Supprimer la récurrence « ${r.label} » ?`,
    message: 'Les opérations déjà créées sont conservées dans l\'historique. Aucune nouvelle échéance ne sera ajoutée.',
    confirmLabel: 'Supprimer', danger: true,
  });
  if (!ok) return;
  await deleteRecurrence(r.id);
  toast('Récurrence supprimée');
}

/** Carte d'une récurrence dans l'onglet « Récurrents ». */
export function recurrenceCard(r, { categories }) {
  const isExpense = r.kind === 'expense';
  const cat = isExpense ? categories.get(r.categoryId) : null;
  const color = isExpense ? categoryColor(cat?.color) : 'var(--positive)';
  const next = nextOccurrence(r, addDays(todayISO(), 1));
  const toggle = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: async () => {
    await setRecurrenceActive(r.id, !r.active);
    toast(r.active ? 'Récurrence en pause' : 'Récurrence réactivée');
    if (!r.active) await catchUp();
  } }, r.active ? 'Mettre en pause' : 'Réactiver');

  return h('div', { class: ['tx', 'recurrence-row', !r.active && 'is-paused'], role: 'button', tabindex: '0',
    aria: { label: `${r.label}, ${formatMoney(r.amountCents)}, ${describeFrequency(r)}. Modifier` },
    onClick: (e) => { if (!e.target.closest('.tx-actions, button')) openRecurrenceForm({ recurrence: r }); },
    onKeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openRecurrenceForm({ recurrence: r }); } },
  h('span', { class: 'tx-icon', style: { color } }, icon(isExpense ? (cat?.icon ?? 'repeat') : (INCOME_TYPES[r.incomeType]?.icon ?? 'coins'))),
  h('span', { class: 'tx-main' }, h('span', { class: 'tx-title' }, r.label),
    h('span', { class: 'tx-meta' }, describeFrequency(r),
      isExpense ? h('span', { class: `badge badge-${r.expenseType}` }, h('span', { class: 'dot' }), EXPENSE_TYPES[r.expenseType]?.label) : h('span', {}, `· ${INCOME_TYPES[r.incomeType]?.label ?? ''}`),
      r.active
        ? (next ? h('span', { class: 'badge badge-accent' }, `Prochaine : ${formatDate(next)}`) : h('span', { class: 'badge' }, 'Terminée'))
        : h('span', { class: 'badge badge-warn' }, 'En pause'))),
  h('span', { class: ['tx-amount', isExpense ? 'out' : 'in'] }, formatMoney(isExpense ? -r.amountCents : r.amountCents, { sign: isExpense ? 'auto' : 'always' })),
  h('span', { class: 'tx-actions', style: { opacity: 1 } }, toggle,
    h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Supprimer', aria: { label: `Supprimer la récurrence ${r.label}` }, onClick: () => confirmDeleteRecurrence(r) }, icon('trash', 'icon icon-sm'))));
}
