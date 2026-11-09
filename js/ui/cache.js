/**
 * cache.js — Cache en mémoire des données de référence lues très souvent (catégories, paramètres).
 * Invalidé automatiquement dès qu'une modification est signalée sur le bus d'événements.
 */
import { listCategories, getSettings } from '../data/repository.js';
import { on } from '../core/events.js';

let categoriesPromise = null;
let settingsPromise = null;

on('data:changed', ({ store }) => {
  if (store === 'categories' || store === '*') categoriesPromise = null;
  if (store === 'settings' || store === '*') settingsPromise = null;
});

/** @returns {Promise<{ list: object[], active: object[], byId: Map<string, object> }>} */
export function getCategories() {
  categoriesPromise ??= listCategories().then((list) => ({
    list,
    active: list.filter((c) => !c.archived),
    byId: new Map(list.map((c) => [c.id, c])),
  }));
  return categoriesPromise;
}

export function getCachedSettings() {
  settingsPromise ??= getSettings();
  return settingsPromise;
}
