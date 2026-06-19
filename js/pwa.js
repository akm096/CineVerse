(() => {
  const APP_VERSION = '1.3.7';
  let installPrompt = null;
  let refreshing = false;
  const installButton = document.getElementById('installAppBtn');
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isMobileLike = window.matchMedia('(max-width: 900px)').matches || window.matchMedia('(pointer: coarse)').matches;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing || sessionStorage.getItem('cv-sw-version') === APP_VERSION) return;
      refreshing = true;
      sessionStorage.setItem('cv-sw-version', APP_VERSION);
      window.location.reload();
    });

    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`, {
          updateViaCache: 'none'
        });
        await registration.update();
        const checkForUpdate = () => registration.update().catch(() => {});
        window.setInterval(checkForUpdate, 5 * 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });
      } catch {}
    });
  }

  if (isStandalone) {
    if (installButton) installButton.hidden = true;
    return;
  }

  if ((isIOS || isMobileLike) && installButton) installButton.hidden = false;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    if (installButton) installButton.hidden = false;
  });

  installButton?.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      installButton.hidden = true;
      return;
    }

    if (isIOS) {
      alert('Safari-də Paylaş düyməsinə toxun, sonra “Ana ekrana əlavə et” seç.');
      return;
    }

    alert('Brauzer menyusundan “Tətbiqi quraşdır” və ya “Ana ekrana əlavə et” seç.');
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    if (installButton) installButton.hidden = true;
  });
})();
