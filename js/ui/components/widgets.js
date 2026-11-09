/**
 * widgets.js — Petits composants d'affichage partagés par les pages :
 * en-tête de page, carte KPI avec variation, état vide, barre de répartition.
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { formatMoney, formatPercent, formatPoints } from '../../core/money.js';
import { variation, variationTone } from '../../domain/ledger.js';

export function pageHead(title, subtitle, ...actions) {
  return h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, title), subtitle ? h('p', { class: 'page-sub' }, subtitle) : null),
    actions.length ? h('div', { class: 'row wrap' }, actions) : null);
}

/**
 * Élément « variation vs mois précédent ».
 * @param {'money'|'rate'} kind  'rate' : variation en points de pourcentage
 * @param {'up'|'down'} better   sens favorable
 */
export function delta(current, previous, { kind = 'money', better = 'up', hasPrevious = true } = {}) {
  if (!hasPrevious || current === null || previous === null) return h('span', { class: 'delta flat' }, 'Pas de comparaison');
  if (kind === 'rate') {
    const diff = Math.round((current - previous) * 10) / 10;
    if (diff === 0) return h('span', { class: 'delta flat' }, 'Stable');
    const tone = Math.abs(diff) < 0.5 ? 'flat' : variationTone(diff, better);
    return h('span', { class: ['delta', tone] }, icon(diff > 0 ? 'arrowUp' : 'arrowDown'), formatPoints(diff));
  }
  const v = variation(current, previous);
  if (v.diff === 0) return h('span', { class: 'delta flat' }, 'Stable');
  const tone = variationTone(v.diff, better, v.pct);
  const text = v.pct === null ? formatMoney(v.diff, { sign: 'always', compact: true }) : formatPercent(v.pct, 1, { sign: 'always' });
  return h('span', { class: ['delta', tone], title: `Écart : ${formatMoney(v.diff, { sign: 'always' })}` },
    icon(v.diff > 0 ? 'arrowUp' : 'arrowDown'), text);
}

/**
 * Carte KPI.
 * @param {object} o
 * @param {string} o.label
 * @param {string|Node} o.value  valeur déjà formatée
 * @param {Node} [o.foot]
 * @param {string} [o.swatch]    couleur CSS de la pastille
 * @param {boolean} [o.small]
 * @param {string} [o.title]     explication au survol
 */
export function kpiCard({ label, value, foot, swatch, small = false, title }) {
  return h('div', { class: ['card', 'kpi', small && 'kpi-sm'], title },
    h('span', { class: 'kpi-label' }, swatch ? h('span', { class: 'swatch', style: { background: swatch } }) : null, label),
    h('span', { class: 'kpi-value' }, value),
    foot ? h('span', { class: 'kpi-foot' }, foot) : null);
}

export function emptyState({ iconName = 'wallet', title, body, actions = [] }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName)),
    h('div', { class: 'empty-title' }, title),
    body ? h('div', { class: 'empty-body' }, body) : null,
    actions.length ? h('div', { class: 'row wrap', style: { justifyContent: 'center' } }, actions) : null);
}

/**
 * Ligne de répartition (catégorie ou type) : libellé, montant, pourcentage, barre.
 * Si onClick est fourni, la ligne devient un bouton de filtre.
 */
export function breakdownRow({ label, color, cents, pct, pressed = false, onClick, maxCents }) {
  const width = maxCents > 0 ? Math.max(2, Math.round((cents / maxCents) * 100)) : 0;
  const tag = onClick ? 'button' : 'div';
  return h(tag, { class: 'breakdown-row', type: onClick ? 'button' : null, onClick, aria: { pressed: onClick ? String(pressed) : null } },
    h('span', { class: 'cat ellipsis' }, h('i', { style: { background: color } }), label),
    h('span', { class: 'amount-col' }, formatMoney(cents), h('span', { class: 'pct' }, formatPercent(pct))),
    h('div', { class: 'progress', aria: { hidden: 'true' } }, h('span', { style: { width: `${width}%`, background: color } })));
}
