/**
 * global-search.js — Recherche globale dans toutes les transactions (barre supérieure).
 * Raccourcis : « / » ou Ctrl+K pour y accéder ; ↑ ↓ pour naviguer ; Entrée pour ouvrir.
 */
import { h, mount, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { listAllTransactions } from '../../data/repository.js';
import { filterTransactions, sortTransactions } from '../../domain/transactions.js';
import { on } from '../../core/events.js';
import { getCategories } from '../cache.js';
import { transactionRow } from './transaction-row.js';
import { openTransactionForm } from './transaction-form.js';

const MAX_RESULTS = 8;

export function createGlobalSearch(slot, { getMonth }) {
  const input = h('input', {
    class: 'input', type: 'search', placeholder: 'Rechercher une transaction…', autocomplete: 'off',
    aria: { label: 'Rechercher dans toutes les transactions', autocomplete: 'list', controls: 'search-results', expanded: 'false' },
    role: 'combobox',
  });
  const panel = h('div', { class: 'search-results', id: 'search-results', role: 'listbox', hidden: true });
  mount(slot, icon('search'), input, h('span', { class: 'kbd', aria: { hidden: 'true' } }, '/'), panel);

  let all = null; // chargé à la première recherche, invalidé à chaque modification
  let rows = [];
  let selected = -1;
  on('data:changed', ({ store }) => { if (store === 'transactions' || store === '*') all = null; });

  const close = () => { panel.hidden = true; input.setAttribute('aria-expanded', 'false'); selected = -1; };
  const select = (i) => {
    selected = i;
    rows.forEach((r, k) => r.setAttribute('aria-selected', String(k === i)));
    rows[i]?.scrollIntoView({ block: 'nearest' });
  };
  const open = (t) => { close(); input.blur(); openTransactionForm({ record: t, month: getMonth() }); };

  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    all ??= await listAllTransactions();
    const { byId } = await getCategories();
    const found = sortTransactions(filterTransactions(all, { query: q }, byId), 'date', 'desc');
    rows = found.slice(0, MAX_RESULTS).map((t) => {
      const r = transactionRow(t, { categories: byId, onOpen: open, actions: false });
      r.setAttribute('role', 'option');
      return r;
    });
    mount(panel,
      rows.length ? rows : h('div', { class: 'search-empty' }, `Aucune transaction ne contient « ${q} ».`),
      found.length > MAX_RESULTS ? h('div', { class: 'search-empty fs-13' }, `${found.length - MAX_RESULTS} autre(s) résultat(s) : précisez la recherche.`) : null,
    );
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    select(rows.length ? 0 : -1);
  }, 150);

  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); select((selected + 1) % rows.length); }
    else if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); select((selected - 1 + rows.length) % rows.length); }
    else if (e.key === 'Enter' && selected >= 0) { e.preventDefault(); rows[selected].click(); }
    else if (e.key === 'Escape') { if (!panel.hidden) { e.stopPropagation(); close(); } else input.blur(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!slot.contains(e.target)) close(); });

  return { focus: () => { input.focus(); input.select(); } };
}
