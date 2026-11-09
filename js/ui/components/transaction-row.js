/**
 * transaction-row.js — Ligne de revenu ou de dépense, et suppression avec annulation.
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { toast } from './toast.js';
import { formatMoney } from '../../core/money.js';
import { formatDate } from '../../core/dates.js';
import { EXPENSE_TYPES, INCOME_TYPES, categoryColor } from '../../data/schema.js';
import { deleteTransaction, restoreTransaction } from '../../data/repository.js';

/** Supprime une transaction et propose « Annuler » pendant 6 secondes. */
export async function deleteWithUndo(record) {
  const deleted = await deleteTransaction(record.id);
  if (!deleted) return;
  toast(`${deleted.kind === 'expense' ? 'Dépense supprimée' : 'Revenu supprimé'} : ${deleted.label}`, {
    action: { label: 'Annuler', onClick: () => restoreTransaction(deleted).then(() => toast('Suppression annulée')) },
  });
}

/**
 * @param {object} t transaction
 * @param {object} opts
 * @param {Map} opts.categories
 * @param {(t) => void} opts.onOpen       clic sur la ligne
 * @param {(t) => void} [opts.onDuplicate]
 * @param {boolean} [opts.showDate]       afficher la date dans la méta (sinon regroupé par jour)
 */
export function transactionRow(t, { categories, onOpen, onDuplicate, showDate = true, actions = true }) {
  const isExpense = t.kind === 'expense';
  const cat = isExpense ? categories.get(t.categoryId) : null;
  const iconName = isExpense ? (cat?.icon ?? 'dots') : (INCOME_TYPES[t.incomeType]?.icon ?? 'coins');
  const color = isExpense ? categoryColor(cat?.color) : 'var(--positive)';

  const meta = h('span', { class: 'tx-meta' },
    showDate ? h('span', {}, formatDate(t.date, 'medium')) : null,
    isExpense
      ? [h('span', { class: 'cat' }, h('i', { style: { background: color } }), cat?.name ?? 'Catégorie supprimée'),
        h('span', { class: `badge badge-${t.expenseType}` }, h('span', { class: 'dot' }), EXPENSE_TYPES[t.expenseType]?.label ?? '')]
      : h('span', {}, INCOME_TYPES[t.incomeType]?.label ?? 'Revenu'),
    t.recurringId ? h('span', { class: 'badge badge-accent' }, 'Récurrent') : null,
    t.description ? h('span', { class: 'ellipsis', title: t.description, style: { maxWidth: '240px' } }, `· ${t.description}`) : null,
  );

  const row = h('div', {
    class: 'tx', role: 'button', tabindex: '0',
    aria: { label: `${t.label}, ${formatMoney(t.amountCents)}, ${formatDate(t.date, 'long')}. Ouvrir` },
    onClick: (e) => { if (!e.target.closest('.tx-actions')) onOpen(t); },
    onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); onOpen(t); } },
  },
  h('span', { class: 'tx-icon', style: { color } }, icon(iconName)),
  h('span', { class: 'tx-main' }, h('span', { class: 'tx-title' }, t.label), meta),
  h('span', { class: ['tx-amount', isExpense ? 'out' : 'in'] }, formatMoney(isExpense ? -t.amountCents : t.amountCents, { sign: isExpense ? 'auto' : 'always' })),
  actions ? h('span', { class: 'tx-actions' },
    onDuplicate ? h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Dupliquer', aria: { label: `Dupliquer ${t.label}` }, onClick: () => onDuplicate(t) }, icon('copy', 'icon icon-sm')) : null,
    h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Supprimer', aria: { label: `Supprimer ${t.label}` }, onClick: () => deleteWithUndo(t) }, icon('trash', 'icon icon-sm')),
  ) : null);
  return row;
}
