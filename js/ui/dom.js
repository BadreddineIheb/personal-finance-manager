/**
 * dom.js — Création d'éléments sûre.
 * Le texte saisi par l'utilisateur est toujours inséré comme nœud texte (jamais via innerHTML),
 * ce qui protège contre l'injection de HTML (XSS) par un nom de dépense ou un fichier importé.
 */

/**
 * h('button', { class: 'btn', onClick: fn, aria: { label: 'Fermer' }, dataset: { id } }, 'Texte', enfant…)
 * - class : chaîne ou tableau (les valeurs fausses sont ignorées)
 * - style : objet { prop: valeur } (variables CSS acceptées : { '--w': '40%' })
 * - on<Event> : écouteur d'événement
 * - aria / dataset : objets
 * - autres clés : attributs (false/null/undefined → absent, true → présent)
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key === 'style') {
      for (const [p, v] of Object.entries(value)) {
        if (v === undefined || v === null) continue;
        if (p.startsWith('--')) el.style.setProperty(p, v); else el.style[p] = v;
      }
    } else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'aria') for (const [a, v] of Object.entries(value)) { if (v !== undefined && v !== null && v !== false) el.setAttribute(`aria-${a}`, String(v)); }
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' && 'value' in el) el.value = value;
    else if (key === 'checked' || key === 'selected' || key === 'disabled') el[key] = Boolean(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

/** Ajoute des enfants (chaînes, nombres, nœuds, tableaux imbriqués ; null ignoré). */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Vide un élément puis y place de nouveaux enfants. */
export function mount(parent, ...children) {
  parent.replaceChildren();
  return append(parent, children);
}

/** Lie un écouteur et retourne la fonction de nettoyage. */
export function listen(target, event, fn, opts) {
  target.addEventListener(event, fn, opts);
  return () => target.removeEventListener(event, fn, opts);
}

/** Exécute fn au plus une fois toutes les `ms` millisecondes après la dernière frappe. */
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Éléments focusables à l'intérieur d'un conteneur (pour le piège à focus des modales). */
export function focusables(root) {
  return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}
