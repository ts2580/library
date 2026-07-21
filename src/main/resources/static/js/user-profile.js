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

  document.querySelector('[data-backup-upload-form]')?.addEventListener('submit', (event) => {
    const confirmed = window.confirm('선택한 엑셀 데이터를 현재 계정의 책장에 병합하시겠습니까?');
    if (!confirmed) event.preventDefault();
  });

  document.querySelector('[data-cover-archive-upload-form]')?.addEventListener('submit', (event) => {
    const confirmed = window.confirm('선택한 표지 ZIP을 현재 계정의 커버 저장소에 복원하시겠습니까?');
    if (!confirmed) event.preventDefault();
  });

  document.querySelector('[data-cover-regenerate-form]')?.addEventListener('submit', (event) => {
    const confirmed = window.confirm('현재 계정의 미생성 커버를 순서대로 생성하시겠습니까?');
    if (!confirmed) event.preventDefault();
  });
})();
