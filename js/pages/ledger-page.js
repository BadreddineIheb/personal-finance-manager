/**
 * ledger-page.js — Page de liste commune aux Revenus et aux Dépenses :
 * recherche, filtres (catégorie, type, période, montant), tri, regroupement par jour,
 * totaux par catégorie / type, plus grosses opérations.
 */
import { h, mount, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { listTransactionsByMonth, listTransactionsBetween, listRecurrences } from '../data/repository.js';
import { filterTransactions, sortTransactions, totalsByCategory, totalsByExpenseType, totalsByIncomeType, topTransactions, total } from '../domain/transactions.js';
import { formatMoney, parseAmount, distributePercents, sumCents } from '../core/money.js';
import { formatMonth, formatDate, monthBounds, isValidISODate } from '../core/dates.js';
import { EXPENSE_TYPES, INCOME_TYPES, categoryColor } from '../data/schema.js';
import { getCategories } from '../ui/cache.js';
import { transactionRow } from '../ui/components/transaction-row.js';
import { openTransactionForm } from '../ui/components/transaction-form.js';
import { pageHead, emptyState, breakdownRow } from '../ui/components/widgets.js';
import { openRecurrenceForm, recurrenceCard } from '../ui/components/recurrence-form.js';
import { monthlyEquivalentCents } from '../domain/recurrence.js';
import { href } from '../ui/router.js';

const SORT_OPTIONS = [
  ['date-desc', 'Plus récentes'], ['date-asc', 'Plus anciennes'],
  ['amount-desc', 'Montant décroissant'], ['amount-asc', 'Montant croissant'],
  ['label-asc', 'Nom (A → Z)'], ['label-desc', 'Nom (Z → A)'],
];

const freshFilters = () => ({ query: '', categoryId: '', types: [], incomeType: '', sort: 'date-desc', custom: false, from: '', to: '', min: '', max: '' });

/** Filtres conservés pendant la session, par type de page. */
const savedFilters = { expense: freshFilters(), income: freshFilters() };

/**
 * @param {'expense'|'income'} kind
 */
export function createLedgerPage(kind) {
  const isExpense = kind === 'expense';
  const words = isExpense
    ? { one: 'dépense', many: 'dépenses', add: 'Ajouter une dépense', none: 'Aucune dépense', theOne: 'la dépense' }
    : { one: 'revenu', many: 'revenus', add: 'Ajouter un revenu', none: 'Aucun revenu', theOne: 'le revenu' };

  const path = isExpense ? 'depenses' : 'revenus';
  const tabsFor = (current) => h('div', { class: 'tabs', role: 'tablist' },
    [['liste', isExpense ? 'Dépenses du mois' : 'Revenus du mois'], ['recurrents', isExpense ? 'Dépenses récurrentes' : 'Revenus récurrents']].map(([k, l]) => h('a', {
      role: 'tab', class: 'tab-link', href: href(path, k === 'liste' ? {} : { onglet: k }), aria: { selected: String(current === k) },
    }, l)));

  /** Onglet « Récurrents » : salaire, loyer, abonnements… */
  async function renderRecurrences(view) {
    const [{ byId }, all] = await Promise.all([getCategories(), listRecurrences()]);
    const list = all.filter((r) => r.kind === kind);
    const add = () => openRecurrenceForm({ kind });
    const activeList = list.filter((r) => r.active);
    const monthly = sumCents(activeList, monthlyEquivalentCents);
    mount(view,
      pageHead(isExpense ? 'Dépenses' : 'Revenus', list.length
        ? `${activeList.length} récurrence${activeList.length > 1 ? 's' : ''} active${activeList.length > 1 ? 's' : ''} · environ ${formatMoney(monthly)} par mois`
        : 'Opérations répétées automatiquement',
      h('button', { class: 'btn btn-primary', type: 'button', onClick: add }, icon('plus'), isExpense ? 'Dépense récurrente' : 'Revenu récurrent')),
      tabsFor('recurrents'),
      h('section', { class: 'card stack-sm' }, list.length
        ? [h('div', { class: 'tx-list' }, list.map((r) => recurrenceCard(r, { categories: byId }))),
          h('p', { class: 'subtle fs-13' }, 'Chaque échéance devient une opération réelle le jour venu (et à la prochaine ouverture de l\'application si elle était fermée). Supprimer une occurrence dans la liste du mois ne la recrée jamais.')]
        : emptyState({
          iconName: 'repeat',
          title: isExpense ? 'Aucune dépense récurrente' : 'Aucun revenu récurrent',
          body: isExpense
            ? 'Loyer, assurances, abonnements, forfait mobile… Ajoute-les une fois : ils seront enregistrés automatiquement à chaque échéance.'
            : 'Salaire, alternance, aide au logement… Ajoute-les une fois : ils seront enregistrés automatiquement à chaque échéance, et restent modifiables à tout moment.',
          actions: [h('button', { class: 'btn btn-primary', type: 'button', onClick: add }, icon('plus'), isExpense ? 'Ajouter une dépense récurrente' : 'Ajouter un revenu récurrent')],
        })));
  }

  return async function render(view, { month, params = {} }) {
    if (params.onglet === 'recurrents') { await renderRecurrences(view); return; }
    const f = savedFilters[kind];
    const { byId, active } = await getCategories();

    // Période chargée : le mois consulté, ou la période personnalisée si elle est valide.
    const customValid = f.custom && isValidISODate(f.from) && isValidISODate(f.to) && f.from <= f.to;
    const [from, to] = customValid ? [f.from, f.to] : monthBounds(month);
    const periodLabel = customValid ? `du ${formatDate(from)} au ${formatDate(to)}` : formatMonth(month);
    const loaded = (customValid ? await listTransactionsBetween(from, to) : await listTransactionsByMonth(month)).filter((t) => t.kind === kind);

    const add = () => openTransactionForm({ kind, month, lockKind: true });
    const subtitle = h('p', { class: 'page-sub' });
    const head = pageHead(isExpense ? 'Dépenses' : 'Revenus', null,
      h('button', { class: 'btn btn-primary', type: 'button', onClick: add }, icon('plus'), words.add));
    head.firstChild.append(subtitle);

    // ---------- Barre de filtres ----------
    const search = h('input', { class: 'input', type: 'search', placeholder: `Rechercher ${isExpense ? 'une dépense' : 'un revenu'}…`, value: f.query, aria: { label: 'Rechercher' } });
    search.addEventListener('input', debounce(() => { f.query = search.value; refresh(); }, 120));

    const sortSelect = h('select', { class: 'select', aria: { label: 'Trier' }, onChange: () => { f.sort = sortSelect.value; refresh(); } },
      SORT_OPTIONS.map(([v, l]) => h('option', { value: v, selected: v === f.sort }, l)));

    const categorySelect = isExpense
      ? h('select', { class: 'select', aria: { label: 'Catégorie' }, onChange: () => { f.categoryId = categorySelect.value; refresh(); } },
        h('option', { value: '' }, 'Toutes les catégories'),
        [...active, ...[...byId.values()].filter((c) => c.archived)].map((c) => h('option', { value: c.id, selected: c.id === f.categoryId }, c.archived ? `${c.name} (archivée)` : c.name)))
      : h('select', { class: 'select', aria: { label: 'Type de revenu' }, onChange: () => { f.incomeType = categorySelect.value; refresh(); } },
        h('option', { value: '' }, 'Tous les types'),
        Object.entries(INCOME_TYPES).map(([k, t]) => h('option', { value: k, selected: k === f.incomeType }, t.label)));

    const typeChips = isExpense ? Object.entries(EXPENSE_TYPES).map(([k, t]) => h('button', {
      class: 'chip', type: 'button', aria: { pressed: String(f.types.includes(k)) },
      onClick: (e) => {
        f.types = f.types.includes(k) ? f.types.filter((x) => x !== k) : [...f.types, k];
        e.currentTarget.setAttribute('aria-pressed', String(f.types.includes(k)));
        refresh();
      },
    }, h('span', { class: 'dot', style: { background: `var(--${t.color})` } }), t.label)) : [];

    // Période personnalisée et montants
    const periodSelect = h('select', { class: 'select', aria: { label: 'Période' } },
      h('option', { value: 'month', selected: !f.custom }, 'Mois affiché'),
      h('option', { value: 'custom', selected: f.custom }, 'Période personnalisée'));
    const fromInput = h('input', { class: 'input', type: 'date', value: f.from || from, aria: { label: 'Du' } });
    const toInput = h('input', { class: 'input', type: 'date', value: f.to || to, aria: { label: 'Au' } });
    const customBox = h('span', { class: 'row', hidden: !f.custom }, fromInput, h('span', { class: 'subtle' }, 'au'), toInput);
    const periodError = h('span', { class: 'field-error', hidden: true });
    const applyPeriod = () => {
      f.custom = periodSelect.value === 'custom';
      customBox.hidden = !f.custom;
      f.from = fromInput.value; f.to = toInput.value;
      const ok = isValidISODate(f.from) && isValidISODate(f.to) && f.from <= f.to;
      periodError.hidden = !f.custom || ok;
      periodError.textContent = 'La date de début doit précéder la date de fin.';
      if (!f.custom || ok) render(view, { month, params }); // nouvelle période : rechargement des données
    };
    periodSelect.addEventListener('change', applyPeriod);
    fromInput.addEventListener('change', applyPeriod);
    toInput.addEventListener('change', applyPeriod);

    const minInput = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Min €', value: f.min, aria: { label: 'Montant minimum' } });
    const maxInput = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Max €', value: f.max, aria: { label: 'Montant maximum' } });
    const amountError = h('span', { class: 'field-error', hidden: true });
    const onAmount = debounce(() => { f.min = minInput.value; f.max = maxInput.value; refresh(); }, 250);
    minInput.addEventListener('input', onAmount);
    maxInput.addEventListener('input', onAmount);

    const resetBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { savedFilters[kind] = freshFilters(); render(view, { month, params }); } }, icon('x', 'icon icon-sm'), 'Réinitialiser');

    const filtersBar = h('div', { class: 'stack-sm' },
      h('div', { class: 'filters' },
        h('div', { class: 'search-field' }, icon('search'), search),
        categorySelect, sortSelect),
      h('div', { class: 'filters' },
        typeChips,
        periodSelect, customBox,
        h('span', { class: 'row amount-range' }, minInput, h('span', { class: 'subtle' }, '–'), maxInput),
        resetBtn),
      periodError, amountError);

    // ---------- Zones dynamiques ----------
    const listHead = h('div', { class: 'row-between' });
    const list = h('div', { class: 'tx-list' });
    const side = h('div', { class: 'ledger-side' });
    const mainCard = h('section', { class: 'card stack' }, filtersBar, h('hr', { class: 'divider' }), listHead, list);

    mount(view, head, tabsFor('liste'), h('div', { class: 'ledger-layout' }, mainCard, side));

    const open = (t) => openTransactionForm({ record: t, month });
    const duplicate = (t) => openTransactionForm({ duplicateOf: t, month });

    function readAmountFilter(v) {
      if (!String(v).trim()) return { ok: true, cents: undefined };
      return parseAmount(v, { allowZero: true });
    }

    function refresh() {
      const minR = readAmountFilter(f.min);
      const maxR = readAmountFilter(f.max);
      amountError.hidden = minR.ok && maxR.ok;
      amountError.textContent = !minR.ok ? `Montant minimum : ${minR.error}` : !maxR.ok ? `Montant maximum : ${maxR.error}` : '';
      minInput.toggleAttribute('aria-invalid', !minR.ok);
      maxInput.toggleAttribute('aria-invalid', !maxR.ok);

      const [sortKey, dir] = f.sort.split('-');
      const filtered = sortTransactions(filterTransactions(loaded, {
        query: f.query,
        categoryIds: f.categoryId ? [f.categoryId] : [],
        expenseTypes: f.types,
        incomeTypes: f.incomeType ? [f.incomeType] : [],
        minCents: minR.ok ? minR.cents : undefined,
        maxCents: maxR.ok ? maxR.cents : undefined,
      }, byId), sortKey, dir);

      const isFiltered = Boolean(f.query || f.categoryId || f.types.length || f.incomeType || f.min || f.max);
      resetBtn.hidden = !isFiltered && !f.custom && f.sort === 'date-desc';
      const loadedTotal = total(loaded);
      subtitle.textContent = `${periodLabel} · ${loaded.length} ${loaded.length > 1 ? words.many : words.one} · ${formatMoney(loadedTotal)}`;

      mount(listHead,
        h('h2', { class: 'card-title' }, isFiltered ? 'Résultats' : (isExpense ? 'Toutes les dépenses' : 'Tous les revenus')),
        h('span', { class: 'result-count num' }, isFiltered
          ? `${filtered.length} sur ${loaded.length} · ${formatMoney(total(filtered))}`
          : `${filtered.length} · ${formatMoney(total(filtered))}`));

      // Liste : regroupée par jour quand on trie par date, sinon à plat avec la date.
      if (!loaded.length) {
        mount(list, emptyState({
          iconName: isExpense ? 'expense' : 'income',
          title: `${words.none} ${customValid ? 'sur cette période' : `en ${formatMonth(month)}`}`,
          body: isExpense
            ? 'Ajoute ta première dépense. Le type (fixe, variable, exceptionnelle) est prérempli selon la catégorie.'
            : 'Ajoute un revenu : salaire, alternance, aide, remboursement…',
          actions: [h('button', { class: 'btn btn-primary', type: 'button', onClick: add }, icon('plus'), words.add)],
        }));
      } else if (!filtered.length) {
        mount(list, emptyState({ iconName: 'search', title: 'Aucun résultat', body: 'Aucune opération ne correspond à ces filtres.',
          actions: [h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => resetBtn.click() }, 'Réinitialiser les filtres')] }));
      } else if (sortKey === 'date') {
        const groups = [];
        for (const t of filtered) {
          const last = groups[groups.length - 1];
          if (last?.date === t.date) last.items.push(t); else groups.push({ date: t.date, items: [t] });
        }
        mount(list, groups.map((g) => [
          h('div', { class: 'tx-day' }, h('span', {}, formatDate(g.date, 'long')), h('span', { class: 'num' }, formatMoney(total(g.items)))),
          g.items.map((t) => transactionRow(t, { categories: byId, onOpen: open, onDuplicate: duplicate, showDate: false })),
        ]));
      } else {
        mount(list, filtered.map((t) => transactionRow(t, { categories: byId, onOpen: open, onDuplicate: duplicate })));
      }

      renderSide();
    }

    function renderSide() {
      if (!loaded.length) { side.replaceChildren(); return; }
      const cards = [];
      if (isExpense) {
        const byType = totalsByExpenseType(loaded);
        cards.push(h('section', { class: 'card stack-sm' },
          h('h2', { class: 'card-title' }, 'Par type'),
          h('div', { class: 'type-totals' }, Object.entries(EXPENSE_TYPES).map(([k, t]) => h('div', { class: 'type-total' },
            h('span', { class: 'kpi-label' }, h('span', { class: 'swatch', style: { background: `var(--${t.color})` } }), t.label),
            h('span', { class: 'kpi-value' }, formatMoney(byType[k], { compact: true })))))));

        const rows = totalsByCategory(loaded);
        const max = rows[0]?.totalCents ?? 0;
        cards.push(h('section', { class: 'card stack-sm' },
          h('div', { class: 'row-between' }, h('h2', { class: 'card-title' }, 'Par catégorie'),
            f.categoryId ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { f.categoryId = ''; categorySelect.value = ''; refresh(); } }, 'Tout afficher') : null),
          h('p', { class: 'subtle fs-13' }, 'Clique sur une catégorie pour filtrer la liste.'),
          h('div', { class: 'breakdown' }, rows.map((r) => {
            const c = byId.get(r.categoryId);
            return breakdownRow({
              label: c?.name ?? 'Catégorie supprimée', color: categoryColor(c?.color), cents: r.totalCents, pct: r.percent, maxCents: max,
              pressed: f.categoryId === r.categoryId,
              onClick: () => { f.categoryId = f.categoryId === r.categoryId ? '' : r.categoryId; categorySelect.value = f.categoryId; refresh(); },
            });
          }))));
      } else {
        const byType = Object.entries(totalsByIncomeType(loaded)).sort((a, b) => b[1] - a[1]);
        const pcts = distributePercents(byType.map(([, v]) => v));
        const max = byType[0]?.[1] ?? 0;
        cards.push(h('section', { class: 'card stack-sm' },
          h('h2', { class: 'card-title' }, 'Par type de revenu'),
          h('div', { class: 'breakdown' }, byType.map(([k, v], i) => breakdownRow({
            label: INCOME_TYPES[k]?.label ?? k, color: 'var(--positive)', cents: v, pct: pcts[i], maxCents: max,
            pressed: f.incomeType === k,
            onClick: () => { f.incomeType = f.incomeType === k ? '' : k; categorySelect.value = f.incomeType; refresh(); },
          })))));
      }

      const top = topTransactions(loaded, 5);
      cards.push(h('section', { class: 'card stack-sm' },
        h('h2', { class: 'card-title' }, isExpense ? 'Plus grosses dépenses' : 'Plus gros revenus'),
        h('div', { class: 'list-plain' }, top.map((t) => h('div', { class: 'line' },
          h('a', { href: '#', class: 'ellipsis', style: { color: 'var(--ink)', textDecoration: 'none' }, onClick: (e) => { e.preventDefault(); open(t); } },
            t.label, h('span', { class: 'subtle fs-13' }, ` · ${formatDate(t.date, 'dayMonth')}`)),
          h('span', { class: 'num fw-600 nowrap' }, formatMoney(t.amountCents)))))));
      mount(side, cards);
    }

    refresh();
  };
}
