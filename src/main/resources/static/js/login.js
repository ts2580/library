(() => {
  const form = document.getElementById('login-form');
  if (!form) return;

  const feedback = document.getElementById('login-feedback');
  const button = form.querySelector('button[type="submit"]');
  let submitting = false;

  async function submit(body) {
    const response = await fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
      body,
    });
    return { response, result: await response.json() };
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    feedback.hidden = true;
    window.__sparkProgress?.show?.();

    try {
      // Keep the submitted credentials only in memory throughout this attempt.
      const body = new URLSearchParams(new FormData(form));
      let outcome = await submit(body);
      if (outcome.response.status === 403 && outcome.result.error === 'csrf') {
        const refresh = await fetch(form.dataset.csrfUrl, {
          credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          headers: { 'Accept': 'application/json' },
        });
        if (!refresh.ok) throw new Error('Token refresh failed');
        const csrf = await refresh.json();
        const tokenInputs = Array.from(form.querySelectorAll('input[type="hidden"]'))
          .filter(input => input.name === csrf.parameterName);
        if (!tokenInputs.length || typeof csrf.token !== 'string' || !csrf.token) {
          throw new Error('Invalid token response');
        }
        tokenInputs.forEach(input => { input.value = csrf.token; });
        body.set(csrf.parameterName, csrf.token);
        // Only an explicit CSRF rejection is safe to retry, and only once.
        outcome = await submit(body);
      }

      if (outcome.response.ok && outcome.result.authenticated === true) {
        form.elements.password.value = '';
        window.location.assign(form.dataset.successUrl);
        return;
      }
      feedback.textContent = outcome.response.status === 401 && outcome.result.error === 'credentials'
        ? '아이디 또는 비밀번호가 일치하지 않습니다.'
        : '로그인을 완료하지 못했습니다. 다시 시도해 주세요.';
      feedback.hidden = false;
    } catch {
      feedback.textContent = '로그인 요청을 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.';
      feedback.hidden = false;
    } finally {
      submitting = false;
      button.disabled = false;
      form.removeAttribute('aria-busy');
      window.__sparkProgress?.hide?.(80);
    }
  });
})();
