(() => {
  const isMobile = () => window.matchMedia('(pointer: coarse)').matches
    || /Mobi|Android|iPhone|iPad|iPod/.test(navigator.userAgent || '');

  const restoreScrollPosition = () => {
    if (!isMobile()) return;
    const key = `bookshelf-scroll:${location.pathname}${location.search}`;
    const saved = sessionStorage.getItem(key);
    if (!saved) return;

    const y = Number(saved);
    if (!Number.isFinite(y) || y <= 0) return;
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const targetY = Math.min(y, maxY);
    if (targetY <= 0) return;

    const restore = () => {
      window.scrollTo(0, targetY);
      if (window.scrollY < targetY - 1) {
        requestAnimationFrame(restore);
      }
    };

    requestAnimationFrame(() => requestAnimationFrame(restore));
    sessionStorage.removeItem(key);
  };

  const saveScrollPosition = () => {
    if (!isMobile()) return;
    const key = `bookshelf-scroll:${location.pathname}${location.search}`;
    sessionStorage.setItem(key, String(window.scrollY));
  };

  if (isMobile() && history.scrollRestoration) {
    history.scrollRestoration = 'manual';
  }

  restoreScrollPosition();
  window.addEventListener('pagehide', saveScrollPosition);

  const dialog = document.getElementById('bookCreateDialog');
  if (!dialog) return;

  const openButton = document.getElementById('openBookCreateDialog');
  const closeButton = document.getElementById('bookCreateClose');
  const cancelButton = document.getElementById('bookCreateCancel');
  const nameInput = document.getElementById('bookCreateName');

  const closeDialog = () => {
    if (dialog.open) dialog.close();
  };

  openButton?.addEventListener('click', () => {
    dialog.showModal();
    nameInput?.focus();
  });
  closeButton?.addEventListener('click', closeDialog);
  cancelButton?.addEventListener('click', closeDialog);

  const form = document.getElementById('bookCreateForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        if (submitBtn.dataset.submitting === 'true') {
          e.preventDefault();
          return;
        }
        submitBtn.dataset.submitting = 'true';
        setTimeout(() => {
          submitBtn.disabled = true;
          submitBtn.textContent = '추가 중...';
        }, 0);
      }
    });
  }
})();
