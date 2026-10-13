let _salesRecords = [];
let _saleProducts = [];
let _saleCustomers = [];
let _saleItems = [];

async function loadSales() {
  const content = document.getElementById("app-content");
  content.innerHTML =
    '<div class="loading-spinner-wrap"><div class="spinner"></div></div>';
  try {
    [_salesRecords, _saleProducts, _saleCustomers] = await Promise.all([
      API.get("/api/sales"),
      API.get("/api/products"),
      API.get("/api/customers"),
    ]);
    renderSales();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-title">Could not load sales</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

function renderSales(search = "", payment = "") {
  const content = document.getElementById("app-content");
  const sym = (window.appSettings || {}).currencySymbol || "₦";
  const recognizedSales = _salesRecords.filter(
    (sale) => sale.paymentStatus !== "refunded",
  );
  const sorted = [..._salesRecords].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  const filtered = sorted.filter(
    (sale) =>
      (!search ||
        `${sale.id} ${sale.customerName}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!payment || sale.paymentStatus === payment),
  );

  content.innerHTML = `
    <div class="section-header">
      <div><h1 class="section-title">Sales</h1><div class="form-hint">Completed transactions recorded from real demo data.</div></div>
      <div class="section-actions"><button class="btn btn-primary" id="recordSaleBtn">+ Record sale</button></div>
    </div>
    <div class="stat-grid">
      <div class="stat-card primary"><div class="stat-label">Recorded sales</div><div class="stat-value">${recognizedSales.length}</div><div class="stat-sub">Refunds excluded</div></div>
      <div class="stat-card success"><div class="stat-label">Gross revenue</div><div class="stat-value">${sym}${recognizedSales.reduce((sum, sale) => sum + sale.total, 0).toLocaleString()}</div><div class="stat-sub">After discounts, excluding refunds</div></div>
      <div class="stat-card"><div class="stat-label">Gross profit</div><div class="stat-value">${sym}${recognizedSales.reduce((sum, sale) => sum + (sale.grossProfit || 0), 0).toLocaleString()}</div><div class="stat-sub">Revenue less recorded product costs</div></div>
      <div class="stat-card warning"><div class="stat-label">Unpaid / part-paid sales value</div><div class="stat-value">${sym}${_salesRecords
        .filter(
          (sale) =>
            sale.paymentStatus !== "paid" && sale.paymentStatus !== "refunded",
        )
        .reduce((sum, sale) => sum + sale.total, 0)
        .toLocaleString()}</div><div class="stat-sub">Full sale totals; amount due is not tracked yet</div></div>
    </div>
    <div class="toolbar">
      <div class="search-wrap"><span class="search-icon">⌕</span><input id="salesSearch" class="search-input" placeholder="Search sale or customer" value="${search}" /></div>
      <select class="form-select" id="salesPaymentFilter" style="width:auto">
        <option value="">All payment statuses</option>
        ${["paid", "unpaid", "part_paid", "refunded"].map((value) => `<option value="${value}" ${payment === value ? "selected" : ""}>${capitalize(value.replace("_", " "))}</option>`).join("")}
      </select>
    </div>
    <div class="card"><div class="table-wrap" id="salesTable"></div></div>
  `;
  renderSalesTable(filtered, sym);
  document.getElementById("recordSaleBtn").onclick = openRecordSaleModal;
  document.getElementById("salesSearch").oninput = (event) =>
    renderSales(
      event.target.value,
      document.getElementById("salesPaymentFilter").value,
    );
  document.getElementById("salesPaymentFilter").onchange = (event) =>
    renderSales(
      document.getElementById("salesSearch").value,
      event.target.value,
    );
}

function renderSalesTable(sales, sym) {
  const table = document.getElementById("salesTable");
  if (!sales.length) {
    table.innerHTML =
      '<div class="empty-state"><div class="empty-title">No sales found</div><div class="empty-sub">Record a sale to start building your transaction history.</div></div>';
    return;
  }
  table.innerHTML = `<table>
    <thead><tr><th>Date</th><th>Reference</th><th>Customer</th><th>Items</th><th>Total</th><th>Profit</th><th>Payment</th><th>Method</th></tr></thead>
    <tbody>${sales
      .map(
        (sale) => `<tr>
      <td>${formatDate(sale.createdAt)}</td><td><code>${sale.id}</code></td>
      <td>${sale.customerName}</td><td>${sale.items.reduce((sum, item) => sum + Number(item.qty), 0)} units</td>
      <td><strong>${sym}${sale.total.toLocaleString()}</strong></td>
      <td>${sym}${(sale.grossProfit || 0).toLocaleString()}</td>
      <td>${paymentBadge(sale.paymentStatus)}</td><td>${formatPaymentMethod(sale.paymentMethod)}</td>
    </tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

function openRecordSaleModal() {
  _saleItems = [];
  const sym = (window.appSettings || {}).currencySymbol || "₦";
  const body = `
    <form id="recordSaleForm">
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="saleCustomer">Customer</label><select class="form-select" id="saleCustomer"><option value="">Walk-in Customer</option>${_saleCustomers.map((customer) => `<option value="${customer.id}">${customer.name}</option>`).join("")}</select></div>
        <div class="form-group"><label class="form-label" for="salePaymentMethod">Payment method</label><select class="form-select" id="salePaymentMethod"><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="pos">POS</option><option value="card">Card</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="salePaymentStatus">Payment status</label><select class="form-select" id="salePaymentStatus"><option value="paid">Paid</option><option value="part_paid">Part paid</option><option value="unpaid">Unpaid</option></select></div>
        <div class="form-group"><label class="form-label" for="saleDiscount">Discount (${sym})</label><input class="form-input" id="saleDiscount" type="number" min="0" step="1" value="0" /></div>
      </div>
      <div class="form-row sale-picker">
        <div class="form-group"><label class="form-label" for="saleProduct">Product</label><select class="form-select" id="saleProduct"><option value="">Select available product</option>${_saleProducts
          .filter((product) => product.quantity > 0)
          .map(
            (product) =>
              `<option value="${product.id}">${product.name} · ${sym}${product.sellingPrice.toLocaleString()} · ${product.quantity} in stock</option>`,
          )
          .join("")}</select></div>
        <div class="form-group"><label class="form-label" for="saleQty">Quantity</label><div style="display:flex;gap:8px"><input class="form-input" id="saleQty" type="number" min="1" value="1" /><button class="btn btn-secondary" type="button" onclick="addSaleItem()">Add</button></div></div>
      </div>
      <div id="saleItemRows"></div>
      <div class="sale-totals" id="saleTotals"></div>
      <div class="form-group" style="margin-top:16px"><label class="form-label" for="saleNotes">Notes</label><input class="form-input" id="saleNotes" placeholder="Optional transaction note" /></div>
    </form>`;
  openModal("Record sale", body, async () => {
    if (!_saleItems.length) {
      showToast("Add at least one product", "error");
      return false;
    }
    const subtotal = _saleItems.reduce(
      (sum, item) => sum + item.qty * item.unitPrice,
      0,
    );
    const discount = Number(document.getElementById("saleDiscount").value) || 0;
    if (discount > subtotal) {
      showToast("Discount cannot exceed the sale subtotal", "error");
      return false;
    }
    const customerId = document.getElementById("saleCustomer").value;
    const customer = _saleCustomers.find((entry) => entry.id === customerId);
    try {
      await API.post("/api/sales", {
        customerId: customerId || null,
        customerName: customer ? customer.name : "Walk-in Customer",
        items: _saleItems,
        discount,
        paymentMethod: document.getElementById("salePaymentMethod").value,
        paymentStatus: document.getElementById("salePaymentStatus").value,
        notes: document.getElementById("saleNotes").value.trim(),
      });
      showToast("Sale recorded and inventory updated", "success");
      closeModal();
      await loadSales();
    } catch (err) {
      showToast(err.message, "error");
      return false;
    }
  });
  document.querySelector(".modal").classList.add("modal-lg");
  renderSaleDraft();
  document.getElementById("saleDiscount").oninput = renderSaleDraft;
}

function addSaleItem() {
  const product = _saleProducts.find(
    (item) => item.id === document.getElementById("saleProduct").value,
  );
  const qty = Number(document.getElementById("saleQty").value);
  if (!product) {
    showToast("Select a product", "warning");
    return;
  }
  const existing = _saleItems.find((item) => item.productId === product.id);
  if (
    !Number.isInteger(qty) ||
    qty < 1 ||
    qty + (existing ? existing.qty : 0) > product.quantity
  ) {
    showToast(
      `Enter a quantity available in stock (${product.quantity} available)`,
      "error",
    );
    return;
  }
  if (existing) existing.qty += qty;
  else
    _saleItems.push({
      productId: product.id,
      productName: product.name,
      qty,
      unitPrice: product.sellingPrice,
    });
  document.getElementById("saleProduct").value = "";
  document.getElementById("saleQty").value = "1";
  renderSaleDraft();
}

function removeSaleItem(productId) {
  _saleItems = _saleItems.filter((item) => item.productId !== productId);
  renderSaleDraft();
}

function renderSaleDraft() {
  const rows = document.getElementById("saleItemRows");
  const totals = document.getElementById("saleTotals");
  if (!rows || !totals) return;
  const sym = (window.appSettings || {}).currencySymbol || "₦";
  const subtotal = _saleItems.reduce(
    (sum, item) => sum + item.qty * item.unitPrice,
    0,
  );
  const discount = Number(document.getElementById("saleDiscount")?.value) || 0;
  rows.innerHTML = _saleItems.length
    ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Line total</th><th></th></tr></thead><tbody>${_saleItems.map((item) => `<tr><td>${item.productName}</td><td>${item.qty}</td><td>${sym}${item.unitPrice.toLocaleString()}</td><td>${sym}${(item.qty * item.unitPrice).toLocaleString()}</td><td><button type="button" class="btn btn-sm btn-danger" onclick="removeSaleItem('${item.productId}')" aria-label="Remove ${item.productName}">Remove</button></td></tr>`).join("")}</tbody></table></div>`
    : '<p class="form-hint">No items added yet.</p>';
  totals.innerHTML = `<div><span>Subtotal</span><strong>${sym}${subtotal.toLocaleString()}</strong></div><div><span>Discount</span><strong>−${sym}${discount.toLocaleString()}</strong></div><div class="sale-grand-total"><span>Total</span><strong>${sym}${Math.max(0, subtotal - discount).toLocaleString()}</strong></div>`;
}
