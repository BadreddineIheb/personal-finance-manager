/**
 * month-picker.js — Sélecteur global du mois consulté (barre supérieure).
 * Flèches mois précédent / suivant, et grille mois × année au clic sur le libellé.
 */
import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { addMonths, formatMonth, currentMonthKey, MONTHS_SHORT, pad2 } from '../../core/dates.js';

/**
 * @param {HTMLElement} slot
 * @param {{ onChange: (month: string) => void }} opts
 * @returns {{ update: (month: string) => void }}
 */
export function createMonthPicker(slot, { onChange }) {
  let month = currentMonthKey();
  let popover = null;
  let viewYear = Number(month.slice(0, 4));

  const label = h('button', { class: 'current', type: 'button', aria: { haspopup: 'dialog', expanded: 'false' } });
  const prev = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', aria: { label: 'Mois précédent' }, onClick: () => onChange(addMonths(month, -1)) }, icon('chevronLeft'));
  const next = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', aria: { label: 'Mois suivant' }, onClick: () => onChange(addMonths(month, 1)) }, icon('chevronRight'));
  const root = h('div', { class: 'month-picker' }, prev, label, next);
  mount(slot, root);

  const closePopover = () => {
    popover?.remove();
    popover = null;
    label.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onOutside = (e) => { if (!root.contains(e.target)) closePopover(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); label.focus(); } };

  function renderPopover() {
    const today = currentMonthKey();
    const grid = h('div', { class: 'month-grid' }, MONTHS_SHORT.map((name, i) => {
      const key = `${viewYear}-${pad2(i + 1)}`;
      return h('button', {
        type: 'button',
        class: key === today ? 'is-today' : null,
        aria: { current: key === month ? 'true' : null, label: formatMonth(key) },
        onClick: () => { closePopover(); onChange(key); label.focus(); },
      }, name);
    }));
    mount(popover,
      h('div', { class: 'row-between' },
        h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', aria: { label: 'Année précédente' }, onClick: () => { viewYear -= 1; renderPopover(); } }, icon('chevronLeft')),
        h('strong', { class: 'num' }, String(viewYear)),
        h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', aria: { label: 'Année suivante' }, onClick: () => { viewYear += 1; renderPopover(); } }, icon('chevronRight')),
      ),
      grid,
      h('div', { class: 'row-between', style: { marginTop: 'var(--space-2)' } },
        h('span', { class: 'subtle fs-13' }, 'Raccourcis : ← →'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { closePopover(); onChange(today); } }, 'Mois en cours'),
      ),
    );
    popover.querySelector('[aria-current="true"]')?.focus() ?? popover.querySelector('.month-grid button')?.focus();
  }

  label.addEventListener('click', () => {
    if (popover) { closePopover(); return; }
    viewYear = Number(month.slice(0, 4));
    popover = h('div', { class: 'popover', role: 'dialog', aria: { label: 'Choisir un mois' } });
    root.append(popover);
    label.setAttribute('aria-expanded', 'true');
    renderPopover();
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });

  return {
    update(newMonth) {
      month = newMonth;
      label.replaceChildren(
        h('span', { class: 'month-long' }, formatMonth(month)),
        h('span', { class: 'month-short' }, formatMonth(month, { short: true })));
      label.setAttribute('aria-label', `Mois affiché : ${formatMonth(month)}. Changer de mois`);
      if (popover) closePopover();
    },
  };
}
