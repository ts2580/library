(() => {
  const root = document.getElementById('bookDetailPage');
  if (!root) return;

  const bookId = root.dataset.bookId;
  let bookName = root.dataset.bookName || '이 책';
  const fallbackCover = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 360"><rect width="240" height="360" fill="#e5e7eb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-size="18" font-family="sans-serif">NO COVER</text></svg>');
  const volumeDeleteStorageKey = `book-detail:${bookId}:volume-delete`;

  const bookCard = document.getElementById('bookInfoCard');
  const bookForm = document.getElementById('bookEditForm');
  const bookDialog = document.getElementById('bookEditDialog');
  const volumeCreateDialog = document.getElementById('volumeCreateDialog');
  const volumeCreateForm = document.getElementById('volumeCreateForm');
  const volumeDialog = document.getElementById('volumeEditDialog');
  const volumeForm = document.getElementById('volumeEditForm');
  const deleteVolumesForm = document.getElementById('deleteVolumesForm');
  const deleteBookForm = document.getElementById('deleteBookForm');
  const enrichBookInfoForm = document.getElementById('enrichBookInfoForm');
  let isNavigatingAfterSubmit = false;

  function closeDialog(dialog) {
    if (dialog && dialog.open) dialog.close();
  }

  function forceDialogTitleHorizontalLayout() {
    const title = document.getElementById('bookEditTitle');
    const volumeTitle = document.getElementById('volumeEditTitle');
    const volumeSubtitle = document.getElementById('volumeEditSubtitle');
    [title, volumeTitle, volumeSubtitle].forEach((el) => {
      if (!el) return;
      el.style.setProperty('writing-mode', 'horizontal-tb', 'important');
      el.style.setProperty('-webkit-writing-mode', 'horizontal-tb', 'important');
      el.style.setProperty('-ms-writing-mode', 'horizontal-tb', 'important');
      el.style.setProperty('text-orientation', 'mixed', 'important');
      el.style.setProperty('white-space', 'normal', 'important');
      el.style.setProperty('word-break', 'keep-all', 'important');
      el.style.setProperty('overflow-wrap', 'normal', 'important');
      el.style.setProperty('text-wrap', 'pretty', 'important');
      el.style.setProperty('transform', 'none', 'important');
      el.style.setProperty('direction', 'ltr');
      el.style.setProperty('unicode-bidi', 'normal');
      el.style.setProperty('margin', '0');
      el.style.setProperty('width', '100%');
      el.style.setProperty('max-width', '100%');
      el.style.setProperty('display', 'block');
    });
  }

  function showToast(message, kind = 'success') {
    const text = (message || '').trim();
    if (!text) return;
    let host = document.getElementById('bookshelf-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bookshelf-toast-host';
      host.className = 'bookshelf-toast-host';
      document.body.appendChild(host);
    }

    const toast = document.createElement('div');
    toast.className = `bookshelf-toast ${kind === 'error' ? 'bookshelf-toast-error' : 'bookshelf-toast-success'}`;
    toast.textContent = text;
    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 240);
    }, 2200);
  }

  function focusDialogNonInput(dialog) {
    if (!dialog) return;
    const button = dialog.querySelector('.bookshelf-dialog-close-icon')
      || dialog.querySelector('button[type="button"]')
      || dialog.querySelector('button');
    if (button instanceof HTMLElement) {
      button.focus({ preventScroll: true });
      return;
    }
    const panel = dialog.querySelector('.bookshelf-card');
    if (panel instanceof HTMLElement) {
      panel.setAttribute('tabindex', '-1');
      panel.focus({ preventScroll: true });
      panel.removeAttribute('tabindex');
    }
  }

  function checkedVolumes() {
    return Array.from(document.querySelectorAll('.volume-select'));
  }

  function resetVolumeSelection() {
    checkedVolumes().forEach((checkbox) => {
      checkbox.checked = false;
    });
    syncDeleteButton();
  }

  function setDeleteButtonPending(button, pending, pendingLabel, idleLabel) {
    if (!button) return;
    button.disabled = pending;
    button.textContent = pending ? pendingLabel : idleLabel;
    button.classList.toggle('opacity-60', pending || idleLabel === '삭제');
  }

  function syncDatasetFromSource(target, source, keys) {
    if (!target || !source) return;
    keys.forEach((key) => {
      target.dataset[key] = source.dataset[key] || '';
    });
  }

  function syncTextParagraphRows(targetRoot, targetSelector, sourceRoot, sourceSelector) {
    if (!targetRoot || !sourceRoot) return;
    const targetContainer = targetRoot.querySelector(targetSelector);
    const sourceContainer = sourceRoot.querySelector(sourceSelector);
    if (!targetContainer || !sourceContainer) return;
    const targetRows = Array.from(targetContainer.querySelectorAll('p'));
    const sourceRows = Array.from(sourceContainer.querySelectorAll('p'));
    const max = Math.min(targetRows.length, sourceRows.length);
    for (let i = 0; i < max; i++) {
      targetRows[i].textContent = sourceRows[i].textContent;
    }
  }

  function syncCoverElement(targetCard, sourceCard) {
    if (!targetCard || !sourceCard) return;
    const targetCover = targetCard.querySelector('.bookshelf-cover-hover');
    const sourceCover = sourceCard.querySelector('.bookshelf-cover-hover');
    if (!targetCover || !sourceCover) return;
    targetCover.innerHTML = sourceCover.innerHTML;
  }

  function applyBookUpdateFromRefreshedHtml(responseText) {
    if (!bookCard) return false;
    const nextDoc = new DOMParser().parseFromString(responseText, 'text/html');
    const nextCard = nextDoc.getElementById('bookInfoCard');
    if (!nextCard) return false;

    syncDatasetFromSource(bookCard, nextCard, [
      'bookName',
      'bookAuthor',
      'bookDescription',
      'bookCover',
      'bookType',
      'bookTotalvolume'
    ]);
    syncCoverElement(bookCard, nextCard);
    const title = bookCard.querySelector('h1');
    const nextTitle = nextCard.querySelector('h1');
    if (title && nextTitle) title.textContent = nextTitle.textContent.trim();
    syncTextParagraphRows(bookCard, '.bookshelf-space-y-2', nextCard, '.bookshelf-space-y-2');

    const description = bookCard.querySelector('p.bookshelf-mt-4');
    const nextDescription = nextCard.querySelector('p.bookshelf-mt-4');
    if (description && nextDescription) description.textContent = nextDescription.textContent;

    bookName = bookCard.dataset.bookName || '이 책';
    root.dataset.bookName = bookName;
    return true;
  }

  function applyVolumeUpdateFromRefreshedHtml(responseText, volumeId) {
    const nextDoc = new DOMParser().parseFromString(responseText, 'text/html');
    const nextCard = nextDoc.querySelector(`[data-volume-card][data-volume-id="${volumeId}"]`);
    const card = document.querySelector(`[data-volume-card][data-volume-id="${volumeId}"]`);
    if (!card || !nextCard) return false;

    syncDatasetFromSource(card, nextCard, [
      'volumeId',
      'volumeSeq',
      'volumeSideStory',
      'volumeName',
      'volumeIsbn13',
      'volumePrice',
      'volumeCover',
      'volumeDescription',
      'volumePurchased',
      'volumeNoNeedToBuy',
      'volumeType'
    ]);
    syncCoverElement(card, nextCard);

    const title = card.querySelector('h3');
    const nextTitle = nextCard.querySelector('h3');
    if (title && nextTitle) title.textContent = nextTitle.textContent;
    syncTextParagraphRows(card, '.bookshelf-space-y-1', nextCard, '.bookshelf-space-y-1');

    const description = card.querySelector('.bookshelf-mt-2.text-xs');
    const nextDescription = nextCard.querySelector('.bookshelf-mt-2.text-xs');
    if (description || nextDescription) {
      if (nextDescription) {
        if (!description) {
          const fallback = card.querySelector('.bookshelf-space-y-1')?.parentElement;
          if (fallback) fallback.append(nextDescription.cloneNode(true));
        } else {
          description.textContent = nextDescription.textContent;
        }
      } else if (description) {
        description.remove();
      }
    }

    const checkbox = card.querySelector('.volume-select');
    if (checkbox) {
      checkbox.value = card.dataset.volumeId || '';
      checkbox.setAttribute('name', 'volumeIds');
    }

    return true;
  }

  function validateCoverFile(form) {
      const coverFileInput = form?.querySelector('input[type="file"][name="coverFile"]');
      const coverFile = coverFileInput?.files?.[0];
      if (!coverFileInput) return true;
      coverFileInput.setCustomValidity('');
      if (coverFile) {
        const allowedName = /\.(jpe?g|png|gif)$/i.test(coverFile.name);
        const allowedType = !coverFile.type || ['image/jpeg', 'image/png', 'image/gif'].includes(coverFile.type);
        let message = '';
        if (!allowedName || !allowedType) {
          message = '표지 이미지는 JPG, PNG, GIF 파일만 선택할 수 있습니다.';
        } else if (coverFile.size > 8 * 1024 * 1024) {
          message = '표지 이미지 파일은 8MB 이하만 선택할 수 있습니다.';
        }
        coverFileInput.setCustomValidity(message);
        if (message) {
          coverFileInput.reportValidity();
          return false;
        }
      }
      return true;
  }

  function submitWithHistoryReplace(form, options = {}) {
    if (!form) return;
    const submitButton = form.querySelector('button[type="submit"]');
    const pendingLabel = options.pendingLabel || '저장 중...';
    const dialog = options.dialog || null;
    let isSubmitting = false;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isSubmitting || !validateCoverFile(form)) return;
      isSubmitting = true;
      isNavigatingAfterSubmit = true;

      if (submitButton) {
        submitButton.disabled = true;
        if (!submitButton.dataset['previousLabel']) {
          submitButton.dataset.previousLabel = submitButton.textContent || '';
        }
        submitButton.textContent = pendingLabel;
      }

      if (dialog) {
        closeDialog(dialog);
      }

      try {
        const response = await fetch(form.action, {
          method: (form.method || 'POST'),
          body: new FormData(form),
          headers: {
            'Accept': 'text/html'
          },
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'follow'
        });
        const responseUrl = new URL(response.url, window.location.origin);

        if (responseUrl.pathname.startsWith('/user/login') || response.status === 403 || response.status === 401) {
          throw new Error(`auth-failed:${response.status}`);
        }
        if (response.status !== 304 && !response.ok) {
          throw new Error(`save-failed:${response.status}`);
        }

        if (window.__sparkProgress?.hide) {
          window.__sparkProgress.hide(80);
        }
        const responseText = await response.text();
        const responseDocument = responseText
          ? new DOMParser().parseFromString(responseText, 'text/html')
          : null;
        const serverError = responseDocument?.querySelector('.bookshelf-toast-source[data-toast-kind="error"]')
          ?.textContent?.trim();
        if (serverError) {
          throw new Error(`server-message:${serverError}`);
        }
        const actionPath = new URL(form.action, window.location.origin).pathname;
        const isVolumeSubmit = /\/books\/\d+\/volumes\/\d+$/.test(actionPath);
        const isBookSubmit = /\/books\/\d+$/.test(actionPath);

        if (responseText && (isVolumeSubmit || isBookSubmit)) {
          const updated = isVolumeSubmit
            ? applyVolumeUpdateFromRefreshedHtml(responseText, actionPath.match(/\/volumes\/(\d+)$/)?.[1])
            : applyBookUpdateFromRefreshedHtml(responseText);
          if (updated) {
            const message = isVolumeSubmit ? '권 정보를 수정했습니다.' : '책 정보를 수정했습니다.';
            showToast(message, 'success');
          } else if (response.url) {
            window.location.replace(response.url);
            return;
          }
        } else if (response.url) {
          window.location.replace(response.url);
          return;
        }
      } catch (error) {
        if (error && error.message && error.message.startsWith('auth-failed')) {
          showToast('로그인이 필요합니다. 다시 로그인해 주세요.', 'error');
          return;
        }
        if (error && error.message && error.message.startsWith('server-message:')) {
          showToast(error.message.substring('server-message:'.length), 'error');
          return;
        }
        showToast('저장을 처리할 수 없습니다. 다시 시도해 주세요.', 'error');
        console.error('book-detail save failed', error);
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = submitButton.dataset.previousLabel || '저장';
          submitButton.dataset.previousLabel = '';
        }
        isNavigatingAfterSubmit = false;
        isSubmitting = false;
      }
    });
  }

  function bindBookDialog() {
    if (!bookCard || !bookDialog) return;
    const openBook = () => {
      if (isNavigatingAfterSubmit) return;
      document.getElementById('bookEditName').value = bookCard.dataset.bookName || '';
      document.getElementById('bookEditAuthor').value = bookCard.dataset.bookAuthor || '';
      document.getElementById('bookEditDescription').value = bookCard.dataset.bookDescription || '';
      document.getElementById('bookEditCover').value = bookCard.dataset.bookCover || '';
      const coverFileInput = document.getElementById('bookEditCoverFile');
      if (coverFileInput) {
        coverFileInput.value = '';
        coverFileInput.setCustomValidity('');
      }
      document.getElementById('bookEditType').value = bookCard.dataset.bookType || '';
      document.getElementById('bookEditTotalVolume').value = bookCard.dataset.bookTotalvolume || '';
      bookDialog.showModal();
      requestAnimationFrame(() => forceDialogTitleHorizontalLayout());
      requestAnimationFrame(() => focusDialogNonInput(bookDialog));
    };
    const bookCoverTrigger = bookCard.querySelector('[data-book-cover-trigger]');
    bookCoverTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      openBook();
    });
    bookCoverTrigger?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openBook();
      }
    });
    document.getElementById('bookEditClose')?.addEventListener('click', () => closeDialog(bookDialog));
    document.getElementById('bookEditCancel')?.addEventListener('click', () => closeDialog(bookDialog));
  }

  function bindVolumeCreation() {
    if (!volumeCreateDialog || !volumeCreateForm) return;
    const openButton = document.getElementById('openVolumeCreateDialog');
    const directCheckbox = document.getElementById('volumeCreateNonAladin');
    const aladinFields = document.getElementById('volumeCreateAladinFields');
    const directFields = document.getElementById('volumeCreateDirectFields');
    const queryInput = document.getElementById('volumeCreateSearchQuery');
    const searchButton = document.getElementById('volumeCreateSearchButton');
    const searchMessage = document.getElementById('volumeCreateSearchMessage');
    const searchResults = document.getElementById('volumeCreateSearchResults');
    const selectedIsbnInput = document.getElementById('volumeCreateSelectedIsbn');
    const nameInput = document.getElementById('volumeCreateName');
    const coverFileInput = document.getElementById('volumeCreateCoverFile');
    const seqInput = document.getElementById('volumeCreateSeq');
    const sideStoryInput = document.getElementById('volumeCreateSideStory');
    const submitButton = document.getElementById('volumeCreateSubmit');
    const defaultNextVolume = root.dataset.nextVolume || '1';
    let isSearching = false;

    const escapeHtml = (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

    function clearAladinSelection(message = '검색 후 추가할 권을 선택해 주세요.') {
      if (selectedIsbnInput) selectedIsbnInput.value = '';
      if (searchResults) searchResults.innerHTML = '';
      if (searchMessage) searchMessage.textContent = message;
    }

    function syncCreateMode() {
      const direct = directCheckbox?.checked === true;
      if (aladinFields) {
        aladinFields.hidden = direct;
        aladinFields.style.display = direct ? 'none' : '';
      }
      if (directFields) {
        directFields.hidden = !direct;
        directFields.style.display = direct ? 'grid' : 'none';
      }
      if (queryInput) queryInput.required = !direct;
      if (nameInput) nameInput.required = direct;
      if (coverFileInput && !direct) {
        coverFileInput.value = '';
        coverFileInput.setCustomValidity('');
      }
      if (submitButton) submitButton.textContent = direct ? '입력 정보로 추가' : '선택한 권 추가';
      clearAladinSelection();
    }

    function syncSideStory() {
      if (!seqInput) return;
      const sideStory = sideStoryInput?.checked === true;
      seqInput.disabled = sideStory;
      seqInput.required = !sideStory;
      if (sideStory) {
        seqInput.value = '';
        seqInput.placeholder = '외전은 권 번호 없음';
      } else {
        if (!seqInput.value) seqInput.value = defaultNextVolume;
        seqInput.placeholder = '';
      }
    }

    function renderSearchResults(items) {
      if (!searchResults) return;
      if (!items.length) {
        clearAladinSelection('알라딘 검색 결과가 없습니다.');
        return;
      }
      searchResults.innerHTML = items.map((item, index) => {
        const selectionKey = item.selectionKey || '';
        const selectable = item.selectable === true && selectionKey;
        const state = item.exists ? '이미 등록됨' : (selectable ? '선택 가능' : '등록 불가');
        return `
          <button type="button" class="bookshelf-panel w-full rounded-[16px] border bookshelf-px-3 bookshelf-py-3 text-left transition ${selectable ? 'hover:border-violet-300 hover:bg-violet-50' : 'cursor-not-allowed opacity-60'}" data-volume-create-option data-index="${index}" ${selectable ? '' : 'disabled'}>
            <div class="flex items-center bookshelf-gap-3">
              ${item.cover ? `<img src="${escapeHtml(item.cover)}" alt="" class="h-16 w-11 shrink-0 rounded-[8px] object-cover">` : '<div class="flex h-16 w-11 shrink-0 items-center justify-center rounded-[8px] bg-slate-100 text-[10px] text-slate-400">NO</div>'}
              <div class="min-w-0">
                <div class="line-clamp-2 text-sm font-semibold text-slate-900">${escapeHtml(item.title || '제목 없음')}</div>
                <div class="bookshelf-mt-1 text-xs text-slate-500">${escapeHtml(item.author || '저자 미입력')} · ISBN13 ${escapeHtml(item.isbn13 || '-')}</div>
                <div class="bookshelf-mt-1 text-xs font-semibold ${selectable ? 'text-violet-700' : 'text-slate-400'}">${state}</div>
              </div>
            </div>
          </button>`;
      }).join('');
      searchResults.querySelectorAll('[data-volume-create-option]').forEach((button) => {
        button.addEventListener('click', () => {
          const item = items[Number(button.dataset.index)];
          if (!item?.selectionKey || item.selectable !== true) return;
          selectedIsbnInput.value = item.selectionKey;
          searchResults.querySelectorAll('[data-volume-create-option]').forEach((option) => {
            option.classList.remove('ring-2', 'ring-violet-500', 'bg-violet-50');
          });
          button.classList.add('ring-2', 'ring-violet-500', 'bg-violet-50');
          if (searchMessage) searchMessage.textContent = `선택됨: ${item.title || item.isbn13}`;
        });
      });
      if (searchMessage) searchMessage.textContent = '추가할 권을 선택해 주세요.';
    }

    async function searchAladin() {
      const query = queryInput?.value.trim() || '';
      if (!query || isSearching) {
        queryInput?.reportValidity();
        return;
      }
      isSearching = true;
      clearAladinSelection('알라딘에서 검색 중입니다...');
      if (searchButton) {
        searchButton.disabled = true;
        searchButton.textContent = '검색 중...';
      }
      try {
        const response = await fetch(`/books/aladin-preview?name=${encodeURIComponent(query)}`, {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store'
        });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) throw new Error('로그인 상태를 확인해 주세요.');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || '알라딘 검색에 실패했습니다.');
        renderSearchResults(Array.isArray(payload.items) ? payload.items : []);
      } catch (error) {
        clearAladinSelection(error.message || '알라딘 검색에 실패했습니다.');
      } finally {
        isSearching = false;
        if (searchButton) {
          searchButton.disabled = false;
          searchButton.textContent = '검색';
        }
      }
    }

    openButton?.addEventListener('click', () => {
      volumeCreateForm.reset();
      if (queryInput) queryInput.value = bookName;
      if (seqInput) seqInput.value = defaultNextVolume;
      syncCreateMode();
      syncSideStory();
      volumeCreateDialog.showModal();
      requestAnimationFrame(() => focusDialogNonInput(volumeCreateDialog));
    });
    document.getElementById('volumeCreateClose')?.addEventListener('click', () => closeDialog(volumeCreateDialog));
    document.getElementById('volumeCreateCancel')?.addEventListener('click', () => closeDialog(volumeCreateDialog));
    directCheckbox?.addEventListener('change', syncCreateMode);
    sideStoryInput?.addEventListener('change', syncSideStory);
    queryInput?.addEventListener('input', () => clearAladinSelection());
    queryInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchAladin();
      }
    });
    searchButton?.addEventListener('click', searchAladin);
    volumeCreateForm.addEventListener('submit', (event) => {
      if (!validateCoverFile(volumeCreateForm)) {
        event.preventDefault();
        return;
      }
      if (directCheckbox?.checked !== true && !selectedIsbnInput?.value) {
        event.preventDefault();
        if (searchMessage) searchMessage.textContent = '추가할 알라딘 권을 선택해 주세요.';
        showToast('추가할 알라딘 권을 선택해 주세요.', 'error');
        return;
      }
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = '추가 중...';
      }
    });
    syncCreateMode();
    syncSideStory();
  }

  function bindVolumeDialog() {
    if (!volumeDialog || !volumeForm) return;
    const subtitle = document.getElementById('volumeEditSubtitle');
    const volumeEditTitle = document.getElementById('volumeEditTitle');
    const preview = document.getElementById('volumeEditPreview');
    const seqInput = document.getElementById('volumeEditSeq');
    const typeInput = document.getElementById('volumeEditType');
    const nameInput = document.getElementById('volumeEditName');
    const isbnInput = document.getElementById('volumeEditIsbn13');
    const priceInput = document.getElementById('volumeEditPrice');
    const coverInput = document.getElementById('volumeEditCover');
    const descriptionInput = document.getElementById('volumeEditDescription');
    const sideStoryInput = document.getElementById('volumeEditSideStory');
    const purchasedInput = document.getElementById('volumeEditPurchased');
    const noNeedToBuyInput = document.getElementById('volumeEditNoNeedToBuy');
    const mediaQueryMobile = window.matchMedia('(max-width: 640px)');

    function applyMobileVolumeEditTitle(seq, sideStory) {
      const isMobile = mediaQueryMobile.matches;
      if (volumeEditTitle) volumeEditTitle.textContent = isMobile ? '책 정보 수정' : '권 세부 내역 수정';
      if (subtitle) {
        subtitle.hidden = isMobile;
        if (isMobile) {
          subtitle.textContent = '';
        } else {
          subtitle.textContent = sideStory ? '외전 세부 내역을 수정합니다.' : `${seq || ''}권 세부 내역을 수정합니다.`;
        }
      }
    }

    function syncSideStoryState() {
      const sideStory = sideStoryInput?.checked === true;
      if (!seqInput) return;
      seqInput.disabled = sideStory;
      seqInput.required = !sideStory;
      seqInput.placeholder = sideStory ? '외전은 권 번호 없음' : '';
      if (sideStory) seqInput.value = '';
      applyMobileVolumeEditTitle(seqInput.value, sideStory);
    }

    document.querySelectorAll('[data-volume-card]').forEach((card) => {
      const checkbox = card.querySelector('.volume-select');
      if (checkbox) {
        checkbox.value = card.dataset.volumeId || '';
        checkbox.setAttribute('name', 'volumeIds');
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', syncDeleteButton);
      }

      const openDialog = () => {
        if (isNavigatingAfterSubmit) return;
        const sideStory = card.dataset.volumeSideStory === 'true';
        volumeForm.action = `/books/${bookId}/volumes/${card.dataset.volumeId}`;
        sideStoryInput.checked = sideStory;
        seqInput.value = sideStory ? '' : (card.dataset.volumeSeq || '');
        syncSideStoryState();
        typeInput.value = card.dataset.volumeType || '';
        nameInput.value = card.dataset.volumeName || '';
        isbnInput.value = card.dataset.volumeIsbn13 || '';
        priceInput.value = card.dataset.volumePrice || '';
        coverInput.value = card.dataset.volumeCover || '';
        descriptionInput.value = card.dataset.volumeDescription || '';
        purchasedInput.checked = card.dataset.volumePurchased === 'true';
        noNeedToBuyInput.checked = card.dataset.volumeNoNeedToBuy === 'true';
        preview.src = card.dataset.volumeCover || fallbackCover;
        volumeDialog.showModal();
        requestAnimationFrame(() => forceDialogTitleHorizontalLayout());
        requestAnimationFrame(() => focusDialogNonInput(volumeDialog));
      };

      const coverTrigger = card.querySelector('[data-volume-cover-trigger]');
      coverTrigger?.addEventListener('click', (event) => {
        event.stopPropagation();
        openDialog();
      });
      coverTrigger?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDialog();
        }
      });
    });

    coverInput?.addEventListener('input', () => { preview.src = coverInput.value || fallbackCover; });
    preview?.addEventListener('error', () => { preview.src = fallbackCover; });
    sideStoryInput?.addEventListener('change', syncSideStoryState);
    document.getElementById('volumeEditClose')?.addEventListener('click', () => closeDialog(volumeDialog));
    document.getElementById('volumeEditCancel')?.addEventListener('click', () => closeDialog(volumeDialog));
    mediaQueryMobile.addEventListener('change', () => {
      if (volumeDialog && volumeDialog.open) {
        applyMobileVolumeEditTitle(seqInput.value || '', sideStoryInput?.checked === true);
      }
    });
    syncDeleteButton();
  }

  function bindEditSubmit() {
    submitWithHistoryReplace(bookForm, {
      pendingLabel: '저장 중...',
      dialog: bookDialog
    });
    submitWithHistoryReplace(volumeForm, {
      pendingLabel: '저장 중...',
      dialog: volumeDialog
    });
  }

  function syncDeleteButton() {
    const deleteButton = document.getElementById('deleteCheckedVolumes');
    if (!deleteButton) return;
    const checked = document.querySelectorAll('.volume-select:checked').length;
    deleteButton.disabled = checked === 0;
    deleteButton.textContent = checked > 0 ? `${checked}개 삭제` : '삭제';
    deleteButton.classList.toggle('opacity-60', checked === 0);
  }

  function bindDeleteConfirm() {
    if (!deleteVolumesForm) return;
    deleteVolumesForm.addEventListener('submit', (event) => {
      const deleteButton = document.getElementById('deleteCheckedVolumes');
      const checked = document.querySelectorAll('.volume-select:checked').length;
      if (checked === 0) {
        event.preventDefault();
        showToast('삭제할 권을 먼저 선택해 주세요.', 'error');
        return;
      }
      const ok = window.confirm(`"${bookName}"에서 선택한 ${checked}개 권을 삭제하시겠습니까?\n삭제 후에는 되돌릴 수 없습니다.`);
      if (!ok) {
        event.preventDefault();
        showToast('권 삭제를 취소했습니다.', 'error');
        return;
      }
      sessionStorage.setItem(volumeDeleteStorageKey, 'pending');
      setDeleteButtonPending(deleteButton, true, '삭제 중...', `${checked}개 삭제`);
    });

    window.addEventListener('pageshow', () => {
      if (sessionStorage.getItem(volumeDeleteStorageKey)) {
        sessionStorage.removeItem(volumeDeleteStorageKey);
        resetVolumeSelection();
      }
    });
  }

  function bindDeleteBookConfirm() {
    if (!deleteBookForm) return;
    deleteBookForm.addEventListener('submit', (event) => {
      const deleteButton = document.getElementById('deleteBookButton');
      const ok = window.confirm(`"${bookName}" 책과 연결된 권 정보를 모두 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`);
      if (!ok) {
        event.preventDefault();
        showToast('도서 삭제를 취소했습니다.', 'error');
        return;
      }
      setDeleteButtonPending(deleteButton, true, '삭제 중...', '삭제');
    });
  }

  function bindEnrichBookInfo() {
    if (!enrichBookInfoForm) return;
    enrichBookInfoForm.addEventListener('submit', () => {
      setDeleteButtonPending(document.getElementById('enrichBookInfoButton'), true, '처리 중...', '저자/설명 넣기');
    });
  }

  bindBookDialog();
  bindVolumeCreation();
  bindVolumeDialog();
  bindEditSubmit();
  bindDeleteConfirm();
  bindDeleteBookConfirm();
  bindEnrichBookInfo();
  resetVolumeSelection();
})();
