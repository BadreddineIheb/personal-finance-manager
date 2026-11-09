/**
 * savings.js — Page Épargne.
 * Onglet Comptes : épargne totale, épargne réalisée du mois, intérêts, épargne libre, comptes,
 *                  mouvements du mois, évolution sur 12 mois.
 * Onglet Objectifs : progression de chaque objectif, effort mensuel nécessaire.
 */
import { h, mount, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { listSavingsAccounts, listAllMovements, listGoals, setSetting } from '../data/repository.js';
import {
  balancesAt, totalSavingsAt, summarizeMovements, savingsSeries, goalProgress, monthlyNeeded, freeSavings, ACCOUNT_TYPES,
} from '../domain/savings.js';
import { formatMoney, formatPercent, sumCents, parseAmount, centsToInput } from '../core/money.js';
import { formatMonth, addMonths, monthBounds, todayISO, formatDate, monthName } from '../core/dates.js';
import { pageHead, kpiCard, delta, emptyState } from '../ui/components/widgets.js';
import { openAccountForm, openMovementForm, openGoalForm, movementRow } from '../ui/components/savings-forms.js';
import { href } from '../ui/router.js';
import { lineChart } from '../ui/charts.js';
import { simulate, monthsToReach, formatDuration } from '../domain/simulator.js';
import { getCachedSettings } from '../ui/cache.js';

export async function render(view, { month, params }) {
  const tab = ['objectifs', 'simulateur'].includes(params.onglet) ? params.onglet : 'comptes';
  const [accounts, movements, goals] = await Promise.all([listSavingsAccounts(), listAllMovements(), listGoals()]);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const goalsById = new Map(goals.map((g) => [g.id, g]));
  const cleanups = [];
  const ctx = { month, accounts, movements, goals, accountsById, goalsById, cleanups };

  const head = pageHead('Épargne', formatMonth(month),
    h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => openAccountForm() }, icon('plus'), 'Compte'),
    tab === 'objectifs'
      ? h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openGoalForm() }, icon('plus'), 'Objectif')
      : h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openMovementForm({ month }) }, icon('plus'), 'Versement'));

  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    [['comptes', 'Comptes et mouvements'], ['objectifs', 'Objectifs'], ['simulateur', 'Simulateur']].map(([k, l]) => h('a', {
      role: 'tab', href: href('epargne', k === 'comptes' ? {} : { onglet: k }), class: 'tab-link',
      aria: { selected: String(tab === k) },
    }, l)));

  if (!accounts.length && tab === 'comptes') {
    mount(view, head, tabs, h('section', { class: 'card' }, emptyState({
      iconName: 'piggy',
      title: 'Aucun compte d\'épargne',
      body: 'Ajoute tes comptes (Livret A, LEP, assurance vie…) avec leur solde actuel. Tes versements seront ensuite déduits de ton solde disponible, sans être comptés comme des dépenses.',
      actions: [h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openAccountForm() }, icon('plus'), 'Créer un compte d\'épargne')],
    })));
    return;
  }

  const body = tab === 'objectifs' ? goalsTab(ctx) : tab === 'simulateur' ? simulatorTab(ctx, await getCachedSettings()) : accountsTab(ctx);
  mount(view, head, tabs, ...body);
  return () => cleanups.forEach((fn) => fn());
}

// ------------------------------------------------------------------ Comptes

function accountsTab({ month, accounts, movements, goals, accountsById, goalsById, cleanups }) {
  const end = monthBounds(month)[1];
  const prevEnd = monthBounds(addMonths(month, -1))[1];
  const total = totalSavingsAt(accounts, movements, end);
  const prevTotal = totalSavingsAt(accounts, movements, prevEnd);
  const hasPrev = accounts.some((a) => a.openingDate <= prevEnd);
  const inMonth = movements.filter((m) => m.month === month);
  const prevMonth = movements.filter((m) => m.month === addMonths(month, -1));
  const s = summarizeMovements(inMonth);
  const ps = summarizeMovements(prevMonth);
  const { freeCents, allocatedCents } = freeSavings(total, goals, movements.filter((m) => m.date <= end));
  const vs = `vs ${monthName(addMonths(month, -1), { short: true })}`;
  const withVs = (node) => (node.textContent === 'Pas de comparaison' ? [node] : [node, h('span', {}, vs)]);

  const kpis = h('div', { class: 'kpi-grid' },
    kpiCard({ label: 'Épargne totale', value: formatMoney(total), title: `Somme des soldes de tous les comptes au ${formatDate(end)}`,
      foot: withVs(delta(total, prevTotal, { better: 'up', hasPrevious: hasPrev })) }),
    kpiCard({ label: 'Épargne réalisée', value: formatMoney(s.net, { sign: s.net ? 'always' : 'auto' }), title: 'Versements − retraits du mois (hors transferts et intérêts)',
      foot: h('span', {}, `${formatMoney(s.deposits, { compact: true })} versés · ${formatMoney(s.withdrawals, { compact: true })} retirés`) }),
    kpiCard({ label: 'Intérêts perçus', value: formatMoney(s.interest), title: 'Intérêts crédités ce mois-ci',
      foot: withVs(delta(s.interest, ps.interest, { better: 'up', hasPrevious: true })) }),
    kpiCard({ label: 'Épargne libre', value: formatMoney(freeCents), title: 'Épargne non affectée à un objectif actif',
      foot: h('span', {}, `${formatMoney(allocatedCents, { compact: true })} affectés aux objectifs`) }));

  // Comptes
  const balances = balancesAt(accounts, movements, end);
  const card = (a) => {
    const net = sumCents(inMonth, (m) => (m.accountId === a.id ? (m.type === 'withdrawal' || m.type === 'transfer' ? -m.amountCents : m.amountCents) : m.toAccountId === a.id ? m.amountCents : 0));
    const share = total > 0 ? Math.round((balances.get(a.id) * 1000) / total) / 10 : null;
    return h('div', { class: ['card', 'account-card', a.archived && 'is-archived'], role: 'button', tabindex: '0',
      aria: { label: `${a.name} : ${formatMoney(balances.get(a.id))}. Modifier le compte` },
      onClick: (e) => { if (!e.target.closest('button')) openAccountForm({ account: a }); },
      onKeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openAccountForm({ account: a }); } },
    h('div', { class: 'row-between' },
      h('span', { class: 'row', style: { gap: '10px', minWidth: 0 } },
        h('span', { class: 'account-dot', style: { background: a.color ?? 'var(--accent)' } }),
        h('span', { class: 'stack-sm', style: { gap: '0', minWidth: 0 } }, h('strong', { class: 'ellipsis' }, a.name), (ACCOUNT_TYPES[a.type] ?? a.type) !== a.name ? h('span', { class: 'subtle fs-13' }, ACCOUNT_TYPES[a.type] ?? a.type) : null)),
      a.archived ? h('span', { class: 'badge' }, 'Archivé') : h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => openMovementForm({ accountId: a.id, month }) }, icon('plus', 'icon icon-sm'), 'Verser')),
    h('div', { class: 'kpi-value' }, formatMoney(balances.get(a.id))),
    h('div', { class: 'row-between fs-13' },
      h('span', { class: net > 0 ? 'pos' : net < 0 ? 'neg' : 'subtle' }, net ? `${formatMoney(net, { sign: 'always' })} ce mois-ci` : 'Aucun mouvement ce mois-ci'),
      share !== null ? h('span', { class: 'subtle' }, `${formatPercent(share)} du total`) : null));
  };
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
  const accountsSection = h('section', { class: 'stack-sm' },
    h('h2', { class: 'card-title' }, 'Comptes'),
    h('div', { class: 'account-grid' }, active.map(card)),
    archived.length ? h('details', { class: 'archived' }, h('summary', {}, `Comptes archivés (${archived.length})`), h('div', { class: 'account-grid' }, archived.map(card))) : null);

  // Mouvements du mois
  const open = (m) => openMovementForm({ movement: m, month });
  const sorted = [...inMonth].sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : (b.createdAt ?? '').localeCompare(a.createdAt ?? '')));
  const addBtn = (type, label) => h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => openMovementForm({ type, month }) }, label);
  const movementsCard = h('section', { class: 'card stack-sm' },
    h('div', { class: 'row-between wrap' }, h('h2', { class: 'card-title' }, `Mouvements de ${monthName(month)}`),
      h('div', { class: 'row', style: { gap: '2px' } }, addBtn('deposit', 'Versement'), addBtn('withdrawal', 'Retrait'), addBtn('transfer', 'Transfert'), addBtn('interest', 'Intérêts'))),
    sorted.length
      ? h('div', { class: 'tx-list' }, sorted.map((m) => movementRow(m, { accountsById, goalsById, onOpen: open })))
      : h('p', { class: 'subtle' }, 'Aucun mouvement ce mois-ci.'));

  // Évolution sur 12 mois
  // De l'ouverture du premier compte (au plus 12 mois) jusqu'au mois consulté
  const firstMonth = accounts.reduce((min, a) => (a.openingDate.slice(0, 7) < min ? a.openingDate.slice(0, 7) : min), month);
  const startMonth = firstMonth > addMonths(month, -11) ? firstMonth : addMonths(month, -11);
  const series = startMonth <= month ? savingsSeries(accounts, movements, startMonth, month) : [];
  const max = Math.max(1, ...series.map((x) => x.totalCents));
  const evolution = h('section', { class: 'card stack-sm' },
    h('h2', { class: 'card-title' }, series.length > 1 ? `Évolution sur ${series.length} mois` : 'Évolution'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Mois'), h('th', { class: 'right' }, 'Épargne réalisée'), h('th', { class: 'right' }, 'Intérêts'), h('th', { class: 'right' }, 'Total fin de mois'), h('th', { class: 'hide-mobile', style: { width: '30%' } }, ''))),
      h('tbody', {}, [...series].reverse().map((x) => h('tr', { class: x.month === month ? 'is-current' : null },
        h('td', { class: 'cap' }, formatMonth(x.month, { short: true })),
        h('td', { class: ['right', 'num', x.savedCents > 0 ? 'pos' : x.savedCents < 0 ? 'neg' : 'subtle'] }, x.savedCents ? formatMoney(x.savedCents, { sign: 'always' }) : '—'),
        h('td', { class: ['right', 'num', !x.interestCents && 'subtle'] }, x.interestCents ? formatMoney(x.interestCents) : '—'),
        h('td', { class: 'right num fw-600' }, formatMoney(x.totalCents)),
        h('td', { class: 'hide-mobile' }, h('div', { class: 'progress', aria: { hidden: 'true' } }, h('span', { style: { width: `${Math.round((x.totalCents / max) * 100)}%` } })))))))),
    null);
  if (series.length > 1) {
    const box = h('div', { class: 'chart chart-line', role: 'img', aria: { label: 'Évolution de l\'épargne totale' } });
    evolution.insertBefore(box, evolution.children[1]);
    const c = lineChart(box, { labels: series.map((x) => formatMonth(x.month, { short: true })), series: [{ label: 'Épargne totale', values: series.map((x) => x.totalCents), color: '--positive' }] });
    cleanups.push(() => c.destroy());
  }

  return [kpis, accountsSection, movementsCard, series.length ? evolution : null];
}

// ------------------------------------------------------------------ Objectifs

function goalsTab({ month, goals, movements }) {
  const today = todayISO();
  if (!goals.length) {
    return [h('section', { class: 'card' }, emptyState({
      iconName: 'piggy', title: 'Aucun objectif',
      body: 'Définis un objectif (réserve d\'urgence, voiture, voyage…) puis affecte-lui des versements : sa barre de progression avance automatiquement.',
      actions: [h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openGoalForm() }, icon('plus'), 'Créer un objectif')],
    }))];
  }
  const card = (g) => {
    const p = goalProgress(g, movements);
    const need = monthlyNeeded(g, p, today);
    const color = g.color ?? 'var(--accent)';
    let status;
    if (p.reached) status = h('span', { class: 'badge badge-pos' }, icon('check', 'icon icon-sm'), 'Objectif atteint');
    else if (need?.overdue) status = h('span', { class: 'badge badge-neg' }, `Échéance dépassée · reste ${formatMoney(p.remainingCents)}`);
    else if (need) status = h('span', { class: 'subtle fs-13' }, `${formatMoney(need.perMonthCents)}/mois pendant ${need.months} mois pour l'atteindre au ${formatDate(g.deadline)}`);
    else status = h('span', { class: 'subtle fs-13' }, `Reste ${formatMoney(p.remainingCents)} · sans échéance`);

    return h('div', { class: ['card', 'goal-card', g.archived && 'is-archived'], role: 'button', tabindex: '0',
      aria: { label: `${g.name} : ${formatPercent(p.percent)}. Modifier l'objectif` },
      onClick: (e) => { if (!e.target.closest('button')) openGoalForm({ goal: g }); },
      onKeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openGoalForm({ goal: g }); } },
    h('div', { class: 'row-between' }, h('strong', { class: 'ellipsis' }, g.name),
      g.archived ? h('span', { class: 'badge' }, 'Archivé') : !p.reached ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => openMovementForm({ goalId: g.id, month }) }, icon('plus', 'icon icon-sm'), 'Alimenter') : null),
    h('div', { class: 'row-between', style: { alignItems: 'baseline' } },
      h('span', { class: 'num' }, h('span', { class: 'kpi-value', style: { fontSize: '20px' } }, formatMoney(p.savedCents)), h('span', { class: 'subtle' }, ` / ${formatMoney(g.targetCents)}`)),
      h('strong', { class: 'num' }, formatPercent(p.percent))),
    h('div', { class: 'progress', role: 'progressbar', aria: { valuenow: String(Math.round(p.percent)), valuemin: '0', valuemax: '100', label: `Progression de ${g.name}` }, dataset: { state: p.reached ? 'ok' : 'goal' } },
      h('span', { style: { width: `${p.percent}%`, background: p.reached ? null : color } })),
    status);
  };
  const active = goals.filter((g) => !g.archived);
  const archived = goals.filter((g) => g.archived);
  return [
    h('div', { class: 'goal-grid' }, active.map(card)),
    archived.length ? h('details', { class: 'archived' }, h('summary', {}, `Objectifs archivés (${archived.length})`), h('div', { class: 'goal-grid' }, archived.map(card))) : null,
    h('p', { class: 'subtle fs-13' }, 'La progression d\'un objectif = versements et intérêts qui lui sont affectés − retraits affectés. Les transferts entre comptes ne la modifient pas.'),
  ];
}


// ------------------------------------------------------------------ Simulateur

const sim = { monthly: '', start: null, rate: null, target: '', goalId: '' };

function simulatorTab({ accounts, movements, goals, cleanups }, settings) {
  const today = todayISO();
  const totalNow = accounts.length ? totalSavingsAt(accounts, movements, today) : 0;
  sim.start ??= totalNow ? centsToInput(totalNow) : '';
  sim.rate ??= settings.simulatorDefaultRate ?? '';
  const activeGoals = goals.filter((g) => !g.archived);

  const input = (key, label, hint, placeholder = '0,00', suffix = 'amount') => {
    const el = h('input', { class: 'input', id: `sim-${key}`, inputmode: 'decimal', placeholder, value: sim[key] ?? '' });
    const refresh = debounce(update, 200);
    el.addEventListener('input', () => { sim[key] = el.value; refresh(); });
    // Le taux est mémorisé à la sortie du champ (pas pendant la frappe, pour ne pas redessiner la page).
    if (key === 'rate') el.addEventListener('change', () => persistRate(el.value));
    return h('div', { class: 'field' }, h('label', { class: 'field-label', for: `sim-${key}` }, label),
      suffix === 'amount' ? h('span', { class: 'amount' }, el) : h('span', { class: 'amount amount-pct' }, el), hint ? h('span', { class: 'field-hint' }, hint) : null);
  };
  const persistRate = (v) => {
    const r = String(v).trim() === '' ? { ok: true, cents: null } : parseAmount(v, { allowZero: true });
    sim.rate = v;
    if (r.ok && (r.cents === null ? null : v.trim()) !== settings.simulatorDefaultRate) setSetting('simulatorDefaultRate', r.cents === null ? null : v.trim());
  };
  const goalSelect = h('select', { class: 'select', id: 'sim-goal' }, h('option', { value: '' }, 'Montant libre'),
    activeGoals.map((g) => h('option', { value: g.id, selected: g.id === sim.goalId }, `${g.name} (${formatMoney(g.targetCents, { compact: true })})`)));
  goalSelect.addEventListener('change', () => {
    sim.goalId = goalSelect.value;
    const g = activeGoals.find((x) => x.id === sim.goalId);
    if (g) {
      // Objectif choisi : on part de ce qui lui est déjà affecté, pas de toute l'épargne
      sim.target = centsToInput(g.targetCents);
      sim.start = centsToInput(goalProgress(g, movements).savedCents);
      targetField.querySelector('input').value = sim.target;
      form.querySelector('#sim-start').value = sim.start;
    }
    update();
  });
  const targetField = input('target', 'Montant à atteindre', null);

  const form = h('section', { class: 'card stack' },
    h('h2', { class: 'card-title' }, 'Paramètres'),
    input('monthly', 'Épargne mensuelle', 'Montant que tu prévois de mettre de côté chaque mois.'),
    input('start', 'Épargne de départ', `Préremplie avec ton épargne totale (${formatMoney(totalNow)}), ou avec le montant déjà affecté à l'objectif choisi.`),
    input('rate', 'Taux annuel (%)', 'Facultatif. Ex. le taux de ton livret : saisis-le toi-même, il n\'est pas mis à jour automatiquement.', '0', 'pct'),
    h('hr', { class: 'divider' }),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'sim-goal' }, 'Objectif'), goalSelect),
    targetField);

  const results = h('div', { class: 'stack' });
  const chartBox = h('div', { class: 'chart chart-line' });
  let chart = null;
  cleanups.push(() => chart?.destroy());

  function read(v, { allowZero = true } = {}) {
    if (String(v ?? '').trim() === '') return { ok: true, cents: 0 };
    return parseAmount(v, { allowZero });
  }

  function update() {
    const monthly = read(sim.monthly);
    const start = read(sim.start);
    const rate = read(sim.rate);
    const target = read(sim.target);
    const errs = [[monthly, 'Épargne mensuelle'], [start, 'Épargne de départ'], [rate, 'Taux'], [target, 'Objectif']].filter(([r]) => !r.ok);
    if (rate.ok && rate.cents > 2000) errs.push([{ error: '20 % maximum.' }, 'Taux']);
    if (errs.length) { mount(results, h('div', { class: 'alert alert-error' }, icon('alert'), h('div', { class: 'alert-body' }, errs.map(([r, l]) => `${l} : ${r.error}`).join(' · ')))); return; }
    const p = { startCents: start.cents, monthlyCents: monthly.cents, rateBp: rate.cents };
    const series = simulate({ ...p, months: 24 });
    const at = (m) => series[m - 1];
    const horizon = [3, 6, 12, 24].map((m) => h('div', { class: 'card kpi' },
      h('span', { class: 'kpi-label' }, `Dans ${m} mois`),
      h('span', { class: 'kpi-value' }, formatMoney(at(m).balanceCents)),
      h('span', { class: 'kpi-foot' }, `+${formatMoney(at(m).depositedCents, { compact: true })} versés${at(m).interestCents ? ` · +${formatMoney(at(m).interestCents)} d'intérêts` : ''}`)));
    let goalBox = null;
    if (target.cents > 0) {
      const n = monthsToReach({ targetCents: target.cents, ...p });
      const d = new Date();
      const reachLabel = n && n > 0 ? formatMonth(addMonths(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, n)) : null;
      const g = activeGoals.find((x) => x.id === sim.goalId);
      const needed = g?.deadline ? Math.max(0, Math.ceil((target.cents - start.cents) / Math.max(1, (Number(g.deadline.slice(0, 4)) * 12 + Number(g.deadline.slice(5, 7))) - (d.getFullYear() * 12 + d.getMonth() + 1) + 1))) : null;
      goalBox = h('div', { class: ['alert', n === null ? 'alert-error' : 'alert-good'] }, icon(n === null ? 'alert' : 'check'), h('div', {},
        h('div', { class: 'alert-title' }, n === null ? 'Objectif jamais atteint avec ces paramètres' : n === 0 ? 'Objectif déjà atteint' : `Objectif atteignable en ${formatDuration(n)}`),
        h('div', { class: 'alert-body' }, n > 0 ? `Soit vers ${reachLabel}, pour ${formatMoney(target.cents)}.` : n === null ? 'Indique une épargne mensuelle supérieure à zéro.' : '',
          needed !== null && n !== 0 ? ` Pour tenir l'échéance du ${formatDate(g.deadline)} sans intérêts : ${formatMoney(needed)} par mois.` : '')));
    }
    mount(results, goalBox, h('div', { class: 'kpi-grid kpi-grid-2' }, horizon),
      h('section', { class: 'card stack-sm' }, h('h2', { class: 'card-title' }, 'Projection sur 24 mois'), chartBox,
        h('p', { class: 'subtle fs-13' }, 'Hypothèses : versement en fin de mois et intérêts capitalisés chaque mois (taux annuel / 12). Les livrets réglementés calculent par quinzaine et versent les intérêts une fois par an : le résultat réel peut légèrement différer.')));
    chart?.destroy();
    chart = lineChart(chartBox, {
      labels: ['Auj.', ...series.map((x) => `${x.month} m`)],
      series: [{ label: 'Épargne simulée', values: [start.cents, ...series.map((x) => x.balanceCents)], color: '--positive' },
        ...(target.cents > 0 ? [{ label: 'Objectif', values: Array(25).fill(target.cents), color: '--ink-3', dashed: true }] : [])],
    });
  }
  queueMicrotask(update);
  return [h('div', { class: 'ledger-layout' }, results, h('div', { class: 'ledger-side' }, form))];
}
