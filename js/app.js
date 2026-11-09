/**
 * app.js — Point d'entrée : initialise les données, la coquille (navigation, thème, recherche)
 * et affiche la page demandée par l'URL. Chaque page est un module chargé à la demande.
 */
import { initRepository, setSetting, getSettings, generateDueOccurrences } from './data/repository.js';
import { on } from './core/events.js';
import { h, mount, debounce } from './ui/dom.js';
import { icon, hydrateIcons } from './ui/icons.js';
import { ROUTES, startRouter, onRouteChange, setMonth, href, getCurrent } from './ui/router.js';
import { createMonthPicker } from './ui/components/month-picker.js';
import { createGlobalSearch } from './ui/components/global-search.js';
import { openTransactionForm } from './ui/components/transaction-form.js';
import { openModal } from './ui/components/modal.js';
import { addMonths, todayISO } from './core/dates.js';
import { toast } from './ui/components/toast.js';
import { registerServiceWorker } from './pwa.js';

const view = document.getElementById('view');
let activePage = null; // { route, module, cleanup }
let renderToken = 0;

// ------------------------------------------------------------------ Thème

const media = window.matchMedia('(prefers-color-scheme: dark)');
let themePref = 'system';

/** Applique 'system' | 'light' | 'dark' et mémorise le choix (copie locale pour l'affichage sans flash). */
export function applyTheme(pref) {
  themePref = pref;
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  try { localStorage.setItem('pfm-theme', pref); } catch { /* stockage indisponible : sans conséquence */ }
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.replaceChildren(icon(dark ? 'sun' : 'moon'));
    btn.setAttribute('aria-label', dark ? 'Passer en thème clair' : 'Passer en thème sombre');
    btn.title = btn.getAttribute('aria-label');
  }
  window.dispatchEvent(new CustomEvent('pfm:theme', { detail: { dark } }));
}
media.addEventListener('change', () => { if (themePref === 'system') applyTheme('system'); });

// ------------------------------------------------------------------ Coquille

function renderNav(current) {
  const nav = document.getElementById('nav');
  mount(nav, ROUTES.map((r) => h('a', {
    class: 'nav-item', href: href(r.path), title: r.label,
    aria: { current: r.path === current.route.path ? 'page' : null },
  }, icon(r.icon), h('span', { class: 'nav-label' }, r.label))));

  const tabbar = document.getElementById('tabbar');
  const tab = (path, label, iconName) => h('a', { class: 'tab', href: href(path), aria: { current: current.route.path === path ? 'page' : null } }, icon(iconName), label);
  const inMore = !['dashboard', 'depenses', 'epargne'].includes(current.route.path);
  mount(tabbar,
    tab('dashboard', 'Accueil', 'dashboard'),
    tab('depenses', 'Dépenses', 'expense'),
    h('div', { class: 'tab tab-add' }, h('button', { class: 'fab', type: 'button', aria: { label: 'Ajouter une transaction' }, onClick: quickAdd }, icon('plus'))),
    tab('epargne', 'Épargne', 'piggy'),
    h('button', { class: 'tab', type: 'button', aria: { current: inMore ? 'page' : null, haspopup: 'dialog' }, onClick: openMoreMenu }, icon('more'), 'Plus'),
  );
}

function openMoreMenu() {
  const current = getCurrent();
  const items = ROUTES.filter((r) => !['dashboard', 'depenses', 'epargne'].includes(r.path));
  const m = openModal({
    title: 'Toutes les sections',
    body: h('nav', { class: 'more-menu' }, items.map((r) => h('a', {
      href: href(r.path), aria: { current: current.route.path === r.path ? 'page' : null }, onClick: () => m.close(),
    }, icon(r.icon), r.label))),
  });
}

function quickAdd() {
  const path = getCurrent()?.route.path;
  openTransactionForm({ kind: path === 'revenus' ? 'income' : 'expense', month: getCurrent()?.month });
}

// ------------------------------------------------------------------ Pages

async function renderPage({ preserveScroll = false } = {}) {
  const current = getCurrent();
  const token = ++renderToken;
  const scrollY = window.scrollY;
  try {
    const module = await current.route.load();
    if (token !== renderToken) return; // une navigation plus récente a eu lieu
    const changedRoute = activePage?.route !== current.route;
    activePage?.cleanup?.();
    document.title = `${current.route.title} · Mes finances`;
    const cleanup = await module.render(view, { ...current, navigate: (p, params) => { location.hash = href(p, params); } });
    if (token !== renderToken) return;
    activePage = { route: current.route, module, cleanup: typeof cleanup === 'function' ? cleanup : null };
    if (preserveScroll) window.scrollTo(0, scrollY);
    else if (changedRoute) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
  } catch (err) {
    console.error(err);
    mount(view, h('div', { class: 'alert alert-error', role: 'alert' }, icon('alert'),
      h('div', {}, h('div', { class: 'alert-title' }, 'Cette page n\'a pas pu s\'afficher.'), h('div', { class: 'alert-body' }, err.message))));
  }
}

// ------------------------------------------------------------------ Raccourcis clavier

function isTyping(e) {
  const t = e.target;
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

function bindShortcuts(search) {
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-root')) return;
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !isTyping(e))) { e.preventDefault(); search.focus(); return; }
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); quickAdd(); }
    const month = getCurrent()?.month;
    if (e.key === 'ArrowLeft' && month && !e.target.closest?.('.month-grid')) setMonth(addMonths(month, -1));
    if (e.key === 'ArrowRight' && month && !e.target.closest?.('.month-grid')) setMonth(addMonths(month, 1));
  });
}

// ------------------------------------------------------------------ Récurrences

/**
 * Crée les occurrences échues des opérations récurrentes. Lancé au démarrage, au retour
 * sur l'application (onglet réactivé) et toutes les heures (passage à minuit).
 */
async function runRecurrences({ notify = true } = {}) {
  try {
    const n = await generateDueOccurrences(todayISO());
    if (n && notify) toast(`${n} opération${n > 1 ? 's' : ''} récurrente${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} automatiquement`);
  } catch (err) {
    console.error('[récurrences]', err);
    toast('Les opérations récurrentes n\'ont pas pu être générées.');
  }
}

// ------------------------------------------------------------------ Démarrage

async function boot() {
  hydrateIcons();
  const addButton = document.getElementById('add-button');
  addButton.replaceChildren(icon('plus'), 'Ajouter');
  addButton.title = 'Ajouter une transaction (N)';
  addButton.addEventListener('click', quickAdd);

  await initRepository();
  await runRecurrences();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') runRecurrences(); });
  setInterval(runRecurrences, 60 * 60 * 1000);
  const settings = await getSettings();
  applyTheme(settings.theme);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    setSetting('theme', dark ? 'light' : 'dark');
  });
  on('data:changed', ({ store, key }) => {
    if ((store === 'settings' && key === 'theme') || store === '*') getSettings().then((s) => applyTheme(s.theme));
  });
  document.addEventListener('pfm:rerender', () => renderPage({ preserveScroll: true }));

  // Demande au navigateur de ne pas effacer les données en cas de manque d'espace.
  navigator.storage?.persist?.().catch(() => {});

  const picker = createMonthPicker(document.getElementById('month-picker-slot'), { onChange: setMonth });
  const search = createGlobalSearch(document.getElementById('search-slot'), { getMonth: () => getCurrent()?.month });
  bindShortcuts(search);

  onRouteChange((current) => {
    picker.update(current.month);
    renderNav(current);
    renderPage();
  });
  // Toute modification des données redessine la page affichée (sans perdre le défilement).
  on('data:changed', debounce(() => renderPage({ preserveScroll: true }), 30));
  startRouter();
  registerServiceWorker();
}

boot().catch((err) => {
  console.error(err);
  mount(view, h('div', { class: 'fatal card stack' },
    h('div', { class: 'alert alert-error', role: 'alert' }, icon('alert'), h('div', {},
      h('div', { class: 'alert-title' }, 'Impossible de démarrer l\'application'),
      h('div', { class: 'alert-body' }, err.message))),
    h('p', { class: 'muted fs-13' }, 'Les données sont stockées dans le navigateur (IndexedDB). La navigation privée ou certains réglages de confidentialité peuvent bloquer ce stockage.'),
  ));
});
