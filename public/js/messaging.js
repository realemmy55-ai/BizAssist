// messaging.js
let _messages = [];
let _msgTemplates = [];
let _msgCustomers = [];
let _msgSettings = {};
const AUTOMATION_OPTIONS = [
  ["order_confirmation", "Order confirmation", "When an order is confirmed"],
  [
    "payment_confirmation",
    "Payment confirmation",
    "When payment is recorded as paid",
  ],
  ["thank_you", "Thank-you message", "When a sale is completed"],
  [
    "dispatch",
    "Ready for dispatch",
    "When an order is ready for pickup or dispatch",
  ],
];

async function loadMessaging() {
  const content = document.getElementById("app-content");
  content.innerHTML =
    '<div class="loading-spinner-wrap"><div class="spinner"></div></div>';
  try {
    [_messages, _msgTemplates, _msgCustomers, _msgSettings] = await Promise.all(
      [
        API.get("/api/messages"),
        API.get("/api/message-templates"),
        API.get("/api/customers"),
        API.get("/api/settings"),
      ],
    );
    renderMessaging();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Failed to load messaging</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

function renderMessaging(activeTab = "messages", statusFilter = "") {
  const content = document.getElementById("app-content");
  const sorted = [..._messages].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  const filtered = statusFilter
    ? sorted.filter((m) => m.status === statusFilter)
    : sorted;

  content.innerHTML = `
    <div class="section-header">
      <h1 class="section-title">Messaging</h1>
      <div class="section-actions">
        ${activeTab === "messages" ? '<button class="btn btn-primary" id="composeBtn">✉ Compose</button>' : activeTab === "templates" ? '<button class="btn btn-primary" id="addTplBtn">+ New Template</button>' : ""}
      </div>
    </div>
    <div class="demo-alert">🧪 DEMO MODE — All messages are simulated locally. No real SMS, WhatsApp, or email is sent.</div>
    <div class="tabs">
      <button class="tab-btn ${activeTab === "messages" ? "active" : ""}" data-tab="messages">Messages (${_messages.length})</button>
      <button class="tab-btn ${activeTab === "templates" ? "active" : ""}" data-tab="templates">Templates (${_msgTemplates.length})</button>
        <button class="tab-btn ${activeTab === "automations" ? "active" : ""}" data-tab="automations">Automations</button>
    </div>

      <div id="tab-automations" class="tab-pane ${activeTab === "automations" ? "active" : ""}">
        <div class="automation-list">
          ${AUTOMATION_OPTIONS.map(
            ([key, title, description]) => `
            <label class="automation-row">
              <span><strong>${title}</strong><small>${description}</small></span>
              <input type="checkbox" data-automation="${key}" ${_msgSettings.automations?.[key] === false ? "" : "checked"} aria-label="Enable ${title}" />
            </label>`,
          ).join("")}
        </div>
        <p class="form-hint">Automations create locally stored simulation records only. No provider delivery is connected.</p>
      </div>

    <div id="tab-messages" class="tab-pane ${activeTab === "messages" ? "active" : ""}">
      <div class="filter-bar">
        ${["", "simulated", "pending", "failed"]
          .map(
            (s) =>
              `<button class="btn btn-sm ${statusFilter === s ? "btn-primary" : "btn-secondary"}" onclick="renderMessaging('messages','${s}')">${s ? capitalize(s) : "All"} (${s ? _messages.filter((m) => m.status === s).length : _messages.length})</button>`,
          )
          .join("")}
      </div>
      <div class="card">
        <div class="table-wrap">
          ${
            filtered.length === 0
              ? '<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">No messages</div><div class="empty-sub">Compose a message or complete an order to auto-generate a thank-you message.</div></div>'
              : `<table>
                <thead><tr>
                  <th>Customer</th><th>Type</th><th>Subject</th><th>Status</th><th>Date</th><th>Actions</th>
                </tr></thead>
                <tbody>${filtered
                  .map(
                    (m) => `<tr>
                  <td><strong>${m.customerName}</strong></td>
                  <td><span class="badge badge-secondary" style="font-size:10px">${m.type.replace(/_/g, " ")}</span></td>
                  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.subject}</td>
                  <td>${msgStatusBadge(m.status)}</td>
                  <td>${formatDate(m.createdAt)}</td>
                  <td>
                    <button class="btn btn-sm btn-outline" onclick="viewMessage('${m.id}')">View</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteMessage('${m.id}')">Delete</button>
                  </td>
                </tr>`,
                  )
                  .join("")}</tbody>
              </table>`
          }
        </div>
      </div>
    </div>

    <div id="tab-templates" class="tab-pane ${activeTab === "templates" ? "active" : ""}">
      <div id="templatesList">
        ${
          _msgTemplates.length === 0
            ? '<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-title">No templates</div><div class="empty-sub">Create reusable message templates.</div></div>'
            : _msgTemplates
                .map(
                  (t) => `
            <div class="template-card">
              <div>
                <div style="font-weight:600;margin-bottom:4px">${t.name}
                  <span class="badge badge-secondary" style="margin-left:6px;font-size:10px">${t.type.replace(/_/g, " ")}</span>
                </div>
                <div class="message-preview">${t.body.slice(0, 120)}${t.body.length > 120 ? "…" : ""}</div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn btn-sm btn-outline" onclick="openTemplateModal('${t.id}')">Edit</button>
                <button class="btn btn-sm btn-danger" onclick="deleteTemplate('${t.id}')">Delete</button>
              </div>
            </div>`,
                )
                .join("")
        }
      </div>
    </div>
  `;

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.onclick = () => renderMessaging(btn.dataset.tab, "");
  });

  if (activeTab === "messages") {
    document.getElementById("composeBtn").onclick = openComposeModal;
  } else if (activeTab === "templates") {
    document.getElementById("addTplBtn").onclick = () =>
      openTemplateModal(null);
  } else {
    document.querySelectorAll("[data-automation]").forEach(
      (input) =>
        (input.onchange = async (event) => {
          const automations = {
            ...(_msgSettings.automations || {}),
            [event.target.dataset.automation]: event.target.checked,
          };
          try {
            _msgSettings = await API.put("/api/settings", { automations });
            window.appSettings = _msgSettings;
            showToast("Automation setting saved", "success");
          } catch (err) {
            event.target.checked = !event.target.checked;
            showToast(err.message, "error");
          }
        }),
    );
  }
}

function msgStatusBadge(s) {
  const map = {
    simulated: "badge-info",
    pending: "badge-secondary",
    sent: "badge-warning",
    failed: "badge-danger",
  };
  const label = s === "sent" ? "Unverified legacy" : capitalize(s);
  return `<span class="badge ${map[s] || "badge-secondary"}">${label}</span>`;
}

function viewMessage(id) {
  const m = _messages.find((x) => x.id === id);
  const bodyHTML = `
    <div style="margin-bottom:14px">
      <div class="form-label">To</div>
      <div>${m.customerName}</div>
    </div>
    <div style="margin-bottom:14px">
      <div class="form-label">Subject</div>
      <div><strong>${m.subject}</strong></div>
    </div>
    <div style="margin-bottom:14px">
      <div class="form-label">Status</div>
      <div>${msgStatusBadge(m.status)}</div>
    </div>
    <div style="margin-bottom:4px"><div class="form-label">Message</div></div>
    <div style="background:var(--surface-2);border-radius:8px;padding:14px;font-size:13.5px;white-space:pre-line;line-height:1.7">${m.body}</div>
    <div style="margin-top:12px;font-size:12px;color:var(--text-muted)">Created: ${formatDate(m.createdAt)}</div>
  `;
  openModal("View Message", bodyHTML, null);
  document.querySelector(".modal-footer").innerHTML = `
    <button class="btn btn-danger btn-sm" onclick="updateMsgStatus('${m.id}','failed')">Mark simulation failed</button>
    <button class="btn btn-secondary" onclick="closeModal()">Close</button>
  `;
}

async function updateMsgStatus(id, status) {
  try {
    await API.put(`/api/messages/${id}/status`, { status });
    _messages = await API.get("/api/messages");
    showToast(`Message marked as ${status}`, "success");
    closeModal();
    renderMessaging();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function deleteMessage(id) {
  if (!confirm("Delete this message?")) return;
  try {
    await API.delete(`/api/messages/${id}`);
    _messages = await API.get("/api/messages");
    showToast("Message deleted", "success");
    renderMessaging();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openComposeModal() {
  const settings = window.appSettings || {};
  const customerOptions = _msgCustomers
    .map(
      (c) => `<option value="${c.id}" data-name="${c.name}">${c.name}</option>`,
    )
    .join("");
  const templateOptions = _msgTemplates
    .map(
      (t) =>
        `<option value="${t.id}" data-body="${encodeURIComponent(t.body)}">${t.name}</option>`,
    )
    .join("");

  const bodyHTML = `
    <div class="demo-alert">🧪 Sending is simulated — no real message will be delivered.</div>
    <form id="composeForm">
      <div class="form-group">
        <label class="form-label">Customer *</label>
        <select class="form-select" id="composeCustomer" required>
          <option value="">-- Select Customer --</option>
          ${customerOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Template</label>
        <select class="form-select" id="composeTemplate">
          <option value="">-- Select Template (optional) --</option>
          ${templateOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Subject *</label>
        <input class="form-input" id="composeSubject" name="subject" required placeholder="Message subject" value="Message from ${settings.businessName || "Us"}" />
      </div>
      <div class="form-group">
        <label class="form-label">Message Body *</label>
        <textarea class="form-textarea" id="composeBody" name="body" required style="min-height:160px" placeholder="Type your message…"></textarea>
        <div class="form-hint">Placeholders: {{customerName}} {{businessName}} {{orderNumber}} {{orderTotal}}</div>
      </div>
    </form>
  `;
  openModal("Compose Message", bodyHTML, async () => {
    const customerEl = document.getElementById("composeCustomer");
    const body = document.getElementById("composeBody").value.trim();
    const subject = document.getElementById("composeSubject").value.trim();
    if (!customerEl.value) {
      showToast("Select a customer", "error");
      return false;
    }
    if (!body) {
      showToast("Message body cannot be empty", "error");
      return false;
    }
    const opt = customerEl.options[customerEl.selectedIndex];
    try {
      await API.post("/api/messages", {
        customerId: customerEl.value,
        customerName: opt.text,
        subject,
        body,
        type: "custom",
      });
      _messages = await API.get("/api/messages");
      showToast("Message simulated (Demo Mode)", "info");
      closeModal();
      renderMessaging();
    } catch (err) {
      showToast(err.message, "error");
      return false;
    }
  });

  // Template auto-fill
  setTimeout(() => {
    const tplEl = document.getElementById("composeTemplate");
    const custEl = document.getElementById("composeCustomer");
    if (tplEl)
      tplEl.onchange = () => {
        const opt = tplEl.options[tplEl.selectedIndex];
        if (!opt.value) return;
        const settings = window.appSettings || {};
        let b = decodeURIComponent(opt.dataset.body || "");
        const custOpt = custEl.options[custEl.selectedIndex];
        b = b
          .replace(/{{customerName}}/g, custOpt.text || "Customer")
          .replace(/{{businessName}}/g, settings.businessName || "Our Store")
          .replace(/{{orderNumber}}/g, "N/A")
          .replace(/{{orderTotal}}/g, "N/A");
        document.getElementById("composeBody").value = b;
      };
  }, 100);
}

function openTemplateModal(tplId) {
  const t = tplId ? _msgTemplates.find((x) => x.id === tplId) : null;
  const bodyHTML = `
    <form id="tplForm">
      <div class="form-group">
        <label class="form-label">Template Name *</label>
        <input class="form-input" name="name" required placeholder="e.g. Payment Reminder" value="${t ? t.name : ""}" />
      </div>
      <div class="form-group">
        <label class="form-label">Type</label>
        <select class="form-select" name="type">
          ${[
            "order_confirmation",
            "payment_confirmation",
            "thank_you",
            "low_stock_alert",
            "custom",
          ]
            .map(
              (type) =>
                `<option value="${type}" ${t && t.type === type ? "selected" : ""}>${capitalize(type.replace(/_/g, " "))}</option>`,
            )
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Message Body *</label>
        <textarea class="form-textarea" name="body" required style="min-height:180px">${t ? t.body : ""}</textarea>
        <div class="form-hint">Use: {{customerName}} {{businessName}} {{orderNumber}} {{orderTotal}}</div>
      </div>
    </form>
  `;
  openModal(t ? "Edit Template" : "New Template", bodyHTML, async () => {
    const fd = new FormData(document.getElementById("tplForm"));
    const data = Object.fromEntries(fd.entries());
    if (!data.name || !data.body) {
      showToast("Name and body are required", "error");
      return false;
    }
    try {
      if (t) {
        await API.put(`/api/message-templates/${t.id}`, data);
        showToast("Template updated", "success");
      } else {
        await API.post("/api/message-templates", data);
        showToast("Template created", "success");
      }
      _msgTemplates = await API.get("/api/message-templates");
      closeModal();
      renderMessaging("templates");
    } catch (err) {
      showToast(err.message, "error");
      return false;
    }
  });
}

async function deleteTemplate(id) {
  if (!confirm("Delete this template? This cannot be undone.")) return;
  try {
    await API.delete(`/api/message-templates/${id}`);
    _msgTemplates = await API.get("/api/message-templates");
    showToast("Template deleted", "success");
    renderMessaging("templates");
  } catch (err) {
    showToast(err.message, "error");
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
