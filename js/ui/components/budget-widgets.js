/**
 * budget-widgets.js — Formulaire des budgets, ligne de budget, bandeau d'alertes
 * et carte d'estimation de fin de mois (partagés par la page Budgets et le tableau de bord).
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { parseAmount, centsToInput, formatMoney, formatPercent, sumCents } from '../../core/money.js';
import { formatMonth, formatDate, monthName, monthBounds } from '../../core/dates.js';
import { categoryColor } from '../../data/schema.js';
import { setBudgets, clearMonthBudgets, listBudgets } from '../../data/repository.js';
import { resolveBudgets } from '../../domain/budgets.js';
import { getCategories } from '../cache.js';

const STATE_LABEL = { ok: null, warn: 'Attention', reached: 'Atteint', over: 'Dépassé' };
const STATE_PROGRESS = { ok: 'ok', warn: 'warn', reached: 'over', over: 'over' };

/** Badge d'état d'un budget. */
export function budgetBadge(st) {
  if (st.state === 'ok') return h('span', { class: 'subtle num fs-13' }, formatPercent(st.percent));
  if (st.state === 'over') return h('span', { class: 'badge badge-neg num' }, `${formatPercent(st.percent)} · +${formatMoney(-st.remainingCents)}`);
  return h('span', { class: ['badge', st.state === 'warn' ? 'badge-warn' : 'badge-neg', 'num'] }, `${formatPercent(st.percent)} · ${STATE_LABEL[st.state]}`);
}

/** Ligne de budget : libellé, dépensé / budget, barre colorée selon l'état, reste. */
export function budgetLine({ label, color, st, compact = false, source }) {
  const width = Math.min(100, st.percent);
  return h('div', { class: 'budget-line' },
    h('span', { class: 'cat ellipsis' }, color ? h('i', { style: { background: color } }) : null, label,
      source === 'month' && !compact ? h('span', { class: 'badge', style: { marginLeft: '6px' }, title: 'Budget propre à ce mois' }, 'Ce mois') : null),
    budgetBadge(st),
    h('div', { class: 'progress', dataset: { state: STATE_PROGRESS[st.state] }, role: 'progressbar',
      aria: { valuenow: String(Math.round(st.percent)), valuemin: '0', valuemax: '100', label: `${label} : ${formatPercent(st.percent)} du budget` } },
    h('span', { style: { width: `${width}%` } })),
    compact ? null : h('span', { class: 'subtle fs-13 num', style: { gridColumn: '1 / -1' } },
      `${formatMoney(st.spentCents)} sur ${formatMoney(st.budgetCents)} · `,
      st.remainingCents >= 0 ? `reste ${formatMoney(st.remainingCents)}` : h('span', { class: 'neg' }, `dépassement de ${formatMoney(-st.remainingCents)}`)));
}

/** Bandeau d'alertes de budget (80 % / 100 % / dépassement). */
export function budgetAlerts(overview, categoriesById, { link } = {}) {
  if (!overview.alerts.length) return null;
  const over = overview.alerts.filter((a) => a.state !== 'warn');
  const names = overview.alerts.map((a) => (a.categoryId ? categoriesById.get(a.categoryId)?.name ?? '?' : 'Budget global'));
  return h('div', { class: ['alert', over.length ? 'alert-error' : 'alert-warn'], role: 'status' }, icon('alert'),
    h('div', {},
      h('div', { class: 'alert-title' }, over.length
        ? `${over.length} budget${over.length > 1 ? 's' : ''} atteint${over.length > 1 ? 's' : ''} ou dépassé${over.length > 1 ? 's' : ''}`
        : `${overview.alerts.length} budget${overview.alerts.length > 1 ? 's' : ''} à plus de 80 %`),
      h('div', { class: 'alert-body' }, names.join(' · '))),
    link ? h('div', { class: 'alert-actions' }, h('a', { class: 'btn btn-secondary btn-sm', href: link }, 'Voir les budgets')) : null);
}

/** Carte « Estimation fin de mois », avec le détail du calcul. */
export function forecastCard(f, { month, title = 'Estimation fin de mois' } = {}) {
  const range = f.high === f.low ? formatMoney(f.high) : `${formatMoney(f.low, { compact: true })} à ${formatMoney(f.high, { compact: true })}`;
  const line = (label, value, tone) => h('div', { class: 'line' }, h('span', { class: 'muted' }, label), h('span', { class: ['num', 'nowrap', tone] }, value));
  const intro = {
    final: `Résultat réel de ${formatMonth(month)} (revenus − dépenses).`,
    current: `Ce qui pourrait te rester (épargne possible) au ${formatDate(monthBounds(month)[1])}, selon tes opérations, tes échéances à venir et le rythme actuel de tes dépenses variables.`,
    future: `Prévision pour ${formatMonth(month)} d'après tes opérations récurrentes et la moyenne de tes dépenses variables.`,
  }[f.mode];
  return h('section', { class: 'card stack-sm' },
    h('h2', { class: 'card-title' }, title),
    h('div', { class: ['kpi-value', f.low < 0 ? 'neg' : null] }, range),
    h('p', { class: 'muted fs-13' }, intro),
    f.mode === 'final' ? null : h('div', { class: 'list-plain fs-13' },
      line('Revenus enregistrés', formatMoney(f.income, { sign: 'always' }), 'pos'),
      line('Revenus récurrents à venir', formatMoney(f.upcomingIncome, { sign: 'always' }), f.upcomingIncome ? 'pos' : null),
      line('Dépenses enregistrées', formatMoney(-f.expenses)),
      line('Échéances à venir', formatMoney(-f.upcomingExpenses)),
      h('hr', { class: 'divider' }),
      line('Estimation haute', formatMoney(f.high, { sign: 'always' }), null),
      line(f.mode === 'current' ? `Variables projetées (${f.daysRemaining} j restants)` : 'Variables (moyenne 3 mois)', formatMoney(-f.projectedVariable)),
      line('Estimation prudente', formatMoney(f.low, { sign: 'always' }), f.low >= 0 ? 'pos' : 'neg')),
    f.mode === 'current' && f.daysElapsed ? h('p', { class: 'subtle fs-13' }, `Projection : ${formatMoney(f.variableDone)} de dépenses variables en ${f.daysElapsed} jour${f.daysElapsed > 1 ? 's' : ''}, prolongées sur les ${f.daysRemaining} jours restants.`) : null);
}

// ------------------------------------------------------------------ Formulaire

/**
 * Formulaire de définition des budgets.
 * Portée : « tous les mois » (budgets par défaut) ou « uniquement <mois> ».
 */
export async function openBudgetForm({ month, scope = 'default' } = {}) {
  const [{ active, byId }, budgets] = await Promise.all([getCategories(), listBudgets()]);
  let currentScope = scope;

  const inputs = new Map();
  const globalInput = h('input', { class: 'input', id: 'b-global', inputmode: 'decimal', placeholder: 'Aucun' });
  const total = h('p', { class: 'field-hint' });
  const error = h('div', { class: 'alert alert-error', role: 'alert', hidden: true }, icon('alert'), h('div', { class: 'alert-body' }));
  const rows = active.map((c) => {
    const input = h('input', { class: 'input input-sm right', inputmode: 'decimal', placeholder: '—', aria: { label: `Budget ${c.name}` } });
    inputs.set(c.id, input);
    input.addEventListener('input', updateTotal);
    return h('div', { class: 'budget-input-row' }, h('span', { class: 'cat ellipsis' }, h('i', { style: { background: categoryColor(c.color) } }), c.name), h('span', { class: 'amount amount-sm' }, input));
  });
  globalInput.addEventListener('input', updateTotal);

  /** Préremplit avec les budgets de la portée (ou, pour un mois sans budget propre, ceux par défaut). */
  function fill() {
    const own = budgets.filter((b) => (currentScope === 'default' ? !b.month : b.month === month));
    const source = currentScope === 'month' && !own.length ? resolveBudgets(budgets, month) : null;
    const g = source ? source.global?.amountCents : own.find((b) => b.scope === 'global')?.amountCents;
    globalInput.value = g ? centsToInput(g) : '';
    for (const [id, input] of inputs) {
      const v = source ? source.categories.get(id)?.amountCents : own.find((b) => b.scope === 'category' && b.categoryId === id)?.amountCents;
      input.value = v ? centsToInput(v) : '';
    }
    updateTotal();
  }

  function read() {
    const errors = [];
    const parse = (v, label) => {
      if (!String(v).trim()) return null;
      const r = parseAmount(v);
      if (!r.ok) { errors.push(`${label} : ${r.error}`); return null; }
      return r.cents;
    };
    const globalCents = parse(globalInput.value, 'Budget global');
    const categories = {};
    for (const [id, input] of inputs) {
      categories[id] = parse(input.value, byId.get(id).name);
      input.toggleAttribute('aria-invalid', Boolean(String(input.value).trim()) && categories[id] === null);
    }
    return { globalCents, categories, errors };
  }

  function updateTotal() {
    const { globalCents, categories } = read();
    const sum = sumCents(Object.values(categories).filter(Boolean));
    total.replaceChildren(`Somme des budgets par catégorie : ${formatMoney(sum)}`,
      globalCents && sum > globalCents ? h('span', { class: 'neg' }, ` — supérieure au budget global (${formatMoney(globalCents)}).`) : '');
  }

  const scopeSeg = h('div', { class: 'seg seg-block', role: 'group', aria: { label: 'Portée des budgets' } },
    [['default', 'Tous les mois'], ['month', `Uniquement ${formatMonth(month)}`]].map(([k, l]) => h('button', {
      type: 'button', dataset: { scope: k }, aria: { pressed: String(k === currentScope) },
      onClick: () => { currentScope = k; for (const b of scopeSeg.children) b.setAttribute('aria-pressed', String(b.dataset.scope === k)); fill(); scopeHint(); },
    }, l)));
  const hint = h('p', { class: 'field-hint' });
  const scopeHint = () => {
    hint.textContent = currentScope === 'default'
      ? 'Budgets appliqués à chaque mois, sauf aux mois qui ont leurs propres budgets.'
      : `Budgets propres à ${formatMonth(month)} (ex. décembre et ses cadeaux) : ils remplacent les budgets par défaut pour ce mois seulement.`;
  };

  const form = h('form', { class: 'stack', novalidate: true },
    scopeSeg, hint, error,
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'b-global' }, 'Budget global mensuel'), h('span', { class: 'amount' }, globalInput),
      h('span', { class: 'field-hint' }, 'Toutes les dépenses du mois, exceptionnelles comprises. Laisser vide pour ne pas en définir.')),
    h('div', { class: 'stack-sm' }, h('span', { class: 'field-label' }, 'Budgets par catégorie'), h('div', { class: 'budget-inputs' }, rows), total),
    h('button', { type: 'submit', hidden: true, tabindex: '-1' }));

  return new Promise((resolve) => {
    let saved = false;
    const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Enregistrer');
    const submit = async () => {
      const { globalCents, categories, errors } = read();
      const box = error.querySelector('.alert-body');
      if (errors.length) { box.textContent = errors.join(' · '); error.hidden = false; return; }
      save.disabled = true;
      await setBudgets(currentScope === 'default' ? null : month, { globalCents, categories });
      saved = true;
      m.close();
      toast(currentScope === 'default' ? 'Budgets enregistrés pour tous les mois' : `Budgets de ${formatMonth(month)} enregistrés`);
    };
    save.addEventListener('click', submit);
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    const hasMonthBudgets = budgets.some((b) => b.month === month);
    const footer = [
      hasMonthBudgets ? h('button', { class: 'btn btn-ghost spacer', type: 'button', onClick: async () => {
        if (!(await confirmDialog({ title: `Revenir aux budgets par défaut pour ${monthName(month)} ?`, message: 'Les budgets propres à ce mois seront supprimés.', confirmLabel: 'Revenir aux budgets par défaut' }))) return;
        await clearMonthBudgets(month); m.close(); toast('Budgets par défaut rétablis pour ce mois');
      } }, `Réinitialiser ${monthName(month)}`) : null,
      h('button', { class: 'btn btn-secondary hide-mobile', type: 'button', onClick: () => m.close() }, 'Annuler'), save,
    ].filter(Boolean);
    const m = openModal({ title: 'Définir les budgets', body: form, footer, wide: true, initialFocus: globalInput, onClose: () => resolve(saved) });
    fill(); scopeHint();
  });
}

