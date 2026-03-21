(() => {
  const forms = document.querySelectorAll('.product-import-form');
  forms.forEach((form) => {
    const input = form.querySelector('.target-book-search');
    const hidden = form.querySelector('.target-book-id');
    const results = form.querySelector('.target-book-results');
    if (!input || !hidden || !results) return;

    let timer = null;
    let items = [];
    let highlightedIndex = -1;
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

    const clearHighlight = () => {
      highlightedIndex = -1;
      input.removeAttribute('aria-activedescendant');
    };

    const hide = () => {
      results.classList.add('hidden');
      results.innerHTML = '';
      items = [];
      clearHighlight();
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
      hide();
      input.focus();
    };

    const renderItems = (items) => {
      if (!items.length) {
        results.innerHTML = '<div class="rounded-[14px] px-3 py-3 text-xs text-slate-500">일치하는 책이 없어요.</div>';
        results.classList.remove('hidden');
        clearHighlight();
        setExpanded(true);
        return;
      }

      results.innerHTML = items.map((item) => {
        const meta = [
          `#${item.id}`,
          item.author || '-',
          item.type || '타입없음',
          item.totalvolume ? `총 ${item.totalvolume}권` : '총권수 미입력',
          item.createddate ? `최근 수정 ${item.createddate}` : null
        ].filter(Boolean).join(' · ');

        const label = `${item.name} / ${item.author || '-'}${item.type ? ' / ' + item.type : ''}`;
        return `
          <button type="button"
            id="${listboxId}-option-${item.id}"
            class="target-book-option blko-panel w-full rounded-[16px] border border-transparent px-3 py-3 text-left transition hover:border-slate-200 hover:bg-slate-50"
            role="option"
            aria-selected="false"
            data-id="${item.id}"
            data-label="${escapeHtml(label)}"
            data-index="${items.indexOf(item)}">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-slate-900">${escapeHtml(item.name)}</div>
                <div class="mt-1 truncate text-xs text-slate-500">${escapeHtml(item.author || '저자 미입력')}</div>
              </div>
              <div class="shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500">${escapeHtml(item.type || '타입없음')}</div>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
              <span class="rounded-full bg-slate-100 px-2 py-1">#${escapeHtml(item.id)}</span>
              <span class="rounded-full bg-slate-100 px-2 py-1">${escapeHtml(item.totalvolume ? `총 ${item.totalvolume}권` : '총권수 미입력')}</span>
              ${item.createddate ? `<span class="rounded-full bg-slate-100 px-2 py-1">${escapeHtml(`최근 수정 ${item.createddate}`)}</span>` : ''}
            </div>
            <div class="mt-2 text-[11px] text-slate-400">Enter로 선택</div>
          </button>
        `;
      }).join('');
      results.classList.remove('hidden');
      setExpanded(true);
      highlightedIndex = 0;
      applyHighlight();

      results.querySelectorAll('.target-book-option').forEach((button) => {
        button.addEventListener('mouseenter', () => {
          highlightedIndex = Number(button.dataset.index);
          applyHighlight();
        });
        button.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          selectItem(items[Number(button.dataset.index)]);
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
    });
  });
})();
