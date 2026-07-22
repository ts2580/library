(() => {
  const COVER_ARCHIVE_CHUNK_BYTES = 8 * 1024 * 1024;
  const COVER_ARCHIVE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

  const showToast = (message, kind = 'success') => {
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
    }, 5000);
  };

  const createUploadId = () => {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

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

  document.querySelector('[data-cover-archive-upload-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const confirmed = window.confirm('선택한 표지 ZIP을 현재 계정의 커버 저장소에 복원하시겠습니까?');
    if (!confirmed) return;

    const form = event.currentTarget;
    const fileInput = form.querySelector('input[name="coverArchive"]');
    const file = fileInput?.files?.[0];
    if (!file) {
      showToast('업로드할 표지 ZIP 파일을 선택해 주세요.', 'error');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      showToast('표지 백업은 .zip 파일만 업로드할 수 있습니다.', 'error');
      return;
    }
    if (file.size <= 0 || file.size > COVER_ARCHIVE_MAX_BYTES) {
      showToast('표지 ZIP 파일은 2GB 이하만 업로드할 수 있습니다.', 'error');
      return;
    }

    const button = form.querySelector('[data-cover-archive-upload-button]');
    const progress = form.querySelector('[data-cover-archive-upload-progress]');
    const status = form.querySelector('[data-cover-archive-upload-status]');
    const percentLabel = form.querySelector('[data-cover-archive-upload-percent]');
    const progressBar = form.querySelector('[data-cover-archive-upload-bar]');
    const csrf = form.querySelector('input[type="hidden"]');
    const uploadId = createUploadId();
    const totalChunks = Math.ceil(file.size / COVER_ARCHIVE_CHUNK_BYTES);

    const updateProgress = (percent, message) => {
      const normalized = Math.max(0, Math.min(100, percent));
      if (progress) progress.hidden = false;
      if (status) status.textContent = message;
      if (percentLabel) percentLabel.textContent = `${normalized}%`;
      if (progressBar) progressBar.style.width = `${normalized}%`;
    };

    const sendChunk = async (chunkIndex) => {
      const start = chunkIndex * COVER_ARCHIVE_CHUNK_BYTES;
      const chunk = file.slice(start, Math.min(file.size, start + COVER_ARCHIVE_CHUNK_BYTES));
      const body = new FormData();
      body.append('chunk', chunk, `${file.name}.part-${chunkIndex}`);
      body.append('uploadId', uploadId);
      body.append('originalFilename', file.name);
      body.append('totalSize', String(file.size));
      body.append('totalChunks', String(totalChunks));
      body.append('chunkIndex', String(chunkIndex));
      if (csrf?.name) body.append(csrf.name, csrf.value);

      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await fetch('/user/profile/covers/archive/upload/chunk', {
            method: 'POST',
            body,
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
          });
          let result;
          try {
            result = await response.json();
          } catch (ignored) {
            result = null;
          }
          if (!response.ok || !result?.success) {
            const error = new Error(result?.message || `청크 업로드에 실패했습니다. (${response.status})`);
            error.retryable = response.status >= 500;
            throw error;
          }
          return result;
        } catch (error) {
          lastError = error;
          if (error.retryable === false || attempt === 3) break;
          await wait(attempt * 600);
        }
      }
      throw lastError || new Error('청크 업로드에 실패했습니다.');
    };

    const waitForRestore = async () => {
      const statusUrl = `/user/profile/covers/archive/upload/chunk/status?uploadId=${encodeURIComponent(uploadId)}`;
      for (let attempt = 0; attempt < 1800; attempt++) {
        const response = await fetch(statusUrl, {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' }
        });
        let result;
        try {
          result = await response.json();
        } catch (ignored) {
          result = null;
        }
        if (!response.ok || !result?.success) {
          throw new Error(result?.message || `표지 복원 상태를 확인하지 못했습니다. (${response.status})`);
        }
        updateProgress(result.percent, result.message);
        if (result.completed) return result;
        await wait(1000);
      }
      throw new Error('표지 복원 대기 시간이 초과되었습니다. 서버 로그를 확인해 주세요.');
    };

    if (button) {
      button.disabled = true;
      button.textContent = '표지 ZIP 업로드 중...';
    }
    window.__sparkProgress?.show?.();
    updateProgress(0, `0 / ${totalChunks} 청크`);

    try {
      let result = null;
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const nextPercent = Math.floor((chunkIndex / totalChunks) * 100);
        updateProgress(nextPercent, `${chunkIndex + 1} / ${totalChunks} 청크 업로드 중`);
        result = await sendChunk(chunkIndex);
        updateProgress(result.percent, result.completed ? '표지 복원 완료' : result.message);
      }
      if (result?.processing) {
        result = await waitForRestore();
      }
      if (!result?.completed) {
        throw new Error('모든 청크를 전송했지만 표지 복원이 완료되지 않았습니다.');
      }
      updateProgress(100, '표지 복원 완료');
      fileInput.value = '';
      showToast(result.message, 'success');
    } catch (error) {
      updateProgress(0, '업로드 실패');
      showToast(error.message || '표지 ZIP 업로드 중 오류가 발생했습니다.', 'error');
    } finally {
      window.__sparkProgress?.hide?.(80);
      if (button) {
        button.disabled = false;
        button.textContent = '표지 압축 복원';
      }
    }
  });

  document.querySelector('[data-cover-regenerate-form]')?.addEventListener('submit', (event) => {
    const confirmed = window.confirm('현재 계정의 미생성 커버를 순서대로 생성하시겠습니까?');
    if (!confirmed) event.preventDefault();
  });
})();
