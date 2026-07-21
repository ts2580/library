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
  const typeInput = document.getElementById('bookCreateType');
  const targetBookSearch = document.getElementById('bookCreateTargetSearch');
  const targetBookIdInput = document.getElementById('bookCreateTargetBookId');
  const targetBookResults = document.getElementById('bookCreateTargetResults');
  const targetBookMeta = document.getElementById('bookCreateTargetMeta');
  const form = document.getElementById('bookCreateForm');
  const submitButton = document.getElementById('bookCreateSubmit');
  const selectionConfirmedInput = document.getElementById('bookCreateSelectionConfirmed');
  const nonAladinCheckbox = document.getElementById('bookCreateNonAladin');
  const previewSection = document.getElementById('bookCreatePreview');
  const previewCount = document.getElementById('bookCreatePreviewCount');
  const previewMessage = document.getElementById('bookCreatePreviewMessage');
  const previewCards = document.getElementById('bookCreatePreviewCards');
  const selectAllButton = document.getElementById('bookCreateSelectAll');
  const excludeAllButton = document.getElementById('bookCreateExcludeAll');

  let previewedName = '';
  let previewItemCount = 0;
  let previewTotalResults = 0;
  let previewLoading = false;
  let selectedTargetBook = null;
  let manualTypeValue = typeInput?.value || '';

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const escapeAttr = escapeHtml;

  const formatPrice = (value) => {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '-';
    return /^\d+$/.test(normalized) ? Number(normalized).toLocaleString('ko-KR') : normalized;
  };

  const selectableCheckboxes = () => Array.from(
    previewCards?.querySelectorAll('[data-book-create-exclude]:not(:disabled)') || []
  );

  const syncSelectionState = () => {
    const selectable = selectableCheckboxes();
    const selected = selectable.filter((checkbox) => !checkbox.checked);
    let nextVolume = selectedTargetBook?.nextVolume || 1;

    selectable.forEach((excludeCheckbox) => {
      const card = excludeCheckbox.closest('[data-book-create-preview-card]');
      const volumeLabel = card?.querySelector('[data-book-create-volume-label]');
      const selectionInput = card?.querySelector('[data-book-create-selection]');
      const sideStoryCheckbox = card?.querySelector('[data-book-create-side-story]');
      const included = !excludeCheckbox.checked;
      const sideStory = included && sideStoryCheckbox?.checked === true;
      card?.classList.toggle('is-selected', included);
      card?.classList.toggle('is-excluded', !included);
      if (selectionInput) selectionInput.disabled = !included;
      if (sideStoryCheckbox) sideStoryCheckbox.disabled = !included;
      if (volumeLabel) {
        volumeLabel.textContent = included
          ? (sideStory ? '외전' : `${nextVolume++}권 예정`)
          : '제외됨';
      }
    });

    if (previewCount) {
      previewCount.textContent = previewItemCount === 0
        ? '추가할 알라딘 항목 없이 책 정보만 등록합니다.'
        : `검색 결과 ${previewTotalResults}건 중 ${previewItemCount}건 표시 · ${selected.length}개 추가 예정`;
    }

    if (submitButton && previewedName) {
      const hasNoResults = previewItemCount === 0;
      const targetHasNoItems = hasNoResults && selectedTargetBook !== null;
      submitButton.disabled = targetHasNoItems || (!hasNoResults && selected.length === 0);
      submitButton.textContent = targetHasNoItems
        ? '추가할 책 없음'
        : (hasNoResults ? '책만 추가' : `${selected.length}권 추가`);
    }
  };

  const resetPreview = () => {
    previewedName = '';
    previewItemCount = 0;
    previewTotalResults = 0;
    if (selectionConfirmedInput) selectionConfirmedInput.value = 'false';
    if (previewSection) previewSection.hidden = true;
    if (previewCards) previewCards.innerHTML = '';
    if (previewMessage) {
      previewMessage.hidden = true;
      previewMessage.textContent = '';
    }
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = nonAladinCheckbox?.checked ? '입력 정보로 등록' : '추가 예정 확인';
      submitButton.dataset.submitting = 'false';
    }
  };

  const renderPreview = (payload, query) => {
    const items = Array.isArray(payload.items) ? payload.items : [];
    previewedName = query;
    previewItemCount = items.length;
    previewTotalResults = Number(payload.totalResults || items.length);
    if (selectionConfirmedInput) selectionConfirmedInput.value = 'true';
    if (previewSection) previewSection.hidden = false;
    if (previewMessage) {
      previewMessage.textContent = payload.message || '';
      previewMessage.hidden = !payload.message;
    }

    if (previewCards) {
      previewCards.innerHTML = items.map((item) => {
        const title = item.title || '제목 없음';
        const selectionKey = item.selectionKey || '';
        const selectable = item.selectable === true;
        const cover = String(item.cover || '').trim();
        const coverMarkup = cover
          ? `<img src="${escapeAttr(cover)}" alt="${escapeAttr(title)} 표지" class="h-full w-full object-cover" loading="lazy" decoding="async">`
          : '<div class="absolute inset-0 flex items-center justify-center bookshelf-empty-cover text-xs">NO COVER</div>';
        return `
          <article class="bookshelf-card bookshelf-book-create-preview-card bookshelf-pad-card-sm ${selectable ? 'is-selected' : 'is-excluded'}" data-book-create-preview-card>
            <input type="hidden" name="selectedIsbn" value="${escapeAttr(selectionKey)}" data-book-create-selection ${selectable ? '' : 'disabled'}>
            <div class="bookshelf-cover-hover bookshelf-book-create-preview-cover relative w-full overflow-hidden rounded-[16px] bg-slate-100">
              ${coverMarkup}
            </div>
            <div class="bookshelf-mt-3 bookshelf-book-create-preview-content">
              <h5 class="line-clamp-2 bookshelf-title-sm">${escapeHtml(title)}</h5>
              <p class="bookshelf-subtitle-sm line-clamp-1">${escapeHtml(item.author || '저자 미입력')}</p>
              <div class="flex flex-wrap items-center gap-1 text-[10px] sm:text-xs">
                <span class="bookshelf-chip bookshelf-chip-tag" data-book-create-volume-label>${selectable ? '' : '등록 대상 아님'}</span>
                ${item.exists ? '<span class="bookshelf-chip bg-indigo-100 text-indigo-700 font-medium">등록됨</span>' : ''}
                <span class="bookshelf-chip bookshelf-chip-tag">정가 ${escapeHtml(formatPrice(item.priceStandard))}</span>
                <span class="bookshelf-chip bookshelf-chip-tag">판매가 ${escapeHtml(formatPrice(item.priceSales))}</span>
                <span class="bookshelf-chip bookshelf-chip-tag">ISBN13 ${escapeHtml(item.isbn13 || '-')}</span>
              </div>
              <div class="bookshelf-book-create-preview-options">
                <label class="bookshelf-dialog-check bookshelf-detail-label">
                  <input type="checkbox" data-book-create-exclude ${selectable ? '' : 'disabled'} class="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500">
                  제외
                </label>
                <label class="bookshelf-dialog-check bookshelf-detail-label">
                  <input type="checkbox" name="sideStoryIsbn" value="${escapeAttr(selectionKey)}" data-book-create-side-story ${selectable ? '' : 'disabled'} class="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500">
                  외전으로 추가
                </label>
              </div>
            </div>
          </article>
        `;
      }).join('');
      previewCards.querySelectorAll('[data-book-create-exclude]').forEach((checkbox) => {
        checkbox.addEventListener('change', syncSelectionState);
      });
      previewCards.querySelectorAll('[data-book-create-side-story]').forEach((checkbox) => {
        checkbox.addEventListener('change', syncSelectionState);
      });
    }

    const hasSelectableItems = selectableCheckboxes().length > 0;
    if (selectAllButton) selectAllButton.disabled = !hasSelectableItems;
    if (excludeAllButton) excludeAllButton.disabled = !hasSelectableItems;
    syncSelectionState();
    previewSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const showPreviewError = (message) => {
    resetPreview();
    if (previewSection) previewSection.hidden = false;
    if (previewMessage) {
      previewMessage.textContent = message;
      previewMessage.hidden = false;
    }
    if (previewCount) previewCount.textContent = '추가 예정 목록을 불러오지 못했습니다.';
  };

  const loadPreview = async () => {
    const query = nameInput?.value.trim() || '';
    if (!query || previewLoading) return;
    previewLoading = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = '알라딘 검색 중...';
    }
    window.__sparkProgress?.show?.();

    try {
      const response = await fetch(`/books/aladin-preview?name=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(response.redirected ? '로그인 상태를 확인해 주세요.' : '알라딘 검색 응답을 확인할 수 없습니다.');
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || '알라딘 검색에 실패했습니다.');
      renderPreview(payload, query);
    } catch (error) {
      showPreviewError(error.message || '추가 예정 목록을 불러오지 못했습니다.');
    } finally {
      previewLoading = false;
      window.__sparkProgress?.hide?.(80);
      if (submitButton && !previewedName) {
        submitButton.disabled = false;
        submitButton.textContent = '다시 확인';
      }
    }
  };

  let targetSearchTimer = null;
  let targetSearchItems = [];
  let targetHighlightedIndex = -1;

  const setTargetExpanded = (expanded) => {
    targetBookSearch?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  };

  const hideTargetResults = () => {
    if (targetBookResults) {
      targetBookResults.classList.add('hidden');
      targetBookResults.innerHTML = '';
    }
    targetSearchItems = [];
    targetHighlightedIndex = -1;
    targetBookSearch?.removeAttribute('aria-activedescendant');
    setTargetExpanded(false);
  };

  const updateTargetMeta = () => {
    if (!targetBookMeta || !selectedTargetBook) {
      if (targetBookMeta) targetBookMeta.hidden = true;
      return;
    }
    const category = selectedTargetBook.type || '미분류';
    const volumeMessage = `일반 권은 ${selectedTargetBook.nextVolume || 1}권부터 추가`;
    targetBookMeta.textContent = `선택됨 · 카테고리 ${category} · ${volumeMessage}`;
    targetBookMeta.hidden = false;
  };

  const clearTargetBookSelection = () => {
    selectedTargetBook = null;
    if (targetBookIdInput) targetBookIdInput.value = '';
    if (typeInput) {
      typeInput.readOnly = false;
      typeInput.value = manualTypeValue;
    }
    updateTargetMeta();
  };

  const syncNonAladinMode = () => {
    const directRegistration = nonAladinCheckbox?.checked === true;
    resetPreview();
    if (directRegistration) {
      clearTargetBookSelection();
      if (targetBookSearch) targetBookSearch.value = '';
      hideTargetResults();
    }
    if (targetBookSearch) targetBookSearch.disabled = directRegistration;
    if (selectionConfirmedInput) selectionConfirmedInput.value = 'false';
    if (submitButton) submitButton.textContent = directRegistration ? '입력 정보로 등록' : '추가 예정 확인';
  };

  const selectTargetBook = (item) => {
    if (!item) return;
    resetPreview();
    selectedTargetBook = item;
    if (targetBookIdInput) targetBookIdInput.value = item.id || '';
    if (targetBookSearch) targetBookSearch.value = item.name || '';
    if (nameInput && !nameInput.value.trim()) nameInput.value = item.name || '';
    if (typeInput) {
      typeInput.value = item.type || '';
      typeInput.readOnly = true;
    }
    updateTargetMeta();
    hideTargetResults();
    targetBookSearch?.focus();
  };

  const applyTargetHighlight = () => {
    const options = targetBookResults?.querySelectorAll('[data-book-create-target-option]') || [];
    options.forEach((option, index) => {
      const active = index === targetHighlightedIndex;
      option.classList.toggle('ring-2', active);
      option.classList.toggle('ring-slate-300', active);
      option.classList.toggle('bg-slate-50', active);
      option.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) {
        targetBookSearch?.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const renderTargetBooks = (items) => {
    if (!targetBookResults) return;
    targetSearchItems = items;
    if (!items.length) {
      targetBookResults.innerHTML = '<div class="rounded-[14px] bookshelf-px-3 bookshelf-py-3 text-xs text-slate-500">일치하는 기존 책이 없습니다.</div>';
      targetBookResults.classList.remove('hidden');
      targetHighlightedIndex = -1;
      setTargetExpanded(true);
      return;
    }

    targetBookResults.innerHTML = items.map((item, index) => {
      const cover = String(item.cover || '').trim();
      const coverMarkup = cover
        ? `<div class="shrink-0 rounded-[10px] border border-slate-200 bookshelf-cover-hover h-12 w-9 min-w-[2.25rem] overflow-hidden bg-slate-100"><img src="${escapeAttr(cover)}" class="h-full w-full object-cover" alt="${escapeAttr(item.name)} 표지" loading="lazy"></div>`
        : '<div class="shrink-0 flex h-12 w-9 min-w-[2.25rem] items-center justify-center rounded-[10px] border border-slate-200 bg-slate-100 text-[10px] text-slate-400">NO</div>';
      return `
        <button type="button" id="book-create-target-option-${item.id}" class="bookshelf-panel w-full rounded-[16px] border border-transparent bookshelf-px-3 bookshelf-py-3 text-left transition hover:border-slate-200 hover:bg-slate-50" role="option" aria-selected="false" data-book-create-target-option data-index="${index}">
          <div class="flex items-center bookshelf-gap-3">
            ${coverMarkup}
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-slate-900">${escapeHtml(item.name)}</div>
              <div class="bookshelf-mt-1 truncate text-xs text-slate-500">${escapeHtml(item.author || '저자 미입력')} · ${escapeHtml(item.type || '미분류')} · 다음 ${escapeHtml(item.nextVolume || 1)}권</div>
            </div>
          </div>
        </button>
      `;
    }).join('');
    targetBookResults.classList.remove('hidden');
    targetHighlightedIndex = 0;
    setTargetExpanded(true);
    applyTargetHighlight();

    targetBookResults.querySelectorAll('[data-book-create-target-option]').forEach((button) => {
      button.addEventListener('mouseenter', () => {
        targetHighlightedIndex = Number(button.dataset.index);
        applyTargetHighlight();
      });
      button.addEventListener('click', () => selectTargetBook(targetSearchItems[Number(button.dataset.index)]));
    });
  };

  const closeDialog = () => {
    window.__sparkProgress?.hide?.(0);
    if (dialog.open) dialog.close();
  };

  openButton?.addEventListener('click', () => {
    dialog.showModal();
    nameInput?.focus();
  });
  closeButton?.addEventListener('click', closeDialog);
  cancelButton?.addEventListener('click', closeDialog);

  typeInput?.addEventListener('input', () => {
    if (!typeInput.readOnly) manualTypeValue = typeInput.value;
  });

  targetBookSearch?.addEventListener('input', () => {
    if (selectedTargetBook) {
      resetPreview();
      clearTargetBookSelection();
    }
    const query = targetBookSearch.value.trim();
    if (targetSearchTimer) clearTimeout(targetSearchTimer);
    if (!query) {
      hideTargetResults();
      return;
    }

    targetSearchTimer = setTimeout(async () => {
      try {
        const response = await fetch(`/products/books/autocomplete?q=${encodeURIComponent(query)}`, {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store'
        });
        if (!response.ok) throw new Error(`autocomplete-failed:${response.status}`);
        const items = await response.json();
        if (targetBookSearch.value.trim() === query) renderTargetBooks(Array.isArray(items) ? items : []);
      } catch (error) {
        console.error('manual book target autocomplete failed', error);
        if (targetBookResults) {
          targetBookResults.innerHTML = '<div class="rounded-[14px] bookshelf-px-3 bookshelf-py-3 text-xs text-rose-600">기존 책을 불러오지 못했습니다.</div>';
          targetBookResults.classList.remove('hidden');
          setTargetExpanded(true);
        }
      }
    }, 180);
  });

  targetBookSearch?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideTargetResults();
      return;
    }
    if (!targetSearchItems.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      targetHighlightedIndex = (targetHighlightedIndex + 1 + targetSearchItems.length) % targetSearchItems.length;
      applyTargetHighlight();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      targetHighlightedIndex = (targetHighlightedIndex - 1 + targetSearchItems.length) % targetSearchItems.length;
      applyTargetHighlight();
    } else if (event.key === 'Enter' && targetHighlightedIndex >= 0) {
      event.preventDefault();
      selectTargetBook(targetSearchItems[targetHighlightedIndex]);
    }
  });
  targetBookSearch?.addEventListener('blur', () => setTimeout(hideTargetResults, 150));

  nameInput?.addEventListener('input', () => {
    if (previewedName && nameInput.value.trim() !== previewedName) resetPreview();
  });

  nonAladinCheckbox?.addEventListener('change', syncNonAladinMode);
  syncNonAladinMode();

  selectAllButton?.addEventListener('click', () => {
    selectableCheckboxes().forEach((checkbox) => { checkbox.checked = false; });
    syncSelectionState();
  });
  excludeAllButton?.addEventListener('click', () => {
    selectableCheckboxes().forEach((checkbox) => { checkbox.checked = true; });
    syncSelectionState();
  });

  form?.addEventListener('submit', async (event) => {
    if (nonAladinCheckbox?.checked) {
      if (submitButton?.dataset.submitting === 'true') {
        event.preventDefault();
        return;
      }
      if (submitButton) {
        submitButton.dataset.submitting = 'true';
        submitButton.disabled = true;
        submitButton.textContent = '추가 중...';
      }
      window.__sparkProgress?.show?.();
      return;
    }
    const query = nameInput?.value.trim() || '';
    if (!previewedName || previewedName !== query) {
      event.preventDefault();
      await loadPreview();
      return;
    }

    if (submitButton?.dataset.submitting === 'true') {
      event.preventDefault();
      return;
    }
    if (submitButton) {
      submitButton.dataset.submitting = 'true';
      submitButton.disabled = true;
      submitButton.textContent = '추가 중...';
    }
    window.__sparkProgress?.show?.();
  });
})();
