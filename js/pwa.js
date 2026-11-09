/**
 * pwa.js — Application installable et hors ligne.
 * - Enregistre le service worker (sw.js) qui met l'application en cache.
 * - Quand une nouvelle version est disponible, propose de recharger (aucun rechargement forcé
 *   pendant une saisie).
 * - Mémorise l'invitation d'installation du navigateur pour le bouton « Installer l'application ».
 */
import { toast } from './ui/components/toast.js';

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; });

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export async function installState() {
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  return {
    installed: isStandalone(),
    canPrompt: Boolean(deferredPrompt),
    ios: /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    offlineReady: Boolean(reg?.active),
  };
}

export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome;
}

/** Enregistre le service worker (uniquement en HTTPS ou sur localhost). */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    const offerReload = (worker) => {
      toast('Une nouvelle version de l\'application est disponible.', {
        duration: 30000,
        action: { label: 'Mettre à jour', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offerReload(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerReload(worker);
      });
    });
    // Rechargement uniquement lors d'une MISE À JOUR (pas lors de la toute première installation)
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });
  } catch (err) {
    console.warn('[pwa] service worker non enregistré :', err);
  }
}
