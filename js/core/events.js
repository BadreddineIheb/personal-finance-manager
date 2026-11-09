/**
 * events.js — Bus d'événements minimal.
 * Les écrans s'abonnent à 'data:changed' pour se redessiner après toute modification.
 */
const listeners = new Map();

/** S'abonne ; retourne une fonction de désabonnement. */
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  for (const fn of [...(listeners.get(event) ?? [])]) {
    try { fn(payload); } catch (err) { console.error(`[events] ${event}`, err); }
  }
}
