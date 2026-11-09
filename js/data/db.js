/**
 * db.js — Wrapper IndexedDB à base de promesses.
 * Expose des opérations simples (get, getAll, put, delete, byIndex) et des transactions
 * multi-tables atomiques via `transaction()`.
 */
import { DB_NAME, DB_VERSION, STORES } from './schema.js';

let dbPromise = null;

/** Transforme une IDBRequest en promesse. */
export function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Ouvre (ou crée) la base. Les tables manquantes sont créées à la montée de version. */
export function openDB({ name = DB_NAME, version = DB_VERSION } = {}) {
  if (dbPromise) return dbPromise;
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('IndexedDB n\'est pas disponible dans ce navigateur (navigation privée ?).'));
  }
  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(name, version);
    open.onupgradeneeded = () => {
      const db = open.result;
      const tx = open.transaction;
      for (const [storeName, def] of Object.entries(STORES)) {
        const store = db.objectStoreNames.contains(storeName)
          ? tx.objectStore(storeName)
          : db.createObjectStore(storeName, { keyPath: def.keyPath });
        for (const [indexName, keyPath, options] of def.indexes) {
          if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, options ?? {});
        }
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      // Si un autre onglet met à jour le schéma, on ferme proprement cette connexion.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    open.onerror = () => { dbPromise = null; reject(open.error); };
    open.onblocked = () => reject(new Error('La base est ouverte dans un autre onglet. Fermez-le puis rechargez.'));
  });
  return dbPromise;
}

/** Ferme la connexion (utile pour les tests et la réinitialisation). */
export async function closeDB() {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}

/** Supprime entièrement la base. */
export async function deleteDatabase(name = DB_NAME) {
  await closeDB();
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Suppression bloquée : fermez les autres onglets de l\'application.'));
  });
}

/**
 * Exécute `fn(stores)` dans une transaction atomique.
 * `stores` donne accès à chaque table demandée : stores.transactions.put(obj)…
 * La promesse est résolue quand la transaction est validée (oncomplete), avec la valeur
 * retournée par `fn`. Toute erreur annule l'ensemble des écritures.
 */
export async function transaction(storeNames, mode, fn) {
  const db = await openDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const api = {};
    for (const n of names) api[n] = wrapStore(tx.objectStore(n));
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction annulée.'));
    Promise.resolve()
      .then(() => fn(api, tx))
      .then((r) => { result = r; })
      .catch((err) => { try { tx.abort(); } catch { /* déjà terminée */ } reject(err); });
  });
}

function wrapStore(store) {
  return {
    get: (key) => req(store.get(key)),
    getAll: () => req(store.getAll()),
    put: (value) => req(store.put(value)),
    add: (value) => req(store.add(value)),
    delete: (key) => req(store.delete(key)),
    clear: () => req(store.clear()),
    count: () => req(store.count()),
    byIndex: (index, query) => req(store.index(index).getAll(query)),
    getByIndex: (index, key) => req(store.index(index).get(key)),
  };
}

// Raccourcis lecture / écriture sur une seule table.
export const get = (store, key) => transaction(store, 'readonly', (s) => s[store].get(key));
export const getAll = (store) => transaction(store, 'readonly', (s) => s[store].getAll());
export const put = (store, value) => transaction(store, 'readwrite', (s) => s[store].put(value));
export const remove = (store, key) => transaction(store, 'readwrite', (s) => s[store].delete(key));
export const byIndex = (store, index, query) => transaction(store, 'readonly', (s) => s[store].byIndex(index, query));
