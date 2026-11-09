/**
 * router.js — Navigation par hash, compatible GitHub Pages (aucune configuration serveur).
 * Format : #/depenses?mois=2026-11
 * Le mois consulté fait partie de l'URL : précédent / suivant du navigateur et favoris fonctionnent.
 */
import { currentMonthKey, isValidMonthKey } from '../core/dates.js';

/** Sections de l'application, dans l'ordre de la sidebar. */
export const ROUTES = [
  { path: 'dashboard', label: 'Dashboard', title: 'Tableau de bord', icon: 'dashboard', load: () => import('../pages/dashboard.js') },
  { path: 'revenus', label: 'Revenus', title: 'Revenus', icon: 'income', load: () => import('../pages/incomes.js') },
  { path: 'depenses', label: 'Dépenses', title: 'Dépenses', icon: 'expense', load: () => import('../pages/expenses.js') },
  { path: 'epargne', label: 'Épargne', title: 'Épargne', icon: 'piggy', load: () => import('../pages/savings.js') },
  { path: 'budgets', label: 'Budgets', title: 'Budgets', icon: 'gauge', load: () => import('../pages/budgets.js') },
  { path: 'historique', label: 'Historique', title: 'Historique', icon: 'history', load: () => import('../pages/history.js') },
  { path: 'rapports', label: 'Rapports PDF', title: 'Rapports PDF', icon: 'file', load: () => import('../pages/reports.js') },
  { path: 'parametres', label: 'Paramètres', title: 'Paramètres', icon: 'settings', load: () => import('../pages/settings.js') },
];

const listeners = new Set();
let current = null;

/** Lit l'URL actuelle. */
export function parseLocation(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const route = ROUTES.find((r) => r.path === pathPart) ?? ROUTES[0];
  const params = Object.fromEntries(new URLSearchParams(queryPart));
  const month = isValidMonthKey(params.mois) ? params.mois : currentMonthKey();
  return { route, params, month };
}

/** Construit une URL interne en conservant le mois consulté. */
export function href(path, params = {}) {
  const month = params.mois ?? current?.month ?? currentMonthKey();
  const q = new URLSearchParams({ ...params, mois: month });
  return `#/${path}?${q.toString()}`;
}

export function navigate(path, params = {}) {
  location.hash = href(path, params);
}

/** Change le mois consulté sans changer de page. */
export function setMonth(month) {
  if (!current) return;
  const params = { ...current.params, mois: month };
  location.hash = `#/${current.route.path}?${new URLSearchParams(params).toString()}`;
}

export function getCurrent() {
  return current;
}

/** Abonnement aux changements de page ou de mois. */
export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startRouter() {
  const handle = () => {
    current = parseLocation();
    for (const fn of listeners) fn(current);
  };
  window.addEventListener('hashchange', handle);
  if (!location.hash) history.replaceState(null, '', href('dashboard', { mois: currentMonthKey() }));
  handle();
}
