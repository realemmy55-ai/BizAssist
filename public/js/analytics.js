// analytics.js
let _analyticsData = null;
let _activeDays = 30;

async function loadAnalytics() {
  const content = document.getElementById('app-content');
  content.innerHTML = '<div class="loading-spinner-wrap"><div class="spinner"></div></div>';
  try {
    await fetchAndRenderAnalytics(_activeDays);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Failed to load analytics</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

async function fetchAndRenderAnalytics(days, customFrom, customTo) {
  const sym = (window.appSettings || {}).currencySymbol || '₦';
  let url = '/api/analytics';
  if (customFrom || customTo) {
    url += `?from=${customFrom || ''}&to=${customTo || ''}`;
  } else {
    url += `?days=${days}`;
  }
  _analyticsData = await API.get(url);
  renderAnalytics(sym, days, customFrom, customTo);
}

function renderAnalytics(sym, days, customFrom, customTo) {
  const d = _analyticsData;
  const content = document.getElementById('app-content');
  content.innerHTML = `
    <div class="section-header">
      <h1 class="section-title">Analytics</h1>
    </div>
    <div class="date-range-bar">
      ${[['Today',1],['7 Days',7],['30 Days',30],['90 Days',90]].map(([label, n]) =>
        `<button class="btn ${days === n && !customFrom ? 'btn-primary' : 'btn-secondary'}" onclick="switchAnalyticsDays(${n})">${label}</button>`
      ).join('')}
      <input type="date" id="fromDate" value="${customFrom || ''}" placeholder="From" />
      <input type="date" id="toDate" value="${customTo || ''}" placeholder="To" />
      <button class="btn btn-secondary" onclick="applyCustomDates()">Apply</button>
    </div>

    <div class="stat-grid">
      <div class="stat-card primary">
        <div class="stat-label">Total Revenue</div>
        <div class="stat-value">${sym}${d.totalRevenue.toLocaleString()}</div>
        <div class="stat-sub">${d.totalSales} sale${d.totalSales !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card success">
        <div class="stat-label">Gross Profit</div>
        <div class="stat-value">${sym}${d.totalProfit.toLocaleString()}</div>
        <div class="stat-sub">Margin: ${d.totalRevenue > 0 ? Math.round(d.totalProfit / d.totalRevenue * 100) : 0}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg. Order Value</div>
        <div class="stat-value">${sym}${Math.round(d.avgOrderValue).toLocaleString()}</div>
        <div class="stat-sub">Per transaction</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-label">Inventory Value</div>
        <div class="stat-value">${sym}${d.totalInventoryValue.toLocaleString()}</div>
        <div class="stat-sub">Cost value on hand</div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="card">
        <div class="card-header">Revenue by Day</div>
        <div class="card-body"><div class="chart-container"><canvas id="revenueChart"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-header">Revenue by Category</div>
        <div class="card-body"><div class="chart-container"><canvas id="categoryChart"></canvas></div></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-header">Top Products by Revenue</div>
      <div class="card-body"><div class="chart-container" style="height:200px"><canvas id="topProductsChart"></canvas></div></div>
    </div>

    <div class="two-col" style="margin-bottom:16px">
      <div class="card">
        <div class="card-header">Best Sellers</div>
        <div class="table-wrap">
          ${d.bestSellers.length === 0
            ? '<div class="empty-state" style="padding:30px"><div class="empty-sub">No sales data</div></div>'
            : `<table style="font-size:13px">
                <thead><tr><th>#</th><th>Product</th><th>Units</th><th>Revenue</th><th>Profit</th></tr></thead>
                <tbody>${d.bestSellers.map((p, i) => `<tr>
                  <td><strong>#${i+1}</strong></td>
                  <td>${p.name}</td>
                  <td>${p.qty}</td>
                  <td>${sym}${p.revenue.toLocaleString()}</td>
                  <td style="color:var(--success)">${sym}${p.profit.toLocaleString()}</td>
                </tr>`).join('')}</tbody>
              </table>`
          }
        </div>
      </div>
      <div class="card">
        <div class="card-header">Slow Movers</div>
        <div class="table-wrap">
          ${d.slowMovers.length === 0
            ? '<div class="empty-state" style="padding:30px"><div class="empty-sub">No data yet</div></div>'
            : `<table style="font-size:13px">
                <thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead>
                <tbody>${d.slowMovers.map(p => `<tr>
                  <td>${p.name}</td>
                  <td>${p.qty}</td>
                  <td>${sym}${p.revenue.toLocaleString()}</td>
                </tr>`).join('')}</tbody>
              </table>`
          }
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-header">Inventory Valuation</div>
      <div class="table-wrap">
        <table style="font-size:13px">
          <thead><tr><th>Product</th><th>In Stock</th><th>Cost Price</th><th>Stock Value</th><th>Potential Revenue</th></tr></thead>
          <tbody>${d.inventoryValuation.map(p => `<tr>
            <td>${p.name}</td>
            <td>${p.quantity}</td>
            <td>${sym}${p.costPrice.toLocaleString()}</td>
            <td><strong>${sym}${p.totalValue.toLocaleString()}</strong></td>
            <td style="color:var(--primary)">${sym}${p.potentialRevenue.toLocaleString()}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        Sales History
        <div style="display:flex;gap:8px">
          <input class="search-input" id="salesSearch" placeholder="Search…" style="width:180px;font-size:12px;padding:5px 10px" />
          <select id="salesPayFilter" style="font-size:12.5px;padding:5px 10px;border:1.5px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
            <option value="">All Payments</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
            <option value="part_paid">Part Paid</option>
          </select>
        </div>
      </div>
      <div class="table-wrap" id="salesHistoryTable"></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-header">Customer Purchase Activity</div>
      <div class="table-wrap">
        ${d.customerActivity.length === 0
          ? '<div class="empty-state" style="padding:30px"><div class="empty-sub">No customer purchase data</div></div>'
          : `<table style="font-size:13px">
              <thead><tr><th>Customer</th><th>Purchases</th><th>Total Spent</th><th>Last Purchase</th></tr></thead>
              <tbody>${d.customerActivity.map(c => `<tr>
                <td><strong>${c.customerName}</strong></td>
                <td>${c.purchases}</td>
                <td><strong>${sym}${c.totalSpent.toLocaleString()}</strong></td>
                <td>${formatDate(c.lastPurchase)}</td>
              </tr>`).join('')}</tbody>
            </table>`
        }
      </div>
    </div>
  `;

  // Charts
  const labels = d.revenueByDay.map(x => {
    const dt = new Date(x.date);
    return dt.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  });

  createLineChart('revenueChart', labels, [
    { label: 'Revenue', data: d.revenueByDay.map(x => x.revenue), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.08)', fill: true, tension: 0.4, pointRadius: 3 },
    { label: 'Profit',  data: d.revenueByDay.map(x => x.profit),  borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,.05)',  fill: true, tension: 0.4, pointRadius: 3 }
  ]);

  if (d.revenueByCategory.length > 0) {
    createDoughnutChart('categoryChart', d.revenueByCategory.map(x => x.category), d.revenueByCategory.map(x => x.revenue));
  }

  if (d.bestSellers.length > 0) {
    createBarChart('topProductsChart', d.bestSellers.map(p => p.name.length > 15 ? p.name.slice(0,15) + '…' : p.name), d.bestSellers.map(p => p.revenue), 'Revenue');
  }

  renderSalesHistory(d.sales, sym);

  document.getElementById('salesSearch').oninput = e => renderSalesHistory(d.sales, sym, e.target.value, document.getElementById('salesPayFilter').value);
  document.getElementById('salesPayFilter').onchange = e => renderSalesHistory(d.sales, sym, document.getElementById('salesSearch').value, e.target.value);
}

function renderSalesHistory(sales, sym, search = '', payFilter = '') {
  const el = document.getElementById('salesHistoryTable');
  if (!el) return;
  let filtered = [...sales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (search) filtered = filtered.filter(s =>
    s.customerName.toLowerCase().includes(search.toLowerCase()) ||
    s.id.toLowerCase().includes(search.toLowerCase())
  );
  if (payFilter) filtered = filtered.filter(s => s.paymentStatus === payFilter);

  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon">🧾</div><div class="empty-sub">No sales in this period</div></div>';
    return;
  }
  el.innerHTML = `<table style="font-size:13px">
    <thead><tr><th>Date</th><th>Sale ID</th><th>Customer</th><th>Items</th><th>Total</th><th>Profit</th><th>Margin</th><th>Payment</th></tr></thead>
    <tbody>${filtered.map(s => {
      const margin = s.total > 0 ? Math.round((s.grossProfit || 0) / s.total * 100) : 0;
      return `<tr>
        <td>${formatDate(s.createdAt)}</td>
        <td><code>${s.id.slice(0,10)}</code></td>
        <td>${s.customerName}</td>
        <td>${s.items.length}</td>
        <td><strong>${sym}${s.total.toLocaleString()}</strong></td>
        <td style="color:var(--success)">${sym}${(s.grossProfit||0).toLocaleString()}</td>
        <td>${margin}%</td>
        <td>${paymentBadgeAn(s.paymentStatus)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function paymentBadgeAn(s) {
  const map = { paid: 'badge-success', unpaid: 'badge-danger', part_paid: 'badge-warning', refunded: 'badge-info' };
  return `<span class="badge ${map[s] || 'badge-secondary'}" style="font-size:11px">${(s || '').replace('_',' ')}</span>`;
}

function switchAnalyticsDays(days) {
  _activeDays = days;
  fetchAndRenderAnalytics(days);
}

function applyCustomDates() {
  const from = document.getElementById('fromDate')?.value;
  const to = document.getElementById('toDate')?.value;
  if (!from && !to) { showToast('Select at least one date', 'warning'); return; }
  _activeDays = null;
  fetchAndRenderAnalytics(null, from, to);
}
