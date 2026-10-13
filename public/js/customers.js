// customers.js
let _customers = [];
let _custSales = [];
let _custOrders = [];

async function loadCustomers() {
  const content = document.getElementById('app-content');
  content.innerHTML = '<div class="loading-spinner-wrap"><div class="spinner"></div></div>';
  try {
    [_customers, _custSales, _custOrders] = await Promise.all([
      API.get('/api/customers'),
      API.get('/api/sales'),
      API.get('/api/orders')
    ]);
    renderCustomers();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Failed to load customers</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

function renderCustomers(search = '') {
  const sym = (window.appSettings || {}).currencySymbol || '₦';
  const content = document.getElementById('app-content');
  let filtered = [..._customers];
  if (search) filtered = filtered.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search) ||
    c.email.toLowerCase().includes(search.toLowerCase())
  );

  // Compute per-customer stats
  const statsMap = {};
  for (const s of _custSales) {
    if (!s.customerId) continue;
    if (!statsMap[s.customerId]) statsMap[s.customerId] = { spent: 0, purchases: 0, last: null };
    statsMap[s.customerId].spent += s.total;
    statsMap[s.customerId].purchases += 1;
    if (!statsMap[s.customerId].last || s.createdAt > statsMap[s.customerId].last) statsMap[s.customerId].last = s.createdAt;
  }

  content.innerHTML = `
    <div class="section-header">
      <h1 class="section-title">Customers</h1>
      <div class="section-actions">
        <button class="btn btn-primary" id="addCustomerBtn">+ Add Customer</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input class="search-input" id="custSearch" placeholder="Search by name, phone, email…" value="${search}" />
      </div>
    </div>
    <div class="card">
      <div class="table-wrap">
        ${filtered.length === 0
          ? '<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No customers found</div><div class="empty-sub">Add your first customer using the button above.</div></div>'
          : `<table>
              <thead><tr>
                <th>Name</th><th>Phone</th><th>Email</th>
                <th>Total Spent</th><th>Purchases</th><th>Last Purchase</th><th>Actions</th>
              </tr></thead>
              <tbody>${filtered.map(c => {
                const st = statsMap[c.id] || { spent: 0, purchases: 0, last: null };
                return `<tr style="cursor:pointer" onclick="viewCustomer('${c.id}')">
                  <td><strong>${c.name}</strong>${st.purchases > 1 ? ' <span class="badge badge-primary" style="font-size:10px">Repeat</span>' : ''}</td>
                  <td>${c.phone || '—'}</td>
                  <td>${c.email || '—'}</td>
                  <td><strong>${sym}${st.spent.toLocaleString()}</strong></td>
                  <td>${st.purchases}</td>
                  <td>${st.last ? formatDate(st.last) : '—'}</td>
                  <td onclick="event.stopPropagation()">
                    <button class="btn btn-sm btn-outline" onclick="openCustomerModal('${c.id}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteCustomer('${c.id}')">Delete</button>
                  </td>
                </tr>`;
              }).join('')}</tbody>
            </table>`
        }
      </div>
    </div>
  `;

  document.getElementById('addCustomerBtn').onclick = () => openCustomerModal(null);
  document.getElementById('custSearch').oninput = e => renderCustomers(e.target.value);
}

function viewCustomer(id) {
  const c = _customers.find(x => x.id === id);
  const sym = (window.appSettings || {}).currencySymbol || '₦';
  const sales = _custSales.filter(s => s.customerId === id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const totalSpent = sales.reduce((s, x) => s + x.total, 0);
  const avgOrder = sales.length ? totalSpent / sales.length : 0;

  const bodyHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
      <div style="width:52px;height:52px;background:var(--primary-light);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:var(--primary)">
        ${c.name.charAt(0).toUpperCase()}
      </div>
      <div>
        <div style="font-size:18px;font-weight:700">${c.name}
          ${sales.length > 1 ? '<span class="badge badge-primary" style="margin-left:8px">Repeat Customer</span>' : ''}
        </div>
        <div style="color:var(--text-muted);font-size:13px">${c.email || ''} ${c.phone ? '· ' + c.phone : ''}</div>
        ${c.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${c.notes}</div>` : ''}
      </div>
    </div>
    <div class="customer-stats">
      <div class="cust-stat">
        <div class="cust-stat-value">${sym}${totalSpent.toLocaleString()}</div>
        <div class="cust-stat-label">Total Spent</div>
      </div>
      <div class="cust-stat">
        <div class="cust-stat-value">${sales.length}</div>
        <div class="cust-stat-label">Purchases</div>
      </div>
      <div class="cust-stat">
        <div class="cust-stat-value">${sym}${Math.round(avgOrder).toLocaleString()}</div>
        <div class="cust-stat-label">Avg. Order</div>
      </div>
    </div>
    <div style="font-weight:600;font-size:13px;margin-bottom:10px">Purchase History</div>
    ${sales.length === 0
      ? '<div class="empty-state" style="padding:30px"><div class="empty-icon">🧾</div><div class="empty-sub">No purchases recorded</div></div>'
      : `<div class="table-wrap"><table style="font-size:13px">
          <thead><tr><th>Date</th><th>Items</th><th>Total</th><th>Profit</th><th>Method</th></tr></thead>
          <tbody>${sales.map(s => `<tr>
            <td>${formatDate(s.createdAt)}</td>
            <td>${s.items.map(i => i.productName).join(', ')}</td>
            <td><strong>${sym}${s.total.toLocaleString()}</strong></td>
            <td style="color:var(--success)">${sym}${(s.grossProfit || 0).toLocaleString()}</td>
            <td>${formatPaymentMethod(s.paymentMethod)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`
    }
  `;

  openModal(c.name, bodyHTML, null);
  document.querySelector('.modal').classList.add('modal-lg');
  document.querySelector('.modal-footer').innerHTML = `
    <button class="btn btn-outline" onclick="openCustomerModal('${c.id}');closeModal()">Edit</button>
    <button class="btn btn-secondary" onclick="closeModal()">Close</button>
  `;
}

function openCustomerModal(customerId) {
  const c = customerId ? _customers.find(x => x.id === customerId) : null;
  const bodyHTML = `
    <form id="customerForm">
      <div class="form-group">
        <label class="form-label">Full Name *</label>
        <input class="form-input" name="name" required placeholder="e.g. Adaeze Okonkwo" value="${c ? c.name : ''}" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Phone Number</label>
          <input class="form-input" name="phone" placeholder="e.g. 08012345678" value="${c ? c.phone : ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Email Address</label>
          <input class="form-input" name="email" type="email" placeholder="customer@email.com" value="${c ? c.email : ''}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-textarea" name="notes" placeholder="Any notes about this customer">${c ? c.notes : ''}</textarea>
      </div>
    </form>
  `;
  openModal(c ? 'Edit Customer' : 'Add Customer', bodyHTML, async () => {
    const fd = new FormData(document.getElementById('customerForm'));
    const data = Object.fromEntries(fd.entries());
    if (!data.name.trim()) { showToast('Customer name is required', 'error'); return false; }
    try {
      if (c) {
        await API.put(`/api/customers/${c.id}`, data);
        showToast('Customer updated', 'success');
      } else {
        await API.post('/api/customers', data);
        showToast('Customer added', 'success');
      }
      closeModal();
      [_customers] = await Promise.all([API.get('/api/customers')]);
      renderCustomers();
    } catch (err) { showToast(err.message, 'error'); return false; }
  });
}

async function deleteCustomer(id) {
  const c = _customers.find(x => x.id === id);
  if (!confirm(`Delete customer "${c.name}"? This cannot be undone.`)) return;
  try {
    await API.delete(`/api/customers/${id}`);
    showToast('Customer deleted', 'success');
    _customers = await API.get('/api/customers');
    renderCustomers();
  } catch (err) { showToast(err.message, 'error'); }
}
