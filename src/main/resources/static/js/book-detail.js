(() => {
  const root = document.getElementById('bookDetailPage');
  if (!root) return;

  const bookId = root.dataset.bookId;
  const bookName = root.dataset.bookName || '이 책';
  const fallbackCover = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 360"><rect width="240" height="360" fill="#e5e7eb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-size="18" font-family="sans-serif">NO COVER</text></svg>');
  const volumeDeleteStorageKey = `book-detail:${bookId}:volume-delete`;

  const bookCard = document.getElementById('bookInfoCard');
  const bookDialog = document.getElementById('bookEditDialog');
  const volumeDialog = document.getElementById('volumeEditDialog');
  const volumeForm = document.getElementById('volumeEditForm');
  const deleteVolumesForm = document.getElementById('deleteVolumesForm');
  const deleteBookForm = document.getElementById('deleteBookForm');

  function closeDialog(dialog) {
    if (dialog && dialog.open) dialog.close();
  }

  function showToast(message, kind = 'success') {
    const text = (message || '').trim();
    if (!text) return;
    let host = document.getElementById('blko-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'blko-toast-host';
      host.className = 'blko-toast-host';
      document.body.appendChild(host);
    }

    const toast = document.createElement('div');
    toast.className = `blko-toast ${kind === 'error' ? 'blko-toast-error' : 'blko-toast-success'}`;
    toast.textContent = text;
    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 240);
    }, 2200);
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

  function bindBookDialog() {
    if (!bookCard || !bookDialog) return;
    const openBook = () => {
      document.getElementById('bookEditName').value = bookCard.dataset.bookName || '';
      document.getElementById('bookEditAuthor').value = bookCard.dataset.bookAuthor || '';
      document.getElementById('bookEditDescription').value = bookCard.dataset.bookDescription || '';
      document.getElementById('bookEditCover').value = bookCard.dataset.bookCover || '';
      document.getElementById('bookEditType').value = bookCard.dataset.bookType || '';
      document.getElementById('bookEditTotalVolume').value = bookCard.dataset.bookTotalvolume || '';
      bookDialog.showModal();
    };
    bookCard.addEventListener('click', (e) => {
      if (e.target.closest('a,button,form,input')) return;
      openBook();
    });
    document.getElementById('bookEditClose')?.addEventListener('click', () => closeDialog(bookDialog));
    document.getElementById('bookEditCancel')?.addEventListener('click', () => closeDialog(bookDialog));
  }

  function bindVolumeDialog() {
    if (!volumeDialog || !volumeForm) return;
    const subtitle = document.getElementById('volumeEditSubtitle');
    const preview = document.getElementById('volumeEditPreview');
    const seqInput = document.getElementById('volumeEditSeq');
    const typeInput = document.getElementById('volumeEditType');
    const nameInput = document.getElementById('volumeEditName');
    const isbnInput = document.getElementById('volumeEditIsbn13');
    const priceInput = document.getElementById('volumeEditPrice');
    const coverInput = document.getElementById('volumeEditCover');
    const purchasedInput = document.getElementById('volumeEditPurchased');

    document.querySelectorAll('[data-volume-card]').forEach((card) => {
      const checkbox = card.querySelector('.volume-select');
      if (checkbox) {
        checkbox.value = card.dataset.volumeId || '';
        checkbox.setAttribute('name', 'volumeIds');
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', syncDeleteButton);
      }

      const openDialog = () => {
        volumeForm.action = `/books/${bookId}/volumes/${card.dataset.volumeId}`;
        subtitle.textContent = `${card.dataset.volumeSeq || ''}권 세부 내역을 수정해요.`;
        seqInput.value = card.dataset.volumeSeq || '';
        typeInput.value = card.dataset.volumeType || '';
        nameInput.value = card.dataset.volumeName || '';
        isbnInput.value = card.dataset.volumeIsbn13 || '';
        priceInput.value = card.dataset.volumePrice || '';
        coverInput.value = card.dataset.volumeCover || '';
        purchasedInput.checked = card.dataset.volumePurchased === 'true';
        preview.src = card.dataset.volumeCover || fallbackCover;
        volumeDialog.showModal();
      };

      card.addEventListener('click', openDialog);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDialog();
        }
      });
    });

    coverInput?.addEventListener('input', () => { preview.src = coverInput.value || fallbackCover; });
    preview?.addEventListener('error', () => { preview.src = fallbackCover; });
    document.getElementById('volumeEditClose')?.addEventListener('click', () => closeDialog(volumeDialog));
    document.getElementById('volumeEditCancel')?.addEventListener('click', () => closeDialog(volumeDialog));
    syncDeleteButton();
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
      const ok = window.confirm(`"${bookName}"에서 선택한 ${checked}개 권을 삭제할까요?\n삭제 후에는 되돌릴 수 없어요.`);
      if (!ok) {
        event.preventDefault();
        showToast('권 삭제를 취소했어요.', 'error');
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
      const ok = window.confirm(`"${bookName}" 책과 연결된 권 정보를 모두 삭제할까요?\n삭제 후에는 복구할 수 없어요.`);
      if (!ok) {
        event.preventDefault();
        showToast('도서 삭제를 취소했어요.', 'error');
        return;
      }
      setDeleteButtonPending(deleteButton, true, '삭제 중...', '삭제');
    });
  }

  bindBookDialog();
  bindVolumeDialog();
  bindDeleteConfirm();
  bindDeleteBookConfirm();
  resetVolumeSelection();
})();
