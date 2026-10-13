// charts.js — Chart.js helpers
window.chartInstances = {};

function _destroyChart(id) {
  if (window.chartInstances[id]) {
    window.chartInstances[id].destroy();
    delete window.chartInstances[id];
  }
}

function createLineChart(canvasId, labels, datasets, options = {}) {
  _destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: datasets.length > 1 } },
      scales: {
        x: { grid: { color: 'rgba(100,116,139,.15)' }, ticks: { font: { size: 11 }, maxTicksLimit: 10 } },
        y: { grid: { color: 'rgba(100,116,139,.15)' }, ticks: { font: { size: 11 }, callback: v => '₦' + v.toLocaleString() } }
      },
      ...options
    }
  });
  window.chartInstances[canvasId] = chart;
  return chart;
}

function createBarChart(canvasId, labels, data, label = 'Revenue', color = '#2563eb') {
  _destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label, data, backgroundColor: color + 'cc', borderColor: color, borderWidth: 1, borderRadius: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: 'rgba(100,116,139,.15)' }, ticks: { font: { size: 11 }, callback: v => '₦' + v.toLocaleString() } }
      }
    }
  });
  window.chartInstances[canvasId] = chart;
  return chart;
}

function createDoughnutChart(canvasId, labels, data, colors) {
  _destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const defaultColors = ['#2563eb','#16a34a','#d97706','#dc2626','#0891b2','#7c3aed','#db2777'];
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors || defaultColors, borderWidth: 2, hoverOffset: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { font: { size: 12 }, padding: 14 } } },
      cutout: '65%'
    }
  });
  window.chartInstances[canvasId] = chart;
  return chart;
}
