(() => {
  const host = document.querySelector('[data-next-migration]');
  if (!host) return;
  const form = host.querySelector('[data-next-migration-form]');
  const button = host.querySelector('[data-next-migration-start]');
  const status = host.querySelector('[data-next-migration-status]');
  const progress = host.querySelector('[data-next-migration-progress]');
  const result = host.querySelector('[data-next-migration-result]');
  const link = host.querySelector('[data-next-migration-link]');
  let timer;
  function render(value) {
    status.textContent = !value.available && value.phase === 'IDLE'
      ? '마이그레이션용 Next.js 패키지를 먼저 설치해 주세요.' : value.message;
    progress.value = value.percent;
    button.disabled = !value.available || value.running || ['COMPLETED', 'BLOCKED'].includes(value.phase);
    button.textContent = value.phase === 'COMPLETED' ? '이전 완료' : value.phase === 'INTERRUPTED' ? '새 책장 다시 시작' : value.running ? '이전 진행 중' : '새 책장으로 이전';
    link.hidden = value.phase !== 'COMPLETED';
    link.style.display = link.hidden ? 'none' : '';
    if (!link.hidden) {
      const target = new URL(value.publicUrl || `http://${window.location.hostname}:${value.port}`);
      if (['http:', 'https:'].includes(target.protocol)) { target.pathname = '/login'; link.href = target.href; }
    }
    if (value.report) {
      result.hidden = false;
      result.textContent = `도서 ${value.report.after.books.toLocaleString('ko-KR')}개 · 권 ${value.report.after.book_volumes.toLocaleString('ko-KR')}개 · 표지 ${value.report.coverFiles.toLocaleString('ko-KR')}개 이전. 기존 누락 표지 ${value.report.missingCovers}건.`;
    }
  }
  async function poll() {
    clearTimeout(timer);
    try {
      const response = await fetch('/user/profile/next-migration/status', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('이전 상태를 조회하지 못했습니다. 다시 로그인하거나 새로고침해 주세요.');
      render(await response.json());
    } catch (error) { status.textContent = error.message; }
    timer = setTimeout(poll, 2500);
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); button.disabled = true;
    clearTimeout(timer);
    try {
      const response = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('다시 로그인한 뒤 이전을 시작해 주세요.');
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '이전을 시작하지 못했습니다.');
      render(value);
    } catch (error) { status.textContent = error.message; button.disabled = false; }
    timer = setTimeout(poll, 1000);
  });
  poll();
})();
