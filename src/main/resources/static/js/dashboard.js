(() => {
  const config = window.BookshelfDashboard || {};
  const labels = Array.isArray(config.categoryLabels) ? config.categoryLabels : [];
  const counts = Array.isArray(config.categoryCounts) ? config.categoryCounts.map(Number) : [];
  const amounts = Array.isArray(config.categoryAmounts) ? config.categoryAmounts.map(Number) : [];
  const wrap = document.getElementById('categoryChartWrap');
  const canvas = document.getElementById('categoryChart');

  if (!wrap || !canvas || !window.Chart || labels.length === 0) return;

  const render = () => {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const rowHeight = isMobile ? 42 : 54;
    const chartHeight = Math.max(isMobile ? 340 : 420, (labels.length * rowHeight) + 96);
    wrap.style.height = `${chartHeight}px`;
    wrap.style.minHeight = `${chartHeight}px`;

    const styles = getComputedStyle(document.documentElement);
    const tick = styles.getPropertyValue('--bk-text-soft').trim() || '#777';
    const grid = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'rgba(255,255,255,0.08)'
      : 'rgba(120,120,120,0.08)';

    if (canvas.dataset.chartReady && window.bookshelfCategoryChart) {
      window.bookshelfCategoryChart.destroy();
    }

    window.bookshelfCategoryChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels.map(wrapLongLabel),
        datasets: [
          {
            label: '권수',
            data: counts,
            xAxisID: 'xCount',
            backgroundColor: 'rgba(56, 189, 248, 0.72)',
            borderColor: '#38bdf8',
            borderWidth: 1,
            borderRadius: 8,
            barThickness: isMobile ? 12 : 16
          },
          {
            label: '금액',
            data: amounts,
            xAxisID: 'xAmount',
            backgroundColor: 'rgba(251, 146, 60, 0.62)',
            borderColor: '#fb923c',
            borderWidth: 1,
            borderRadius: 8,
            barThickness: isMobile ? 12 : 16
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: {
            labels: { color: tick, boxWidth: 12, boxHeight: 12 }
          },
          tooltip: {
            callbacks: {
              label(context) {
                const value = Number(context.raw || 0);
                return context.dataset.label === '금액'
                  ? `금액 ${value.toLocaleString()}원`
                  : `권수 ${value.toLocaleString()}권`;
              }
            }
          }
        },
        layout: {
          padding: { left: isMobile ? 8 : 12, right: isMobile ? 8 : 16, top: 8, bottom: 8 }
        },
        scales: {
          xCount: {
            beginAtZero: true,
            position: 'bottom',
            ticks: {
              color: tick,
              precision: 0,
              callback: (value) => Number(value).toLocaleString() + '권'
            },
            grid: { color: grid }
          },
          xAmount: {
            beginAtZero: true,
            position: 'top',
            ticks: {
              color: tick,
              callback: (value) => Number(value).toLocaleString() + '원'
            },
            grid: { display: false }
          },
          y: {
            ticks: {
              color: tick,
              autoSkip: false,
              padding: isMobile ? 8 : 12,
              font: { size: isMobile ? 10 : 12, weight: '600' }
            },
            grid: { display: false }
          }
        }
      }
    });
    canvas.dataset.chartReady = 'true';
  };

  render();

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(render, 150);
  });

  function wrapLongLabel(label) {
    const text = String(label ?? '');
    if (text.length <= 10) return text;
    const mid = Math.ceil(text.length / 2);
    return [text.slice(0, mid), text.slice(mid)];
  }
})();
