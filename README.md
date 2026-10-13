# Business Assistant MVP

A lightweight local business management tool covering inventory, orders, customers, messaging, and analytics.
Built with **Node.js + Express** (backend) and **vanilla HTML / CSS / JS** (frontend). No build step required.

---

## Quick Start (Windows)

```cmd
cd business-assistant
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

> Requires Node.js 18 or later. Download from https://nodejs.org if needed.

---

## Project Structure

```
business-assistant/
├── server.js           # Express API server — all routes and business logic
├── package.json
├── .gitignore
├── data/               # JSON persistence (auto-read/written by server)
│   ├── products.json
│   ├── customers.json
│   ├── orders.json
│   ├── sales.json
│   ├── stockMovements.json
│   ├── messages.json
│   ├── messageTemplates.json
│   └── settings.json
└── public/             # Static frontend — served directly by Express
    ├── index.html
    ├── css/
    │   └── style.css
    └── js/
        ├── api.js        # Fetch client
        ├── charts.js     # Chart.js wrapper
        ├── dashboard.js  # Area 1
        ├── inventory.js  # Area 2
        ├── orders.js     # Area 3
        ├── customers.js  # Area 4
        ├── messaging.js  # Area 5
        ├── analytics.js  # Area 6
        └── app.js        # Router, modal, toast, theme, helpers
```

---

## Implemented Features

### Area 1 — Dashboard
- Today's revenue and gross profit
- Total orders, product count, low-stock alerts
- Last 5 transactions with profit column
- Best-sellers list ranked by units sold
- 7-day sales line chart (Chart.js)

### Area 2 — Inventory
- Add, edit, delete products (name, SKU, category, cost, price, qty, threshold)
- In Stock / Low Stock / Out of Stock badges
- Add Stock modal — records a stock movement and updates quantity
- Stock movements history tab (all additions and deductions)
- Search by name, SKU, or category

### Area 3 — Orders
- Create orders with multiple products; auto-calculates total
- Status flow: Pending → Confirmed → Processing → Ready → Completed → Cancelled / Refunded
- Stock validation before any deduction
- Stock restored on cancellation **only if** it was previously deducted (`stockDeducted` flag)
- Completing an order creates a sale record and auto-generates a thank-you message (deduplicated)
- Search and filter by status

### Area 4 — Customers
- Add, edit, delete customers (name, phone, email, notes)
- Customer profile modal: total spent, purchase count, avg order value, full history
- Repeat Customer badge (> 1 purchase)
- Search by name, phone, or email

### Area 5 — Messaging (Simulated)
- Compose messages with customer selection and template auto-fill
- Placeholder substitution: `{{customerName}}`, `{{businessName}}`, `{{orderNumber}}`, `{{orderTotal}}`
- Statuses: Simulated, Pending, Sent, Failed
- Auto thank-you message when a sale is completed (duplicate-safe by `saleId`)
- Full template CRUD (4 built-in: Order Confirmation, Payment Confirmation, Thank You, Low Stock Alert)
- Prominent DEMO MODE banner — no real messages are ever sent

### Area 6 — Analytics
- Date range presets: Today, 7 Days, 30 Days, 90 Days, or custom from/to dates
- Revenue and profit summary cards with margin %
- Revenue-by-day line chart (revenue + profit overlaid)
- Revenue-by-category doughnut chart
- Top-5 products bar chart
- Best sellers and slow movers tables
- Inventory valuation (cost value + potential revenue per product)
- Searchable, filterable sales history
- Customer purchase activity leaderboard

### Cross-cutting
- Light / Dark mode toggle (persisted via settings API)
- Nigerian Naira (₦) currency, configurable in `data/settings.json`
- Responsive layout (hamburger sidebar on mobile)
- Toast notifications (success / error / warning / info)
- Confirmation dialogs for all destructive actions
- Data survives server restarts (synchronous JSON file I/O)

---

## API Reference (quick)

| Method | Route | Description |
|--------|-------|-------------|
| GET/POST | `/api/products` | List / create products |
| PUT/DELETE | `/api/products/:id` | Update / delete product |
| POST | `/api/stock-movements` | Add stock (updates product qty) |
| GET/POST | `/api/orders` | List / create orders |
| PUT | `/api/orders/:id/status` | Change status (handles stock + sales) |
| GET/POST | `/api/sales` | List / record a direct sale |
| GET/POST | `/api/customers` | List / create customers |
| GET/POST | `/api/messages` | List / compose messages |
| PUT | `/api/messages/:id/status` | Update message status |
| GET/POST/PUT/DELETE | `/api/message-templates` | Template CRUD |
| GET/PUT | `/api/settings` | Read / update business settings |
| GET | `/api/dashboard` | Dashboard summary |
| GET | `/api/analytics?days=30` | Analytics (supports `from`, `to`, `days`) |

---

## Known Limitations & Recommended Next Steps

| Area | Limitation | Suggested Upgrade |
|------|-----------|------------------|
| Persistence | Synchronous JSON files; single-user only | Migrate to SQLite (`better-sqlite3`) or PostgreSQL |
| Auth | No login / multi-user support | Add JWT auth or session-based login |
| Messaging | Fully simulated; no real delivery | Integrate Twilio (SMS) or Nodemailer (email) |
| Invoicing | No PDF invoice generation | Add `pdfkit` or `puppeteer` for PDF exports |
| Stock alerts | No push/email notifications | Add a background job (node-cron) for low-stock emails |
| Charts | Basic Chart.js; no export | Add chart image export or CSV download |
| Currency | Hardcoded ₦ symbol in chart ticks | Read from settings in chart callbacks |
| Mobile | Responsive but not a native PWA | Add `manifest.json` + service worker |

---

## Configuration

Edit `data/settings.json` to change business name and currency:

```json
{
  "businessName": "Cybrox Store",
  "currency": "NGN",
  "currencySymbol": "₦",
  "lowStockThreshold": 5,
  "theme": "light"
}
```

---

## Demo Data

The app ships with realistic demo data for a Nigerian electronics accessories store:
- 8 products (mix of well-stocked and low-stock items)
- 6 customers with Nigerian names
- 5 orders in different statuses
- 4 completed sales with profit calculations
- 6 stock movements
- 3 messages including an auto-generated thank-you
- 4 message templates

All data is clearly labelled **Demo Data** in the dashboard.

---

*Built as a local MVP — intended for extension in VS Code with GitHub Copilot.*
