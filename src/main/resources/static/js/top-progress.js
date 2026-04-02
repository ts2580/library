(function () {
    const BAR_ID = 'top-progress-bar';
    let hideTimer = null;

    function ensureBar() {
        let bar = document.getElementById(BAR_ID);
        if (!bar) {
            bar = document.createElement('div');
            bar.id = BAR_ID;
            bar.setAttribute('aria-hidden', 'true');
            document.body.prepend(bar);
        }
        return bar;
    }

    function show() {
        const bar = ensureBar();
        window.clearTimeout(hideTimer);
        bar.classList.add('is-visible');
    }

    function hide(delay) {
        const bar = document.getElementById(BAR_ID);
        if (!bar) {
            return;
        }
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
            bar.classList.remove('is-visible');
        }, typeof delay === 'number' ? delay : 220);
    }

    function isModifiedEvent(event) {
        return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    }

    window.__sparkProgress = { show, hide };

    document.addEventListener('DOMContentLoaded', () => {
        ensureBar();
        hide(80);

        document.addEventListener('click', (event) => {
            const target = event.target.closest('a, button[type="submit"], input[type="submit"]');
            if (!target || isModifiedEvent(event)) {
                return;
            }
            if (target.tagName === 'A') {
                const href = target.getAttribute('href');
                const targetAttr = target.getAttribute('target');
                if (!href || href.startsWith('#') || href.startsWith('javascript:') || targetAttr === '_blank') {
                    return;
                }
            }
            show();
        }, true);

        document.addEventListener('submit', (event) => {
            if (!event.defaultPrevented) {
                show();
            }
        }, true);

        window.addEventListener('beforeunload', show);
        window.addEventListener('pageshow', () => hide(160));
        window.addEventListener('load', () => hide(160));
    });
})();
