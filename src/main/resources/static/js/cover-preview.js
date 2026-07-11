(() => {
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hoverDelayMs = 0;
  const longPressDelayMs = 450;
  const viewportMargin = 18;
  const longPressMoveTolerance = 12;
  let preview = null;
  let previewImage = null;
  let activeTrigger = null;
  let showTimer = null;
  let pressStart = null;
  let longPressVisible = false;

  function clearShowTimer() {
    if (!showTimer) return;
    window.clearTimeout(showTimer);
    showTimer = null;
  }

  function hidePreview() {
    clearShowTimer();
    activeTrigger = null;
    pressStart = null;
    longPressVisible = false;
    if (!preview) return;
    preview.remove();
    preview = null;
    previewImage = null;
  }

  function applyNaturalSize(sourceImage) {
    if (!preview || !previewImage) return;
    const naturalWidth = previewImage.naturalWidth || sourceImage.naturalWidth || sourceImage.clientWidth;
    const naturalHeight = previewImage.naturalHeight || sourceImage.naturalHeight || sourceImage.clientHeight;
    const maxWidth = window.innerWidth - (viewportMargin * 2);
    const maxHeight = window.innerHeight - (viewportMargin * 2);
    const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);

    previewImage.style.width = `${Math.max(1, Math.round(naturalWidth * scale))}px`;
    previewImage.style.height = `${Math.max(1, Math.round(naturalHeight * scale))}px`;
    requestAnimationFrame(() => preview?.classList.add('is-visible'));
  }

  function showPreview(sourceImage) {
    const src = sourceImage.currentSrc || sourceImage.src;
    if (!src || src.startsWith('data:image/svg+xml')) return;

    if (preview) preview.remove();
    preview = document.createElement('div');
    preview.className = 'bookshelf-cover-original-preview';
    preview.setAttribute('aria-hidden', 'true');

    previewImage = document.createElement('img');
    previewImage.src = src;
    previewImage.alt = sourceImage.alt || '';
    preview.appendChild(previewImage);
    document.body.appendChild(preview);

    if (previewImage.complete && previewImage.naturalWidth > 0) {
      applyNaturalSize(sourceImage);
      return;
    }
    previewImage.addEventListener('load', () => applyNaturalSize(sourceImage), { once: true });
    previewImage.addEventListener('error', hidePreview, { once: true });
  }

  function schedulePreview(trigger, options = {}) {
    const sourceImage = trigger.querySelector('img');
    if (!sourceImage) return;
    clearShowTimer();
    activeTrigger = trigger;
    showTimer = window.setTimeout(() => {
      if (activeTrigger !== trigger) return;
      longPressVisible = options.longPress === true;
      showPreview(sourceImage);
    }, options.delayMs ?? hoverDelayMs);
  }

  function bindTouchLongPress(trigger) {
    trigger.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      pressStart = { x: event.clientX, y: event.clientY };
      schedulePreview(trigger, { longPress: true, delayMs: longPressDelayMs });
    }, { passive: true });

    trigger.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse' || !pressStart) return;
      const movedX = Math.abs(event.clientX - pressStart.x);
      const movedY = Math.abs(event.clientY - pressStart.y);
      if (movedX > longPressMoveTolerance || movedY > longPressMoveTolerance) {
        hidePreview();
      }
    }, { passive: true });

    trigger.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'mouse') return;
      if (longPressVisible) event.preventDefault();
      hidePreview();
    });

    trigger.addEventListener('pointercancel', (event) => {
      if (event.pointerType === 'mouse') return;
      if (longPressVisible) return;
      hidePreview();
    });

    trigger.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    trigger.addEventListener('touchend', () => {
      if (longPressVisible) hidePreview();
    }, { passive: true });

    trigger.addEventListener('touchcancel', () => {
      if (!longPressVisible) hidePreview();
    }, { passive: true });

    trigger.addEventListener('dragstart', (event) => {
      event.preventDefault();
    });
  }

  document.querySelectorAll('.bookshelf-cover-hover').forEach((trigger) => {
    if (canHover) {
      trigger.addEventListener('mouseenter', () => schedulePreview(trigger, { delayMs: hoverDelayMs }));
      trigger.addEventListener('mouseleave', hidePreview);
    }
    bindTouchLongPress(trigger);
    trigger.addEventListener('focusout', hidePreview);
  });

  window.addEventListener('scroll', hidePreview, { passive: true });
  window.addEventListener('resize', hidePreview);
  window.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.pointerType !== 'mouse' && target?.closest('.bookshelf-cover-hover')) return;
    hidePreview();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePreview();
  });
})();
