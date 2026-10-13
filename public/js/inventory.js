// inventory.js
let _products = [];
let _movements = [];

async function loadInventory() {
  const content = document.getElementById('app-content');
  content.innerHTML = '<div class="loading-spinner-wrap"><div class="spinner"></div></div>';
  try {
    [_products, _movements] = await Promise.all([
      API.get('/api/products'),
      API.get('/api/stock-movements')
    ]);
    renderInventory();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Failed to load inventory</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

function renderInventory(activeTab = 'products', searchVal = '') {
  const sym = (window.appSettings || {}).currencySymbol || '₦';
  const content = document.getElementById('app-content');
  content.innerHTML = `
    <div class="section-header">
      <h1 class="section-title">Inventory</h1>
      <div class="section-actions">
        <button class="btn btn-primary" id="addProductBtn">+ Add Product</button>
      </div>
    </div>
    <div class="tabs">
      <button class="tab-btn ${activeTab === 'products' ? 'active' : ''}" data-tab="products">Products (${_products.length})</button>
      <button class="tab-btn ${activeTab === 'movements' ? 'active' : ''}" data-tab="movements">Stock Movements (${_movements.length})</button>
    </div>
    <div id="tab-products" class="tab-pane ${activeTab === 'products' ? 'active' : ''}">
      <div class="toolbar">
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input class="search-input" id="productSearch" placeholder="Search products…" value="${searchVal}" />
        </div>
      </div>
      <div class="card">
        <div class="table-wrap" id="productsTableWrap"></div>
      </div>
    </div>
    <div id="tab-movements" class="tab-pane ${activeTab === 'movements' ? 'active' : ''}">
      <div class="card">
        <div class="table-wrap" id="movementsTableWrap"></div>
      </div>
    </div>
  `;

  renderProductsTable(searchVal, sym);
  renderMovementsTable(sym);

  document.getElementById('addProductBtn').onclick = () => openProductModal(null);
  document.getElementById('productSearch').oninput = e => renderProductsTable(e.target.value, sym);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => renderInventory(btn.dataset.tab, document.getElementById('productSearch')?.value || '');
  });
}

function renderProductsTable(search, sym) {
  const filtered = _products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.sku.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase())
  );
  const wrap = document.getElementById('productsTableWrap');
  if (!wrap) return;
  if (filtered.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-title">No products found</div><div class="empty-sub">Add your first product using the button above.</div></div>';
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Name</th><th>SKU</th><th>Category</th>
        <th>Cost</th><th>Price</th><th>Stock</th><th>Threshold</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>${filtered.map(p => {
        const status = p.quantity === 0 ? 'out' : p.quantity <= p.lowStockThreshold ? 'low' : 'ok';
        const badges = { ok: 'badge-success', low: 'badge-warning', out: 'badge-danger' };
        const labels = { ok: 'In Stock', low: 'Low Stock', out: 'Out of Stock' };
        return `<tr>
          <td><strong>${p.name}</strong></td>
          <td><code style="font-size:12px">${p.sku}</code></td>
          <td>${p.category}</td>
          <td>${sym}${(p.costPrice || 0).toLocaleString()}</td>
          <td><strong>${sym}${p.sellingPrice.toLocaleString()}</strong></td>
          <td><span class="qty-chip ${status}">${p.quantity}</span></td>
          <td>${p.lowStockThreshold}</td>
          <td><span class="badge ${badges[status]}">${labels[status]}</span></td>
          <td>
            <button class="btn btn-sm btn-outline" onclick="openProductModal('${p.id}')">Edit</button>
            <button class="btn btn-sm btn-secondary" onclick="openAddStockModal('${p.id}')">+Stock</button>
            <button class="btn btn-sm btn-danger" onclick="deleteProduct('${p.id}')">Delete</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  `;
}

function renderMovementsTable(sym) {
  const wrap = document.getElementById('movementsTableWrap');
  if (!wrap) return;
  const sorted = [..._movements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (sorted.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No stock movements</div><div class="empty-sub">Movements are recorded when stock is added or sales are made.</div></div>';
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Notes</th></tr></thead>
      <tbody>${sorted.map(m => `<tr>
        <td>${formatDate(m.createdAt)}</td>
        <td>${m.productName}</td>
        <td><span class="badge ${m.type === 'addition' ? 'badge-success' : 'badge-danger'}">${m.type === 'addition' ? '▲ Addition' : '▼ Deduction'}</span></td>
        <td><strong>${m.type === 'addition' ? '+' : '-'}${m.quantity}</strong></td>
        <td style="color:var(--text-muted);font-size:12px">${m.notes || '—'}</td>
      </tr>`).join('')}</tbody>
    </table>
  `;
}

function openProductModal(productId) {
  const p = productId ? _products.find(x => x.id === productId) : null;
  const title = p ? 'Edit Product' : 'Add Product';
  const bodyHTML = `
    <form id="productForm">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Name *</label>
          <input class="form-input" name="name" required placeholder="Product name" value="${p ? p.name : ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">SKU *</label>
          <input class="form-input" name="sku" required placeholder="e.g. ACC-001" value="${p ? p.sku : ''}" ${p ? 'readonly' : ''} />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Category</label>
          <input class="form-input" name="category" placeholder="e.g. Accessories" value="${p ? p.category : ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Low Stock Threshold</label>
          <input class="form-input" name="lowStockThreshold" type="number" min="0" value="${p ? p.lowStockThreshold : 5}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Cost Price (₦)</label>
          <input class="form-input" name="costPrice" type="number" min="0" placeholder="0" value="${p ? p.costPrice : ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Selling Price (₦) *</label>
          <input class="form-input" name="sellingPrice" type="number" min="0" required placeholder="0" value="${p ? p.sellingPrice : ''}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Quantity *</label>
          <input class="form-input" name="quantity" type="number" min="0" required placeholder="0" value="${p ? p.quantity : ''}" />
        </div>
        <div class="form-group"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" name="description" placeholder="Optional description">${p ? p.description : ''}</textarea>
      </div>
    </form>
  `;
  openModal(title, bodyHTML, async () => {
    const form = document.getElementById('productForm');
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    if (!data.name || !data.sku || !data.sellingPrice || data.quantity === '') {
      showToast('Please fill all required fields', 'error'); return false;
    }
    if (Number(data.sellingPrice) < 0 || Number(data.costPrice) < 0 || Number(data.quantity) < 0) {
      showToast('Values must be non-negative', 'error'); return false;
    }
    try {
      if (p) {
        await API.put(`/api/products/${p.id}`, data);
        showToast('Product updated', 'success');
      } else {
        await API.post('/api/products', data);
        showToast('Product added', 'success');
      }
      closeModal();
      await loadInventory();
    } catch (err) { showToast(err.message, 'error'); return false; }
  });
}

async function openAddStockModal(productId) {
  const p = _products.find(x => x.id === productId);
  const bodyHTML = `
    <div style="margin-bottom:12px">
      <strong>${p.name}</strong><br/>
      <span style="color:var(--text-muted);font-size:13px">Current stock: ${p.quantity} units</span>
    </div>
    <form id="addStockForm">
      <div class="form-group">
        <label class="form-label">Quantity to Add *</label>
        <input class="form-input" id="addStockQty" name="quantity" type="number" min="1" required placeholder="e.g. 10" />
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <input class="form-input" name="notes" placeholder="e.g. Supplier delivery" />
      </div>
    </form>
  `;
  openModal('Add Stock', bodyHTML, async () => {
    const form = document.getElementById('addStockForm');
    const fd = new FormData(form);
    const qty = Number(fd.get('quantity'));
    const notes = fd.get('notes');
    if (!qty || qty < 1) { showToast('Enter a valid quantity', 'error'); return false; }
    try {
      await API.post('/api/stock-movements', { productId, quantity: qty, notes });
      showToast(`Added ${qty} units to ${p.name}`, 'success');
      closeModal();
      await loadInventory();
    } catch (err) { showToast(err.message, 'error'); return false; }
  });
}

async function deleteProduct(id) {
  const p = _products.find(x => x.id === id);
  if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
  try {
    await API.delete(`/api/products/${id}`);
    showToast('Product deleted', 'success');
    await loadInventory();
  } catch (err) { showToast(err.message, 'error'); }
}
