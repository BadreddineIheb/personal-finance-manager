/**
 * sw.js — Service worker : l'application fonctionne hors ligne.
 * Stratégie : tous les fichiers de l'application sont mis en cache à l'installation (précache),
 * puis servis depuis le cache ; une nouvelle version (CACHE_VERSION modifiée) remplace l'ancienne
 * quand l'utilisateur accepte la mise à jour.
 * Les données (IndexedDB) ne passent jamais par ce fichier.
 *
 * IMPORTANT : à chaque publication d'une nouvelle version, incrémenter CACHE_VERSION.
 * Le test tests/pwa.test.js vérifie que la liste PRECACHE contient bien tous les fichiers.
 */
const CACHE_VERSION = 'pfm-1.0.0';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/fonts/Inter-Variable.woff2',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './css/base.css',
  './css/components.css',
  './css/layout.css',
  './css/pages.css',
  './css/tokens.css',
  './js/app.js',
  './js/core/dates.js',
  './js/core/events.js',
  './js/core/money.js',
  './js/core/validation.js',
  './js/data/backup-validate.js',
  './js/data/backup.js',
  './js/data/db.js',
  './js/data/migrations.js',
  './js/data/repository.js',
  './js/data/schema.js',
  './js/domain/analytics.js',
  './js/domain/budgets.js',
  './js/domain/forecast.js',
  './js/domain/ledger.js',
  './js/domain/recurrence.js',
  './js/domain/savings.js',
  './js/domain/simulator.js',
  './js/domain/transactions.js',
  './js/domain/trend.js',
  './js/pages/budgets.js',
  './js/pages/dashboard.js',
  './js/pages/expenses.js',
  './js/pages/history.js',
  './js/pages/incomes.js',
  './js/pages/ledger-page.js',
  './js/pages/reports.js',
  './js/pages/savings.js',
  './js/pages/settings.js',
  './js/pwa.js',
  './js/reports/pdf-annual.js',
  './js/reports/pdf-kit.js',
  './js/reports/pdf-monthly.js',
  './js/reports/report-data.js',
  './js/ui/cache.js',
  './js/ui/charts.js',
  './js/ui/components/backup-ui.js',
  './js/ui/components/budget-widgets.js',
  './js/ui/components/global-search.js',
  './js/ui/components/modal.js',
  './js/ui/components/month-picker.js',
  './js/ui/components/recurrence-form.js',
  './js/ui/components/savings-forms.js',
  './js/ui/components/toast.js',
  './js/ui/components/transaction-form.js',
  './js/ui/components/transaction-row.js',
  './js/ui/components/widgets.js',
  './js/ui/dom.js',
  './js/ui/icons.js',
  './js/ui/router.js',
  './vendor/chart.umd.js',
  './vendor/jspdf.plugin.autotable.min.js',
  './vendor/jspdf.umd.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE_VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Navigation : la coquille de l'application, même hors ligne
    if (request.mode === 'navigate') {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await cache.match('./index.html')) ?? Response.error();
      }
    }
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      if (fresh.ok && fresh.type === 'basic') cache.put(request, fresh.clone());
      return fresh;
    } catch {
      return Response.error();
    }
  })());
});
