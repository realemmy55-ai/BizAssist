// dashboard.js
async function loadDashboard() {
  const content = document.getElementById("app-content");
  content.innerHTML =
    '<div class="loading-spinner-wrap"><div class="spinner"></div></div>';
  try {
    const [dash, analytics] = await Promise.all([
      API.get("/api/dashboard"),
      API.get("/api/analytics?days=7"),
    ]);
    const s = window.appSettings || {};
    const sym = s.currencySymbol || "₦";

    content.innerHTML = `
      <div class="section-header">
        <h1 class="section-title">Dashboard</h1>
        <span class="badge badge-warning">🧪 Demo Data</span>
      </div>

      <div class="stat-grid">
        <div class="stat-card primary">
          <div class="stat-label">Today's Revenue</div>
          <div class="stat-value">${sym}${dash.todayRevenue.toLocaleString()}</div>
          <div class="stat-sub">${dash.todaySalesCount} sale${dash.todaySalesCount === 1 ? "" : "s"} · Gross profit: ${sym}${dash.todayProfit.toLocaleString()}</div>
        </div>
        <div class="stat-card success">
          <div class="stat-label">Total Orders</div>
          <div class="stat-value">${dash.totalOrders}</div>
          <div class="stat-sub">${dash.openOrders} outstanding · ${dash.totalOrders} all time</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Products</div>
          <div class="stat-value">${dash.totalProducts}</div>
          <div class="stat-sub">In catalogue</div>
        </div>
        <div class="stat-card ${dash.lowStockCount > 0 ? "warning" : ""}">
          <div class="stat-label">Low Stock Alerts</div>
          <div class="stat-value">${dash.lowStockCount}</div>
          <div class="stat-sub">${dash.lowStockCount > 0 ? "Items need restocking" : "All stock levels OK"}</div>
        </div>
      </div>

      <div class="chart-grid">
        <div class="card">
          <div class="card-header">
            Sales — Last 7 Days
            <span style="font-size:12px;color:var(--text-muted);font-weight:400;">Tip: click Analytics for full history</span>
          </div>
          <div class="card-body">
            <div class="chart-container"><canvas id="dashSalesChart"></canvas></div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">Best Sellers</div>
          <div class="card-body" id="bestSellersList"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Recent Transactions</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Sale ID</th><th>Customer</th><th>Items</th>
              <th>Total</th><th>Profit</th><th>Method</th><th>Date</th>
            </tr></thead>
            <tbody id="recentTxBody"></tbody>
          </table>
        </div>
      </div>

      ${
        dash.lowStockCount > 0
          ? `
      <div class="card" style="margin-top:16px;">
        <div class="card-header" style="color:var(--warning);">⚠️ Low Stock Items</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Stock</th><th>Threshold</th></tr></thead>
            <tbody>${dash.lowStockItems
              .map(
                (p) => `
              <tr>
                <td><strong>${p.name}</strong></td>
                <td><code>${p.sku}</code></td>
                <td>${p.category}</td>
                <td><span class="qty-chip ${p.quantity === 0 ? "out" : "low"}">${p.quantity}</span></td>
                <td>${p.lowStockThreshold}</td>
              </tr>`,
              )
              .join("")}
            </tbody>
          </table>
        </div>
      </div>`
          : ""
      }
    `;

    // Best sellers list
    const bsList = document.getElementById("bestSellersList");
    if (dash.bestSellers.length === 0) {
      bsList.innerHTML =
        '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-sub">No sales recorded yet</div></div>';
    } else {
      bsList.innerHTML = dash.bestSellers
        .map(
          (s, i) => `
        <div class="seller-row">
          <span class="seller-rank">#${i + 1}</span>
          <div class="seller-info">
            <div class="seller-name">${s.name}</div>
            <div class="seller-qty">${s.qty} units sold</div>
          </div>
          <div class="seller-rev">${sym}${s.revenue.toLocaleString()}</div>
        </div>
      `,
        )
        .join("");
    }

    // Recent transactions
    const txBody = document.getElementById("recentTxBody");
    if (dash.recentTransactions.length === 0) {
      txBody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🧾</div><div class="empty-sub">No transactions yet</div></div></td></tr>`;
    } else {
      txBody.innerHTML = dash.recentTransactions
        .map(
          (s) => `
        <tr>
          <td><code>${s.id.slice(0, 10)}</code></td>
          <td>${s.customerName}</td>
          <td>${s.items.length} item${s.items.length !== 1 ? "s" : ""}</td>
          <td><strong>${sym}${s.total.toLocaleString()}</strong></td>
          <td style="color:var(--success)">${sym}${(s.grossProfit || 0).toLocaleString()}</td>
          <td>${formatPaymentMethod(s.paymentMethod)}</td>
          <td>${formatDate(s.createdAt)}</td>
        </tr>
      `,
        )
        .join("");
    }

    // Sales chart
    const labels = analytics.revenueByDay.map((d) => {
      const date = new Date(d.date);
      return date.toLocaleDateString("en-GB", {
        month: "short",
        day: "numeric",
      });
    });
    const revenues = analytics.revenueByDay.map((d) => d.revenue);
    createLineChart("dashSalesChart", labels, [
      {
        label: "Revenue",
        data: revenues,
        borderColor: "#2563eb",
        backgroundColor: "rgba(37,99,235,.08)",
        tension: 0.4,
        fill: true,
        pointRadius: 3,
      },
    ]);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Failed to load dashboard</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

function formatPaymentMethod(m) {
  return (
    {
      cash: "Cash",
      bank_transfer: "Bank Transfer",
      transfer: "Transfer",
      pos: "POS",
      card: "Card",
      part_paid: "Part Paid",
    }[m] ||
    m ||
    "—"
  );
}
