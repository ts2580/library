(() => {
  const showToast = (message, kind = 'success') => {
    if (!message) return;
    let host = document.getElementById('bookshelf-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bookshelf-toast-host';
      host.className = 'bookshelf-toast-host';
      document.body.appendChild(host);
    }
    const toast = document.createElement('div');
    toast.className = `bookshelf-toast ${kind === 'error' ? 'bookshelf-toast-error' : 'bookshelf-toast-success'}`;
    toast.textContent = message;
    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 240);
    }, 2600);
  };

  const markProductAsOwned = (cardRoot) => {
    if (!cardRoot) return;
    const chips = cardRoot.querySelector('[data-product-status-chips]');
    if (chips && !chips.querySelector('[data-product-owned-chip]')) {
      const chip = document.createElement('span');
      chip.className = 'bookshelf-chip bg-indigo-100 text-indigo-700 font-medium';
      chip.dataset.productOwnedChip = '';
      chip.textContent = '등록됨';
      chips.prepend(chip);
    }

    const importPanel = cardRoot.querySelector('[data-product-import-panel]');
    if (importPanel) {
      const ownedState = document.createElement('div');
      ownedState.className = 'mt-3';
      ownedState.dataset.productOwnedState = '';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bookshelf-btn-ghost w-full bookshelf-px-3 bookshelf-py-2 bookshelf-btn-size-xs';
      button.disabled = true;
      button.textContent = '등록됨';
      ownedState.appendChild(button);
      importPanel.replaceWith(ownedState);
    }
  };

  const forms = document.querySelectorAll('.product-import-form');
  forms.forEach((form) => {
    const input = form.querySelector('.target-book-search');
    const hidden = form.querySelector('.target-book-id');
    const results = form.querySelector('.target-book-results');
    if (!input || !hidden || !results) return;
    const cardRoot = form.closest('.bookshelf-card');
    const volumeInput = form.querySelector('[data-product-volume]');
    const sideStoryInput = form.querySelector('[data-product-side-story]');

    let timer = null;
    let items = [];
    let highlightedIndex = -1;
    let previousVolume = volumeInput?.value || '';
    let listboxId = results.id;
    if (!listboxId) {
      listboxId = `target-book-results-${Math.random().toString(36).slice(2, 10)}`;
      results.id = listboxId;
    }
    input.setAttribute('aria-controls', listboxId);

    const escapeHtml = (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

    const setExpanded = (expanded) => {
      input.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    };

    const escapeAttr = (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');

    const clearHighlight = () => {
      highlightedIndex = -1;
      input.removeAttribute('aria-activedescendant');
    };

    const setOpenState = (open) => {
      if (cardRoot) {
        cardRoot.classList.toggle('bookshelf-autocomplete-open', open);
      }
    };

    const hide = () => {
      results.classList.add('hidden');
      results.innerHTML = '';
      items = [];
      clearHighlight();
      setOpenState(false);
      setExpanded(false);
    };

    const applyHighlight = () => {
      const options = results.querySelectorAll('.target-book-option');
      options.forEach((option, index) => {
        const active = index === highlightedIndex;
        option.classList.toggle('ring-2', active);
        option.classList.toggle('ring-slate-300', active);
        option.classList.toggle('bg-slate-50', active);
        option.setAttribute('aria-selected', active ? 'true' : 'false');
        if (active) {
          input.setAttribute('aria-activedescendant', option.id);
          option.scrollIntoView({ block: 'nearest' });
        }
      });
      if (highlightedIndex < 0) {
        input.removeAttribute('aria-activedescendant');
      }
    };

    const selectItem = (item) => {
      if (!item) return;
      hidden.value = item.id || '';
      input.value = item.name || item.label || '';
      
      const typeInput = form.querySelector('input[name="type"]');
      if (typeInput) {
        typeInput.value = item.type || '';
      }
      
      if (volumeInput) {
        previousVolume = item.nextVolume ? String(item.nextVolume) : '';
        if (sideStoryInput?.checked !== true) {
          volumeInput.value = previousVolume;
        }
      }
      
      hide();
      input.focus();
    };

    const renderItems = (items) => {
      if (!items.length) {
        results.innerHTML = '<div class="rounded-[14px] bookshelf-px-3 bookshelf-py-3 text-xs text-slate-500">일치하는 책이 없습니다.</div>';
        results.classList.remove('hidden');
        clearHighlight();
        setOpenState(true);
        setExpanded(true);
        return;
      }

      results.innerHTML = items.map((item, index) => {
        const cover = (item.cover || '').trim();
        const coverImage = cover
          ? `<div class="shrink-0 rounded-[10px] border border-slate-200 bookshelf-cover-hover h-12 w-9 min-w-[2.25rem] overflow-hidden bg-slate-100"><img src="${escapeAttr(cover)}" class="h-full w-full object-cover" alt="${escapeAttr(item.name)}" loading="lazy"></div>`
          : `<div class="shrink-0 flex h-12 w-9 min-w-[2.25rem] items-center justify-center rounded-[10px] border border-slate-200 bg-slate-100 text-[10px] text-slate-400">NO</div>`;
        return `
          <button type="button"
            id="${listboxId}-option-${item.id}"
            class="target-book-option bookshelf-panel w-full rounded-[16px] border border-transparent bookshelf-px-3 bookshelf-py-3 text-left transition hover:border-slate-200 hover:bg-slate-50"
            role="option"
            aria-selected="false"
            data-id="${item.id}"
            data-label="${escapeHtml(item.name)}"
            data-index="${index}">
            <div class="flex items-center bookshelf-gap-3">
              ${coverImage}
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-slate-900">${escapeHtml(item.name)}</div>
                <div class="bookshelf-mt-1 truncate text-xs text-slate-500">${escapeHtml(item.author || '저자 미입력')}</div>
              </div>
            </div>
          </button>
        `;
      }).join('');
      results.classList.remove('hidden');
      setOpenState(true);
      setExpanded(true);
      highlightedIndex = 0;
      applyHighlight();

      results.querySelectorAll('.target-book-option').forEach((button) => {
        button.addEventListener('mouseenter', () => {
          highlightedIndex = Number(button.dataset.index);
          applyHighlight();
        });
        button.addEventListener('click', () => {
          selectItem(items[Number(button.dataset.index)]);
        });
      });
    };

    input.addEventListener('input', () => {
      hidden.value = '';
      const query = input.value.trim();
      if (timer) clearTimeout(timer);
      if (query.length < 1) {
        hide();
        return;
      }

      timer = setTimeout(async () => {
        try {
          const response = await fetch(`/products/books/autocomplete?q=${encodeURIComponent(query)}`);
          if (!response.ok) return;
          items = await response.json();
          renderItems(items);
        } catch (error) {
          console.error('book autocomplete error', error);
        }
      }, 180);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hide();
        return;
      }
      if (!items.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        highlightedIndex = (highlightedIndex + 1 + items.length) % items.length;
        applyHighlight();
        results.classList.remove('hidden');
        setExpanded(true);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        highlightedIndex = (highlightedIndex - 1 + items.length) % items.length;
        applyHighlight();
        results.classList.remove('hidden');
        setExpanded(true);
      } else if (event.key === 'Enter' && highlightedIndex >= 0) {
        event.preventDefault();
        selectItem(items[highlightedIndex]);
      }
    });

    input.addEventListener('blur', () => setTimeout(hide, 150));
    input.addEventListener('focus', () => {
      if (results.innerHTML.trim()) results.classList.remove('hidden');
      if (results.innerHTML.trim()) setExpanded(true);
      if (results.innerHTML.trim()) {
        setOpenState(true);
      }
    });

    const syncSideStoryState = () => {
      if (!volumeInput) return;
      const sideStory = sideStoryInput?.checked === true;
      if (sideStory && volumeInput.value) {
        previousVolume = volumeInput.value;
      }
      volumeInput.disabled = sideStory;
      volumeInput.placeholder = sideStory ? '외전은 권 번호 없음' : '번호';
      if (sideStory) {
        volumeInput.value = '';
      } else if (!volumeInput.value && previousVolume) {
        volumeInput.value = previousVolume;
      }
    };

    volumeInput?.addEventListener('input', () => {
      if (sideStoryInput?.checked !== true) previousVolume = volumeInput.value;
    });
    sideStoryInput?.addEventListener('change', syncSideStoryState);
    syncSideStoryState();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      if (!submitBtn || submitBtn.disabled) return;

      const originalLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = '저장 중...';

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error(response.redirected ? '로그인 상태를 확인해 주세요.' : '상품 등록 응답을 확인할 수 없습니다.');
        }
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.message || '상품 등록에 실패했습니다.');
        }
        showToast(result.message, result.success ? 'success' : 'error');
        if (result.success) {
          markProductAsOwned(cardRoot);
        }
      } catch (error) {
        showToast(error.message || '상품 등록 중 오류가 발생했습니다.', 'error');
      } finally {
        window.__sparkProgress?.hide?.(80);
        if (submitBtn.isConnected) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
        }
      }
    });
  });
})();
