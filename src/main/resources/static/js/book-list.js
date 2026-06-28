(() => {
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
})();
