(() => {
  const config = window.BookshelfBranchDashboard || {};

  initBranchChart(config);
  initStockRefreshProgress(config);

  function initBranchChart(config) {
    const rawLabels = Array.isArray(config.chartLabels) ? config.chartLabels : [];
    const rawBranches = Array.isArray(config.chartBranches) ? config.chartBranches : [];
    const data = Array.isArray(config.chartValues) ? config.chartValues : [];
    const chartWrap = document.getElementById('branchChartWrap');
    const canvas = document.getElementById('branchChart');
    let branchChart = null;

    const getBranchUrlByIndex = (index) => {
      const branch = rawBranches[index];
      return branch ? '/dashboard/branches/' + encodeURIComponent(String(branch).trim()) : null;
    };

    const navigateBranchFromChart = (index) => {
      const url = getBranchUrlByIndex(index);
      if (url) {
        window.location.href = url;
      }
    };

    const handleChartNavigation = (event, elements) => {
      const canvasRect = canvas?.getBoundingClientRect();
      if (!canvasRect) return;

      let index = null;
      if (Array.isArray(elements) && elements.length > 0) {
        index = elements[0].index;
      } else if (event && branchChart) {
        index = readYAxisIndex(event, canvasRect, branchChart);
      }

      if (index !== null && index >= 0 && index < rawLabels.length) {
        navigateBranchFromChart(index);
      }
    };

    const renderBranchChart = () => {
      if (!canvas || !chartWrap || !window.Chart || rawLabels.length === 0) return;

      const chartOptions = resolveChartOptions(rawLabels, data, chartWrap);
      const valueLabelPlugin = createValueLabelPlugin(data, chartOptions.tick, chartOptions.isMobile);

      if (branchChart) {
        branchChart.destroy();
      }

      branchChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: rawLabels.map(wrapLongLabel),
          datasets: [buildDataset(data, chartOptions)]
        },
        options: buildChartOptions(chartOptions, handleChartNavigation),
        plugins: [valueLabelPlugin]
      });
    };

    renderBranchChart();

    if (!canvas) return;

    let chartResizeTimer = null;
    window.addEventListener('resize', () => {
      if (chartResizeTimer) clearTimeout(chartResizeTimer);
      chartResizeTimer = window.setTimeout(renderBranchChart, 150);
    });

    canvas.addEventListener('click', (event) => {
      const elements = branchChart
        ? branchChart.getElementsAtEventForMode(event, 'nearest', { intersect: false }, false)
        : [];
      handleChartNavigation(event, elements);
    });
  }

  function initStockRefreshProgress(config) {
    const form = document.getElementById('refreshStocksForm');
    const view = {
      button: document.getElementById('refreshStocksButton'),
      bar: document.getElementById('refreshProgressBar'),
      percent: document.getElementById('refreshProgressPercent'),
      counts: document.getElementById('refreshProgressCounts'),
      message: document.getElementById('refreshProgressMessage'),
      processed: document.getElementById('refreshProcessed'),
      success: document.getElementById('refreshSuccess'),
      empty: document.getElementById('refreshEmpty'),
      fail: document.getElementById('refreshFail')
    };
    let pollTimer = null;
    let wasRunning = !!config.refreshRunning;

    const render = (progress) => renderRefreshProgress(progress, view);

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = window.setInterval(async () => {
        try {
          const response = await fetch('/dashboard/branches/refresh-progress', {
            headers: { 'Accept': 'application/json' }
          });
          if (!response.ok) return;

          const progress = await response.json();
          render(progress);

          if (wasRunning && !progress.running && (progress.completed || progress.failed)) {
            sessionStorage.setItem('branchRefreshToast', buildRefreshDoneMessage(progress));
            window.location.reload();
            return;
          }

          wasRunning = !!progress.running;
          if (!progress.running) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        } catch (error) {
          console.error('refresh progress polling error', error);
        }
      }, 1500);
    };

    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const payload = await postRefreshStart(form);
          if (payload.progress) {
            render(payload.progress);
            wasRunning = !!payload.progress.running;
          }
          if (payload.message && view.message) {
            view.message.textContent = payload.message;
          }
          if (!payload.started) {
            if (payload.progress?.failed) {
              showRefreshToast(payload.message || payload.progress.message || '일괄 갱신을 시작할 수 없습니다.', 'error');
            }
            if (payload.progress?.running) {
              startPolling();
            }
            return;
          }
          startPolling();
        } catch (error) {
          console.error('refresh stocks start error', error);
          showRefreshToast(error.message || '일괄 갱신 시작 중 오류가 발생했습니다.', 'error');
          if (view.message) {
            view.message.textContent = '일괄 갱신 시작 중 오류가 발생했습니다.';
          }
        }
      });
    }

    if (wasRunning) {
      startPolling();
    }
  }

  function resolveChartOptions(rawLabels, data, chartWrap) {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const rowHeight = isMobile ? 46 : 54;
    const baseHeight = isMobile ? 640 : 640;
    const chartHeight = Math.max(baseHeight, (rawLabels.length * rowHeight) + (isMobile ? 150 : 120));
    chartWrap.style.height = `${chartHeight}px`;
    chartWrap.style.minHeight = `${chartHeight}px`;

    const styles = getComputedStyle(document.documentElement);
    const tick = styles.getPropertyValue('--bk-text-soft').trim() || '#777';
    const grid = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'rgba(255,255,255,0.08)'
      : 'rgba(120,120,120,0.08)';
    const palette = ['#7c5cff', '#38bdf8', '#fb923c', '#34d399', '#f472b6', '#facc15', '#60a5fa', '#a3e635'];
    const colors = rawLabels.map((_, idx) => palette[idx % palette.length]);

    return { isMobile, tick, grid, colors };
  }

  function wrapLongLabel(label) {
    const text = String(label ?? '');
    if (text.length <= 10) return text;
    const mid = Math.ceil(text.length / 2);
    return [text.slice(0, mid), text.slice(mid)];
  }

  function buildDataset(data, chartOptions) {
    const isMobile = chartOptions.isMobile;
    return {
      label: '총 금액',
      data,
      backgroundColor: chartOptions.colors.map((color) => color + 'CC'),
      borderColor: chartOptions.colors,
      borderWidth: 1,
      borderRadius: 10,
      barThickness: isMobile ? 18 : 18,
      maxBarThickness: isMobile ? 22 : 22,
      categoryPercentage: isMobile ? 0.76 : 0.72,
      barPercentage: isMobile ? 0.86 : 0.84
    };
  }

  function buildChartOptions(chartOptions, handleChartNavigation) {
    const isMobile = chartOptions.isMobile;
    return {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => Number(context.raw ?? 0).toLocaleString() + '원'
          }
        }
      },
      onClick: (event, elements) => handleChartNavigation(event.native || event, elements),
      layout: {
        padding: { left: isMobile ? 6 : 12, right: isMobile ? 88 : 90, top: isMobile ? 18 : 12, bottom: isMobile ? 18 : 12 }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            color: chartOptions.tick,
            stepSize: 250000,
            callback: (value) => Number(value).toLocaleString() + '원',
            font: { size: isMobile ? 11 : 12 }
          },
          grid: { color: chartOptions.grid }
        },
        y: {
          ticks: {
            color: chartOptions.tick,
            autoSkip: false,
            crossAlign: 'far',
            padding: isMobile ? 12 : 14,
            font: { size: isMobile ? 11 : 12, weight: '600' }
          },
          grid: { display: false }
        }
      }
    };
  }

  function createValueLabelPlugin(data, tick, isMobile) {
    return {
      id: 'valueLabelPlugin',
      afterDatasetsDraw(chart) {
        try {
          const { ctx } = chart;
          const meta = chart.getDatasetMeta(0);
          ctx.save();
          ctx.fillStyle = tick;
          ctx.font = isMobile ? '600 11px sans-serif' : '600 12px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          meta.data.forEach((bar, index) => {
            const value = data[index] ?? 0;
            const label = `${Number(value).toLocaleString()}원`;
            const x = typeof bar.x === 'number' ? bar.x : 0;
            const y = typeof bar.y === 'number' ? bar.y : 0;
            const offset = isMobile ? 8 : 10;
            ctx.fillText(label, x + offset, y);
          });
          ctx.restore();
        } catch (error) {
          console.error('branch chart label plugin error', error);
        }
      }
    };
  }

  function readYAxisIndex(event, canvasRect, branchChart) {
    const y = event.clientY - canvasRect.top;
    const yScale = branchChart.scales && branchChart.scales.y;
    if (!yScale || typeof yScale.getValueForPixel !== 'function') {
      return null;
    }

    const rounded = Math.round(yScale.getValueForPixel(y));
    return Number.isInteger(rounded) ? rounded : null;
  }

  function renderRefreshProgress(progress, view) {
    if (!progress || !hasRefreshView(view)) return;

    const total = Number(progress.total || 0);
    const done = Number(progress.processed || 0);
    const pct = Number(progress.percent || 0);
    view.bar.style.width = `${pct}%`;
    view.percent.textContent = `${pct}%`;
    view.counts.textContent = `${done} / ${total}`;
    view.message.textContent = progress.message || '진행 상태를 불러오는 중입니다.';
    view.processed.textContent = String(done);
    view.success.textContent = String(progress.success || 0);
    view.empty.textContent = String(progress.empty || 0);
    view.fail.textContent = String(progress.fail || 0);

    if (view.button) {
      view.button.disabled = !!progress.running;
      view.button.textContent = progress.running ? '갱신 진행 중...' : '중고 일괄 갱신 시작';
    }
  }

  function hasRefreshView(view) {
    return !!(view.bar && view.percent && view.counts && view.message && view.processed && view.success && view.empty && view.fail);
  }

  function buildRefreshDoneMessage(progress) {
    if (!progress.completed) {
      return progress.message || '일괄 갱신 중 오류가 발생했습니다.';
    }
    return `일괄 갱신 완료 총 ${progress.total}권 중 ${progress.success}권 성공, ${progress.empty}권 재고없음, ${progress.fail}권 실패`;
  }

  function showRefreshToast(message, kind = 'success') {
    const text = String(message || '').trim();
    if (!text) return;

    const host = ensureRefreshToastHost();
    const toast = document.createElement('div');
    toast.className = `bookshelf-toast ${kind === 'error' ? 'bookshelf-toast-error' : 'bookshelf-toast-success'}`;
    toast.textContent = text;
    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 240);
    }, 2600);
  }

  function ensureRefreshToastHost() {
    let host = document.getElementById('bookshelf-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bookshelf-toast-host';
      host.className = 'bookshelf-toast-host';
      document.body.appendChild(host);
    }
    return host;
  }

  async function postRefreshStart(form) {
    const response = await fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { 'Accept': 'application/json' }
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new Error('일괄 갱신 응답을 해석할 수 없습니다.');
      }
    }
    if (!response.ok) {
      throw new Error(payload.message || '일괄 갱신 시작 중 오류가 발생했습니다.');
    }
    return payload;
  }
})();
