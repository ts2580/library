(() => {
  const description = document.querySelector('[data-profile-description]');
  const descriptionCount = document.querySelector('[data-profile-description-count]');

  const updateDescriptionCount = () => {
    if (!description || !descriptionCount) return;
    descriptionCount.textContent = `${description.value.length.toLocaleString('ko-KR')} / 2,000`;
  };

  description?.addEventListener('input', updateDescriptionCount);
  updateDescriptionCount();

  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    const input = document.getElementById(button.dataset.passwordToggle);
    if (!input) return;

    button.addEventListener('click', () => {
      const shouldShow = input.type === 'password';
      input.type = shouldShow ? 'text' : 'password';
      button.textContent = shouldShow ? '숨김' : '보기';

      const fieldName = input.labels?.[0]?.textContent?.trim() || '비밀번호';
      const action = shouldShow ? '숨기기' : '표시';
      button.setAttribute('aria-label', `${fieldName} ${action}`);
      button.setAttribute('title', `${fieldName} ${action}`);
    });
  });
})();
