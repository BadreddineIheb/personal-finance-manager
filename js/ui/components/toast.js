/**
 * toast.js — Notifications éphémères, avec action optionnelle (ex. « Annuler »).
 * Un seul toast visible à la fois : le suivant remplace le précédent.
 */
import { h } from '../dom.js';

let active = null;

/**
 * @param {string} message
 * @param {{ action?: { label: string, onClick: () => void }, duration?: number }} [opts]
 */
export function toast(message, { action, duration } = {}) {
  const region = document.getElementById('toasts');
  if (!region) return;
  active?.dismiss();
  const ms = duration ?? (action ? 6000 : 4000);

  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, message));
  let timer;
  const dismiss = () => { clearTimeout(timer); el.remove(); if (active?.el === el) active = null; };
  if (action) {
    el.append(h('button', { class: 'btn', type: 'button', onClick: () => { dismiss(); action.onClick(); } }, action.label));
  }
  // La minuterie est suspendue au survol pour laisser le temps de cliquer.
  const start = () => { timer = setTimeout(dismiss, ms); };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', start);
  region.append(el);
  start();
  active = { el, dismiss };
  return active;
}
