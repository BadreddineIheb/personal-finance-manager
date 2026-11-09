/**
 * modal.js — Fenêtre modale accessible (panneau qui monte du bas sur mobile).
 * Focus piégé à l'intérieur, Échap ferme, le focus revient à l'élément d'origine.
 */
import { h, focusables } from '../dom.js';
import { icon } from '../icons.js';

let counter = 0;
const stack = [];

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {Node|Node[]} opts.body
 * @param {Node[]} [opts.footer]     boutons du pied
 * @param {boolean} [opts.wide]
 * @param {() => boolean|void} [opts.onRequestClose] retourner false empêche la fermeture
 * @param {HTMLElement} [opts.initialFocus]
 * @returns {{ close: () => void, root: HTMLElement, dialog: HTMLElement }}
 */
export function openModal({ title, body, footer = [], wide = false, onRequestClose, initialFocus, onClose }) {
  const id = `modal-title-${++counter}`;
  const previouslyFocused = document.activeElement;

  const closeBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', aria: { label: 'Fermer' } }, icon('x'));
  const dialog = h('div', { class: ['modal', wide && 'modal-wide'], role: 'dialog', aria: { modal: 'true', labelledby: id } },
    h('div', { class: 'modal-head' }, h('h2', { class: 'modal-title', id }, title), closeBtn),
    h('div', { class: 'modal-body' }, body),
    footer.length ? h('div', { class: 'modal-foot' }, footer) : null,
  );
  const root = h('div', { class: 'modal-root' }, dialog);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    stack.splice(stack.indexOf(api), 1);
    if (!stack.length) document.body.style.overflow = '';
    onClose?.();
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
  };
  const requestClose = () => { if (onRequestClose?.() !== false) close(); };

  function onKey(e) {
    if (stack[stack.length - 1] !== api) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); requestClose(); }
    if (e.key === 'Tab') {
      const items = focusables(dialog);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  closeBtn.addEventListener('click', requestClose);
  // Fermeture au clic sur le voile, uniquement si le clic commence et finit dessus
  let downOnRoot = false;
  root.addEventListener('pointerdown', (e) => { downOnRoot = e.target === root; });
  root.addEventListener('click', (e) => { if (e.target === root && downOnRoot) requestClose(); });
  document.addEventListener('keydown', onKey, true);

  const api = { close, root, dialog };
  stack.push(api);
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => (initialFocus ?? focusables(dialog.querySelector('.modal-body'))[0] ?? closeBtn).focus());
  return api;
}

/**
 * Demande de confirmation.
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const cancel = h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => m.close() }, cancelLabel);
    const ok = h('button', { class: ['btn', danger ? 'btn-danger' : 'btn-primary'], type: 'button', onClick: () => { result = true; m.close(); } }, confirmLabel);
    const m = openModal({
      title,
      body: h('p', { class: 'muted' }, message),
      footer: [cancel, ok],
      initialFocus: cancel,
      onClose: () => resolve(result),
    });
  });
}
