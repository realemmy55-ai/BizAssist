// orders.js
let _orders = [];
let _orderProducts = [];
let _orderCustomers = [];

async function loadOrders() {
  const content = document.getElementById("app-content");
  content.innerHTML =
    '<div class="loading-spinner-wrap"><div class="spinner"></div></div>';
  try {
    [_orders, _orderProducts, _orderCustomers] = await Promise.all([
      API.get("/api/orders"),
      API.get("/api/products"),
      API.get("/api/customers"),
    ]);
    renderOrders();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Failed to load orders</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

function renderOrders(search = "", statusFilter = "") {
  const sym = (window.appSettings || {}).currencySymbol || "₦";
  const content = document.getElementById("app-content");
  let filtered = [..._orders].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  if (search)
    filtered = filtered.filter(
      (o) =>
        o.customerName.toLowerCase().includes(search.toLowerCase()) ||
        o.id.toLowerCase().includes(search.toLowerCase()),
    );
  if (statusFilter)
    filtered = filtered.filter((o) => o.status === statusFilter);

  content.innerHTML = `
    <div class="section-header">
      <h1 class="section-title">Orders</h1>
      <div class="section-actions">
        <button class="btn btn-primary" id="createOrderBtn">+ New Order</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input class="search-input" id="orderSearch" placeholder="Search by customer or order ID…" value="${search}" />
      </div>
      <select class="form-select" id="statusFilter" style="width:auto;padding:9px 12px">
        <option value="">All Statuses</option>
        ${[
          "pending",
          "confirmed",
          "processing",
          "ready",
          "completed",
          "cancelled",
          "refunded",
        ]
          .map(
            (s) =>
              `<option value="${s}" ${statusFilter === s ? "selected" : ""}>${capitalize(s)}</option>`,
          )
          .join("")}
      </select>
    </div>
    <div class="card">
      <div class="table-wrap">
        ${
          filtered.length === 0
            ? '<div class="empty-state"><div class="empty-icon">🛒</div><div class="empty-title">No orders found</div><div class="empty-sub">Create your first order using the button above.</div></div>'
            : `<table>
              <thead><tr>
                <th>Order ID</th><th>Customer</th><th>Items</th><th>Total</th><th>Paid</th><th>Balance</th>
                <th>Status</th><th>Payment</th><th>Date</th><th>Actions</th>
              </tr></thead>
              <tbody>${filtered
                .map(
                  (o) => `<tr>
                <td><code>${o.id.slice(0, 12)}</code></td>
                <td><strong>${o.customerName}</strong></td>
                <td>${o.items.length} item${o.items.length !== 1 ? "s" : ""}</td>
                <td><strong>${sym}${o.total.toLocaleString()}</strong></td>
                <td>${Number.isFinite(o.amountPaid) ? `${sym}${o.amountPaid.toLocaleString()}` : "Unknown"}</td>
                <td>${Number.isFinite(o.balanceDue) ? `${sym}${o.balanceDue.toLocaleString()}` : "Unknown"}</td>
                <td>${statusBadge(o.status)}</td>
                <td>${paymentBadge(o.paymentStatus)}</td>
                <td>${formatDate(o.createdAt)}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="viewOrder('${o.id}')">View</button>
                </td>
              </tr>`,
                )
                .join("")}</tbody>
            </table>`
        }
      </div>
    </div>
  `;

  document.getElementById("createOrderBtn").onclick = openCreateOrderModal;
  document.getElementById("orderSearch").oninput = (e) =>
    renderOrders(e.target.value, document.getElementById("statusFilter").value);
  document.getElementById("statusFilter").onchange = (e) =>
    renderOrders(document.getElementById("orderSearch").value, e.target.value);
}

function statusBadge(s) {
  const map = {
    pending: "badge-secondary",
    confirmed: "badge-primary",
    processing: "badge-info",
    ready: "badge-warning",
    completed: "badge-success",
    cancelled: "badge-danger",
    refunded: "badge-danger",
  };
  return `<span class="badge ${map[s] || "badge-secondary"}">${capitalize(s)}</span>`;
}
function paymentBadge(s) {
  const map = {
    paid: "badge-success",
    unpaid: "badge-danger",
    part_paid: "badge-warning",
    refunded: "badge-info",
  };
  return `<span class="badge ${map[s] || "badge-secondary"}">${capitalize(s.replace("_", " "))}</span>`;
}
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function viewOrder(id) {
  const o = _orders.find((x) => x.id === id);
  const sym = (window.appSettings || {}).currencySymbol || "₦";
  const nextStatuses = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["processing", "cancelled"],
    processing: ["ready", "cancelled"],
    ready: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
    refunded: [],
  };
  const next = nextStatuses[o.status] || [];
  const bodyHTML = `
    <div style="margin-bottom:16px">
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div><span class="form-label">Order ID</span><br/><code>${o.id}</code></div>
        <div><span class="form-label">Customer</span><br/><strong>${o.customerName}</strong></div>
        <div><span class="form-label">Date</span><br/>${formatDate(o.createdAt)}</div>
        <div><span class="form-label">Status</span><br/>${statusBadge(o.status)}</div>
        <div><span class="form-label">Payment</span><br/>${paymentBadge(o.paymentStatus)}</div>
        <div><span class="form-label">Paid</span><br/>${Number.isFinite(o.amountPaid) ? `${sym}${o.amountPaid.toLocaleString()}` : "Unknown"}</div>
        <div><span class="form-label">Balance</span><br/>${Number.isFinite(o.balanceDue) ? `${sym}${o.balanceDue.toLocaleString()}` : "Unknown"}</div>
        <div><span class="form-label">Method</span><br/>${formatPaymentMethod(o.paymentMethod)}</div>
      </div>
      ${o.notes ? `<div style="padding:10px;background:var(--surface-2);border-radius:6px;font-size:13px">${o.notes}</div>` : ""}
    </div>
    <table style="width:100%;font-size:13px;margin-bottom:16px">
      <thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
      <tbody>
        ${o.items
          .map(
            (i) => `<tr>
          <td>${i.productName}</td>
          <td>${i.qty}</td>
          <td>${sym}${i.unitPrice.toLocaleString()}</td>
          <td><strong>${sym}${(i.qty * i.unitPrice).toLocaleString()}</strong></td>
        </tr>`,
          )
          .join("")}
      </tbody>
      <tfoot><tr>
        <td colspan="3" style="font-weight:700;padding:10px 14px">Total</td>
        <td style="font-weight:700;padding:10px 14px">${sym}${o.total.toLocaleString()}</td>
      </tfoot>
    </table>
    ${
      next.length > 0
        ? `
    <div style="padding:14px;background:var(--surface-2);border-radius:8px">
      <div class="form-label" style="margin-bottom:10px">Update Status</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${next.map((s) => `<button class="btn ${s === "cancelled" || s === "refunded" ? "btn-danger" : "btn-primary"} btn-sm" onclick="updateOrderStatus('${o.id}','${s}')">${capitalize(s)}</button>`).join("")}
      </div>
    </div>`
        : ""
    }
    ${
      o.paymentStatus !== "refunded"
        ? `
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-secondary btn-sm" onclick="recordOrderPayment('${o.id}')">Record payment</button>
      <button class="btn btn-danger btn-sm" onclick="refundOrder('${o.id}')">Refund</button>
    </div>`
        : ""
    }
  `;
  openModal("Order Details", bodyHTML, null);
  document.querySelector(".modal").classList.add("modal-lg");
}

async function updateOrderStatus(orderId, newStatus) {
  try {
    await API.put(`/api/orders/${orderId}/status`, { status: newStatus });
    showToast(`Order marked as ${newStatus}`, "success");
    closeModal();
    [_orders] = await Promise.all([API.get("/api/orders")]);
    renderOrders();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function recordOrderPayment(orderId) {
  const order = _orders.find((item) => item.id === orderId);
  if (!order) return;
  const current = Number.isFinite(order.amountPaid)
    ? String(order.amountPaid)
    : "";
  const amount = window.prompt(
    current
      ? "Total amount paid to date"
      : "Legacy payment amount is unknown. Enter the actual cumulative amount paid",
    current,
  );
  if (amount === null) return;
  if (amount.trim() === "" || !Number.isFinite(Number(amount))) {
    showToast("Enter the actual cumulative amount paid", "error");
    return;
  }
  try {
    await API.put(`/api/orders/${orderId}/payment`, {
      amountPaid: Number(amount),
    });
    closeModal();
    _orders = await API.get("/api/orders");
    renderOrders();
    showToast("Payment updated", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function refundOrder(orderId) {
  const returnedStock = window.confirm(
    "Were the goods physically returned? Choose Cancel if they were not returned.",
  );
  const reason = window.prompt("Refund reason", "Full refund");
  if (reason === null) return;
  try {
    await API.post(`/api/orders/${orderId}/refund`, { reason, returnedStock });
    closeModal();
    _orders = await API.get("/api/orders");
    renderOrders();
    showToast("Refund recorded", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

let _orderItems = [];

function openCreateOrderModal() {
  _orderItems = [];
  const customerOptions = _orderCustomers
    .map(
      (c) => `<option value="${c.id}" data-name="${c.name}">${c.name}</option>`,
    )
    .join("");

  const bodyHTML = `
    <form id="createOrderForm">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Customer *</label>
          <select class="form-select" id="orderCustomer" required>
            <option value="">-- Select Customer --</option>
            ${customerOptions}
            <option value="walkin" data-name="Walk-in Customer">Walk-in Customer</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <select class="form-select" name="paymentMethod">
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="pos">POS</option>
            <option value="transfer">Transfer</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Payment Status</label>
          <select class="form-select" name="paymentStatus">
            <option value="unpaid">Unpaid</option>
            <option value="part_paid">Part Paid</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="orderAmountPaid">Total paid to date</label>
          <input class="form-input" id="orderAmountPaid" name="amountPaid" type="number" min="0" step="0.01" placeholder="Defaults from payment status" />
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" name="notes" placeholder="Optional notes" />
        </div>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:8px 0 16px"/>
      <div class="form-label" style="margin-bottom:8px">Products</div>
      <div class="form-row" style="margin-bottom:10px">
        <select class="form-select" id="productPicker">
          <option value="">-- Select Product --</option>
          ${_orderProducts
            .filter((p) => p.quantity > 0)
            .map(
              (p) =>
                `<option value="${p.id}" data-name="${p.name}" data-price="${p.sellingPrice}" data-stock="${p.quantity}">${p.name} — ₦${p.sellingPrice.toLocaleString()} (${p.quantity} in stock)</option>`,
            )
            .join("")}
        </select>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <input class="form-input" id="productQty" type="number" min="1" placeholder="Qty" style="width:80px" />
          <button type="button" class="btn btn-secondary" onclick="addOrderItem()">Add</button>
        </div>
      </div>
      <div id="orderItemsList"></div>
      <div class="order-total-row" id="orderTotalRow">Total: <span id="orderTotalVal">₦0</span></div>
    </form>
  `;

  openModal("Create New Order", bodyHTML, async () => {
    const form = document.getElementById("createOrderForm");
    const customerEl = document.getElementById("orderCustomer");
    if (!customerEl.value) {
      showToast("Select a customer", "error");
      return false;
    }
    if (_orderItems.length === 0) {
      showToast("Add at least one product", "error");
      return false;
    }

    const fd = new FormData(form);
    const selectedOpt = customerEl.options[customerEl.selectedIndex];
    const customerId = customerEl.value === "walkin" ? null : customerEl.value;
    const customerName = selectedOpt.dataset.name || "Walk-in Customer";

    const payload = {
      customerId,
      customerName,
      items: _orderItems,
      paymentMethod: fd.get("paymentMethod"),
      paymentStatus: fd.get("paymentStatus"),
      amountPaid:
        fd.get("amountPaid") === "" ? undefined : Number(fd.get("amountPaid")),
      notes: fd.get("notes"),
    };

    try {
      await API.post("/api/orders", payload);
      showToast("Order created!", "success");
      closeModal();
      _orders = await API.get("/api/orders");
      renderOrders();
    } catch (err) {
      showToast(err.message, "error");
      return false;
    }
  });
  document.querySelector(".modal").classList.add("modal-lg");
}

function addOrderItem() {
  const picker = document.getElementById("productPicker");
  const qtyEl = document.getElementById("productQty");
  const productId = picker.value;
  const qty = parseInt(qtyEl.value);
  if (!productId) {
    showToast("Select a product", "error");
    return;
  }
  if (!qty || qty < 1) {
    showToast("Enter a valid quantity", "error");
    return;
  }
  const opt = picker.options[picker.selectedIndex];
  const stock = parseInt(opt.dataset.stock);
  const existing = _orderItems.find((i) => i.productId === productId);
  const alreadyQty = existing ? existing.qty : 0;
  if (alreadyQty + qty > stock) {
    showToast(`Only ${stock} in stock (already added ${alreadyQty})`, "error");
    return;
  }

  if (existing) {
    existing.qty += qty;
  } else {
    _orderItems.push({
      productId,
      productName: opt.dataset.name,
      qty,
      unitPrice: Number(opt.dataset.price),
    });
  }
  qtyEl.value = "";
  renderOrderItemsList();
}

function removeOrderItem(productId) {
  _orderItems = _orderItems.filter((i) => i.productId !== productId);
  renderOrderItemsList();
}

function renderOrderItemsList() {
  const sym = (window.appSettings || {}).currencySymbol || "₦";
  const el = document.getElementById("orderItemsList");
  if (!el) return;
  if (_orderItems.length === 0) {
    el.innerHTML =
      '<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:12px">No items added yet</div>';
  } else {
    el.innerHTML = `<div class="table-wrap"><table style="font-size:13px">
      <thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th><th></th></tr></thead>
      <tbody>${_orderItems
        .map(
          (i) => `<tr>
        <td>${i.productName}</td>
        <td>${i.qty}</td>
        <td>${sym}${i.unitPrice.toLocaleString()}</td>
        <td>${sym}${(i.qty * i.unitPrice).toLocaleString()}</td>
        <td><button class="order-item-remove" onclick="removeOrderItem('${i.productId}')">✕</button></td>
      </tr>`,
        )
        .join("")}</tbody>
    </table></div>`;
  }
  const total = _orderItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const tv = document.getElementById("orderTotalVal");
  if (tv) tv.textContent = sym + total.toLocaleString();
}
