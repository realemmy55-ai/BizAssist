// app.js — main controller
window.appSettings = {};

const SECTION_TITLES = {
  dashboard: "Dashboard",
  inventory: "Inventory",
  sales: "Sales",
  orders: "Orders",
  customers: "Customers",
  messaging: "Messaging",
  analytics: "Analytics",
  assistant: "Business Assistant",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(amount) {
  const sym = (window.appSettings || {}).currencySymbol || "₦";
  return sym + Number(amount).toLocaleString();
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

// ── Toast ──────────────────────────────────────────────────────────────────────

function showToast(message, type = "info") {
  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || "ℹ️"}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 220);
  }, 3500);
}

// ── Modal ──────────────────────────────────────────────────────────────────────

function openModal(title, bodyHTML, onConfirm) {
  const overlay = document.getElementById("modal-overlay");
  const modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHTML;
  modal.classList.remove("modal-lg");

  const footer = document.getElementById("modal-footer");
  if (onConfirm) {
    footer.innerHTML = `
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-confirm">Confirm</button>
    `;
    document.getElementById("modal-cancel").onclick = closeModal;
    document.getElementById("modal-confirm").onclick = async () => {
      const result = await onConfirm();
      // if onConfirm returns false, keep modal open
    };
  } else {
    footer.innerHTML = `<button class="btn btn-secondary" onclick="closeModal()">Close</button>`;
  }

  overlay.classList.remove("hidden");
  // Focus first input
  setTimeout(() => {
    const inp = overlay.querySelector("input,select,textarea");
    if (inp) inp.focus();
  }, 80);
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

// Close on overlay click
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
});
document.getElementById("modal-close").onclick = closeModal;

// ── Router ─────────────────────────────────────────────────────────────────────

function navigate(section) {
  if (!section) section = "dashboard";
  // Update nav
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.section === section);
  });
  document.getElementById("topbarTitle").textContent =
    SECTION_TITLES[section] || section;
  // Close sidebar on mobile
  document.getElementById("sidebar").classList.remove("open");

  switch (section) {
    case "dashboard":
      loadDashboard();
      break;
    case "inventory":
      loadInventory();
      break;
    case "sales":
      loadSales();
      break;
    case "orders":
      loadOrders();
      break;
    case "customers":
      loadCustomers();
      break;
    case "messaging":
      loadMessaging();
      break;
    case "analytics":
      loadAnalytics();
      break;
    case "assistant":
      loadAssistant();
      break;
    default:
      loadDashboard();
  }
}

// Hash-based routing
window.addEventListener("hashchange", () => {
  const section = location.hash.replace("#", "");
  navigate(section);
});

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const section = item.dataset.section;
    history.pushState(null, "", "#" + section);
    navigate(section);
  });
});

// ── Sidebar / Hamburger ────────────────────────────────────────────────────────

document.getElementById("hamburger").onclick = () => {
  document.getElementById("sidebar").classList.toggle("open");
};
document.getElementById("sidebarClose").onclick = () => {
  document.getElementById("sidebar").classList.remove("open");
};

// ── Theme ──────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.body.classList.toggle("dark", theme === "dark");
  document.getElementById("themeIcon").textContent =
    theme === "dark" ? "☀️" : "🌙";
  document.getElementById("themeLabel").textContent =
    theme === "dark" ? "Light Mode" : "Dark Mode";
}

document.getElementById("themeToggle").onclick = async () => {
  const current = document.body.classList.contains("dark") ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    await API.put("/api/settings", { theme: next });
    window.appSettings.theme = next;
  } catch (e) {
    /* non-critical */
  }
};

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
  try {
    window.appSettings = await API.get("/api/settings");
    const bn = window.appSettings.businessName || "Business Assistant";
    document.getElementById("businessName").textContent = bn;
    document.title = bn + " — Business Assistant";
    applyTheme(window.appSettings.theme || "light");
  } catch (e) {
    console.warn("Could not load settings:", e.message);
  }

  const section = location.hash.replace("#", "") || "dashboard";
  navigate(section);
}

init();
