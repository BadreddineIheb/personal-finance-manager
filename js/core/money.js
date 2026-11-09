/**
 * money.js — Montants en centimes entiers.
 *
 * Règle d'or : aucun calcul financier n'utilise de nombre à virgule.
 * Un montant est toujours un entier (Number.isSafeInteger) exprimé en centimes.
 * La conversion en euros n'a lieu qu'à l'affichage.
 */

/** Plafond par défaut d'un montant saisi : 10 000 000,00 €. */
export const MAX_AMOUNT_CENTS = 1_000_000_000;

const MINUS = '−'; // vrai signe moins typographique
const NBSP = ' ';

/**
 * Convertit une saisie utilisateur en centimes.
 * Accepte : "12", "12,5", "12,50", "12.50", "1 234,56", "1234.56", "1.234,56", "1,234.56".
 * Refuse : vide, négatif, zéro (sauf allowZero), plus de 2 décimales, caractères parasites.
 *
 * @param {string|number} input
 * @param {{allowZero?: boolean, max?: number}} [opts]
 * @returns {{ok: true, cents: number} | {ok: false, error: string}}
 */
export function parseAmount(input, opts = {}) {
  const { allowZero = false, max = MAX_AMOUNT_CENTS } = opts;
  if (input === null || input === undefined) return { ok: false, error: 'Montant requis.' };

  // Un nombre JS n'est accepté que s'il a au plus 2 décimales représentables proprement.
  let raw = typeof input === 'number' ? String(input) : String(input);
  raw = raw.trim().replace(/[\s  ]/g, '').replace(/€$/, '');
  if (raw === '') return { ok: false, error: 'Montant requis.' };
  if (/^[-−]/.test(raw)) return { ok: false, error: 'Le montant doit être positif.' };
  if (!/^[\d.,]+$/.test(raw)) return { ok: false, error: 'Montant invalide : chiffres uniquement.' };

  // Identification du séparateur décimal : le dernier "," ou "." s'il est suivi de 1 à 2 chiffres
  // ou s'il n'y a qu'un seul type de séparateur.
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  let intPart = raw;
  let decPart = '';
  if (lastComma !== -1 || lastDot !== -1) {
    const sepIndex = Math.max(lastComma, lastDot);
    const sep = raw[sepIndex];
    const other = sep === ',' ? '.' : ',';
    const before = raw.slice(0, sepIndex);
    const after = raw.slice(sepIndex + 1);
    const sepCount = raw.split(sep).length - 1;

    if (sepCount > 1) {
      // "1.234.567" : le séparateur répété ne peut être que celui des milliers.
      if (!isThousandsGrouped(raw, sep)) return { ok: false, error: 'Montant invalide.' };
      intPart = raw.split(sep).join('');
    } else if (before.includes(other)) {
      // "1.234,56" ou "1,234.56" : l'autre séparateur groupe les milliers.
      if (!isThousandsGrouped(before, other)) return { ok: false, error: 'Montant invalide.' };
      intPart = before.split(other).join('');
      decPart = after;
    } else {
      intPart = before;
      decPart = after;
    }
  }

  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(decPart)) return { ok: false, error: 'Montant invalide.' };
  if (decPart.length > 2) return { ok: false, error: '2 décimales maximum.' };
  if (intPart.length > 12) return { ok: false, error: 'Montant trop élevé.' };

  const cents = Number(intPart) * 100 + Number((decPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return { ok: false, error: 'Montant trop élevé.' };
  if (cents === 0 && !allowZero) return { ok: false, error: 'Le montant doit être supérieur à 0.' };
  if (cents > max) return { ok: false, error: `Montant trop élevé (maximum ${formatMoney(max)}).` };
  return { ok: true, cents };
}

/** Vérifie que `s` est de la forme 1, 12, 123 puis des groupes de 3 chiffres séparés par `sep`. */
function isThousandsGrouped(s, sep) {
  const groups = s.split(sep);
  if (groups.length < 2) return true;
  if (!/^\d{1,3}$/.test(groups[0])) return false;
  return groups.slice(1).every((g) => /^\d{3}$/.test(g));
}

/** Vérifie qu'une valeur est un montant valide en centimes (entier sûr). */
export function isCents(value) {
  return Number.isSafeInteger(value);
}

/** Somme exacte d'une liste de centimes (ou d'objets via `pick`). */
export function sumCents(list, pick = (x) => x) {
  let total = 0;
  for (const item of list) {
    const v = pick(item);
    if (!Number.isSafeInteger(v)) throw new TypeError(`Montant non entier : ${v}`);
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError('Dépassement de capacité.');
  return total;
}

const eurFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formate des centimes en euros, format français : 1 234,56 €.
 * @param {number} cents
 * @param {{sign?: 'auto'|'always'|'never', compact?: boolean}} [opts]
 *   sign 'always' affiche "+" pour les positifs ; 'never' affiche la valeur absolue.
 *   compact supprime les centimes quand ils sont nuls (1 245 €).
 */
export function formatMoney(cents, opts = {}) {
  const { sign = 'auto', compact = false } = opts;
  if (!Number.isSafeInteger(cents)) return '—';
  const abs = Math.abs(cents);
  const euros = Math.trunc(abs / 100);
  const rest = abs % 100;
  // Construction exacte à partir des entiers (aucun arrondi flottant possible).
  let body;
  if (compact && rest === 0) {
    // Mêmes séparateurs que le format complet, sans la partie décimale (« 1 480 € »)
    body = eurFormatter.formatToParts(euros).filter((p) => p.type !== 'decimal' && p.type !== 'fraction').map((p) => p.value).join('');
  } else {
    body = eurFormatter.formatToParts(euros).map((p) => {
      if (p.type === 'fraction') return String(rest).padStart(2, '0');
      return p.value;
    }).join('');
  }
  if (sign === 'never' || cents === 0) return body;
  if (cents < 0) return MINUS + body;
  return sign === 'always' ? '+' + body : body;
}

/** Montant en euros pour un champ de saisie : 1234,5 → "1234,50" (pas de séparateur de milliers). */
export function centsToInput(cents) {
  if (!Number.isSafeInteger(cents)) return '';
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Pourcentage part/total arrondi à `decimals` décimales, calculé sur entiers.
 * Retourne null si le total est nul (affiché "—").
 */
export function percent(part, total, decimals = 1) {
  if (!Number.isSafeInteger(part) || !Number.isSafeInteger(total) || total === 0) return null;
  const factor = 10 ** decimals;
  // Arrondi "demi vers le haut" en valeur absolue, sur entiers.
  const num = part * 100 * factor;
  const q = Math.trunc(num / total);
  const r = Math.abs(num % total);
  const away = 2 * r >= Math.abs(total) ? 1 : 0;
  const sign = (num < 0) !== (total < 0) ? -1 : 1;
  return (Math.abs(q) + away) * sign / factor;
}

/**
 * Répartit 100 % entre des valeurs avec la méthode du plus fort reste,
 * de sorte que la somme des pourcentages affichés fasse exactement 100.
 * @param {number[]} values centimes (≥ 0)
 * @param {number} decimals
 * @returns {number[]} pourcentages (même ordre)
 */
export function distributePercents(values, decimals = 1) {
  const total = sumCents(values);
  if (total === 0) return values.map(() => 0);
  const unit = 100 * 10 ** decimals; // ex. 1000 dixièmes de pourcent
  const raw = values.map((v, i) => {
    const num = v * unit;
    return { i, floor: Math.floor(num / total), rem: num % total };
  });
  let remaining = unit - raw.reduce((s, x) => s + x.floor, 0);
  [...raw].sort((a, b) => b.rem - a.rem || a.i - b.i).forEach((x) => {
    if (remaining > 0) { x.floor += 1; remaining -= 1; }
  });
  return raw.map((x) => x.floor / 10 ** decimals);
}

/** Formate un pourcentage : 29.7 → "29,7 %", null → "—". */
export function formatPercent(value, decimals = 1, { sign = 'auto' } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const s = value < 0 ? MINUS : (sign === 'always' && value > 0 ? '+' : '');
  return `${s}${abs}${NBSP}%`;
}

/** Formate une différence de taux en points : -3.4 → "−3,4 pts". */
export function formatPoints(value) {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const s = value < 0 ? MINUS : value > 0 ? '+' : '';
  return `${s}${abs}${NBSP}pt${Math.abs(value) >= 2 ? 's' : ''}`;
}

/** Remplace les espaces insécables (fines ou non) par des espaces simples : requis pour jsPDF. */
export function toPlainSpaces(str) {
  return String(str).replace(/[  ]/g, ' ').replace(/−/g, '-');
}
