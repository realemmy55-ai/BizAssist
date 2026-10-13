"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, "data");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Data helpers ────────────────────────────────────────────────────────────

function dataPath(file) {
  return path.join(DATA_DIR, file + ".json");
}

function readData(file) {
  const filePath = dataPath(file);
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) {
      return [
        "products",
        "customers",
        "orders",
        "sales",
        "messages",
        "stockMovements",
        "messageTemplates",
      ].includes(file)
        ? []
        : {};
    }
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Data read fallback for ${file}:`, error.message);
    return [
      "products",
      "customers",
      "orders",
      "sales",
      "messages",
      "stockMovements",
      "messageTemplates",
    ].includes(file)
      ? []
      : {};
  }
}

function writeData(file, data) {
  const filePath = dataPath(file);
  const tempPath = filePath + ".tmp";
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (error) {
    console.error(`Failed to write ${file}:`, error.message);
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (unlinkError) {
        console.error(
          `Failed to clean temp file ${tempPath}:`,
          unlinkError.message,
        );
      }
    }
    return false;
  }
}

function now() {
  return new Date().toISOString();
}

const AUTOMATION_DEFAULTS = {
  order_confirmation: true,
  payment_confirmation: true,
  thank_you: true,
  dispatch: true,
};

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

const PAYMENT_STATUSES = ["paid", "unpaid", "part_paid", "refunded"];

function paymentRecord(record) {
  const total = normalizeNumber(record.total, 0);
  const normalized = { ...record };
  if (record.paymentStatus === "refunded") {
    normalized.amountPaid = Number.isFinite(record.amountPaid)
      ? record.amountPaid
      : null;
    normalized.balanceDue = 0;
    normalized.refundedAmount = Number.isFinite(record.refundedAmount)
      ? record.refundedAmount
      : total;
  } else if (Number.isFinite(record.amountPaid)) {
    normalized.balanceDue = Math.max(0, total - record.amountPaid);
  } else if (record.paymentStatus === "paid") {
    normalized.amountPaid = total;
    normalized.balanceDue = 0;
  } else if (record.paymentStatus === "unpaid") {
    normalized.amountPaid = 0;
    normalized.balanceDue = total;
  } else {
    normalized.amountPaid = null;
    normalized.balanceDue = null;
  }
  return normalized;
}

function resolvePayment(total, paymentStatus, amountPaid) {
  if (
    paymentStatus != null &&
    !PAYMENT_STATUSES.slice(0, 3).includes(paymentStatus)
  ) {
    return { error: "Invalid payment status" };
  }
  let paidAmount;
  if (amountPaid === undefined) {
    if (paymentStatus === "paid") paidAmount = total;
    else if (paymentStatus === "unpaid" || paymentStatus == null)
      paidAmount = 0;
    else return { error: "amountPaid is required for part-paid transactions" };
  } else {
    if (amountPaid === null || amountPaid === "")
      return {
        error: "amountPaid must be a finite amount between zero and the total",
      };
    paidAmount = Number(amountPaid);
    if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > total) {
      return {
        error: "amountPaid must be a finite amount between zero and the total",
      };
    }
  }

  const inferredStatus =
    total === 0 || paidAmount === total
      ? "paid"
      : paidAmount === 0
        ? "unpaid"
        : "part_paid";
  if (paymentStatus && paymentStatus !== inferredStatus) {
    return {
      error: `Payment status must be ${inferredStatus} for this amountPaid`,
    };
  }
  return {
    paymentStatus: inferredStatus,
    amountPaid: paidAmount,
    balanceDue: Math.max(0, total - paidAmount),
  };
}

function paymentMetrics(sale) {
  const total = normalizeNumber(sale.total, 0);
  const refundedAmount = Math.min(
    total,
    normalizeNumber(
      sale.refundedAmount,
      sale.paymentStatus === "refunded" ? total : 0,
    ),
  );
  const revenue = Math.max(0, total - refundedAmount);
  const cost = normalizeNumber(sale.totalCost, 0);
  const recognizedCost = sale.restockedOnRefund ? 0 : cost;
  return { revenue, profit: revenue - recognizedCost, cost: recognizedCost };
}

function notifyPaymentComplete(record) {
  if (record.paymentStatus !== "paid") return;
  _simulateOrderMessage(
    {
      ...record,
      id: record.id,
      orderId: record.orderId || record.id,
    },
    "payment_confirmation",
  );
}

function aggregateItems(items) {
  if (!Array.isArray(items)) return [];
  const map = new Map();
  for (const item of items) {
    const productId = item.productId;
    const qty = normalizeNumber(item.qty, 0);
    if (!productId || qty <= 0) continue;
    if (!map.has(productId)) {
      map.set(productId, {
        productId,
        productName: item.productName || "",
        qty,
        unitPrice: normalizeNumber(item.unitPrice, 0),
      });
      continue;
    }
    const existing = map.get(productId);
    existing.qty += qty;
    existing.unitPrice = Math.max(
      existing.unitPrice,
      normalizeNumber(item.unitPrice, 0),
    );
  }
  return Array.from(map.values());
}

function recordStockMovement(
  productId,
  productName,
  quantity,
  notes,
  type = "deduction",
) {
  const movements = readData("stockMovements");
  movements.push({
    id: "mov-" + uuidv4().slice(0, 8),
    productId,
    productName,
    type,
    quantity: Math.abs(Number(quantity) || 0),
    notes: notes || "",
    createdAt: now(),
  });
  writeData("stockMovements", movements);
}

function restoreStockOnce(products, movements, items, operationId, notes) {
  const aggregatedItems = aggregateItems(items);
  for (const item of aggregatedItems) {
    if (!products.some((product) => product.id === item.productId)) {
      return { error: `Product ${item.productId} not found` };
    }
  }

  let productsChanged = false;
  for (const item of aggregatedItems) {
    const product = products.find((entry) => entry.id === item.productId);
    const restorationIds = Array.isArray(product.stockRestorationIds)
      ? product.stockRestorationIds
      : [];
    if (restorationIds.includes(operationId)) continue;
    product.quantity += item.qty;
    product.stockRestorationIds = [...restorationIds, operationId];
    productsChanged = true;
  }

  let movementsChanged = false;
  for (const item of aggregatedItems) {
    if (
      movements.some(
        (movement) =>
          movement.operationId === operationId &&
          movement.productId === item.productId,
      )
    )
      continue;
    const product = products.find((entry) => entry.id === item.productId);
    movements.push({
      id: "mov-" + uuidv4().slice(0, 8),
      operationId,
      productId: item.productId,
      productName: product.name,
      type: "addition",
      quantity: item.qty,
      notes,
      createdAt: now(),
    });
    movementsChanged = true;
  }

  if (productsChanged && !writeData("products", products))
    return { error: "Could not save returned inventory" };
  if (movementsChanged && !writeData("stockMovements", movements))
    return {
      error: "Inventory restored; movement log write failed and can be retried",
    };
  return { restored: productsChanged };
}

function automationEnabled(type) {
  const settings = readData("settings");
  const automations =
    settings && settings.automations ? settings.automations : {};
  return automations[type] !== false && AUTOMATION_DEFAULTS[type] !== false;
}

function _simulateOrderMessage(order, type) {
  if (!automationEnabled(type)) return;
  const messages = readData("messages");
  if (
    messages.some(
      (message) => message.orderId === order.id && message.type === type,
    )
  )
    return;
  const templates = readData("messageTemplates");
  const settings = readData("settings");
  const labels = {
    order_confirmation: [
      "Order Confirmation",
      `Hello ${order.customerName}, your order ${order.id} has been confirmed.`,
    ],
    payment_confirmation: [
      "Payment Confirmation",
      `Hello ${order.customerName}, payment for order ${order.id} has been recorded.`,
    ],
    dispatch: [
      "Dispatch Update",
      `Hello ${order.customerName}, order ${order.id} is ready for pickup or dispatch.`,
    ],
  };
  const [subject, fallback] = labels[type];
  const template = templates.find((item) => item.type === type);
  const body = (template ? template.body : fallback)
    .replace(/{{customerName}}/g, order.customerName)
    .replace(/{{businessName}}/g, settings.businessName || "Our Store")
    .replace(/{{orderNumber}}/g, order.id)
    .replace(/{{orderTotal}}/g, "₦" + Number(order.total).toLocaleString());
  messages.push({
    id: "msg-" + uuidv4().slice(0, 8),
    customerId: order.customerId,
    customerName: order.customerName,
    type,
    subject,
    body,
    status: "simulated",
    orderId: order.id,
    createdAt: now(),
  });
  writeData("messages", messages);
}

// ─── Settings ─────────────────────────────────────────────────────────────────

app.get("/api/settings", (req, res) => {
  res.json(readData("settings"));
});

app.put("/api/settings", (req, res) => {
  const current = readData("settings");
  const next = {
    ...current,
    ...req.body,
    automations: {
      ...(current.automations || {}),
      ...(req.body.automations || {}),
    },
  };
  writeData("settings", next);
  res.json(next);
});

// ─── Products ────────────────────────────────────────────────────────────────

app.get("/api/products", (req, res) => {
  res.json(
    readData("products").map(({ stockRestorationIds, ...product }) => product),
  );
});

app.post("/api/products", (req, res) => {
  const {
    name,
    sku,
    category,
    costPrice,
    sellingPrice,
    quantity,
    lowStockThreshold,
    description,
  } = req.body;

  if (!name || !sku || sellingPrice == null || quantity == null) {
    return res
      .status(400)
      .json({ error: "name, sku, sellingPrice, and quantity are required" });
  }

  const parsedCost = normalizeNumber(costPrice, 0);
  const parsedSelling = normalizeNumber(sellingPrice, NaN);
  const parsedQuantity = normalizeNumber(quantity, NaN);
  const parsedThreshold = normalizeNumber(lowStockThreshold, 5);

  if (
    !Number.isFinite(parsedSelling) ||
    !Number.isFinite(parsedQuantity) ||
    parsedCost < 0 ||
    parsedSelling < 0 ||
    parsedQuantity < 0 ||
    parsedThreshold < 0 ||
    !Number.isInteger(parsedQuantity)
  ) {
    return res.status(400).json({
      error: "Prices, threshold, and quantity must be non-negative and valid",
    });
  }

  const products = readData("products");
  if (products.find((p) => p.sku === sku)) {
    return res.status(400).json({ error: "SKU already exists" });
  }
  const product = {
    id: "prod-" + uuidv4().slice(0, 8),
    name,
    sku,
    category: category || "General",
    costPrice: parsedCost,
    sellingPrice: parsedSelling,
    quantity: parsedQuantity,
    lowStockThreshold: parsedThreshold,
    description: description || "",
    createdAt: now(),
  };
  products.push(product);
  writeData("products", products);
  res.status(201).json(product);
});

app.put("/api/products/:id", (req, res) => {
  const products = readData("products");
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Product not found" });
  const {
    name,
    sku,
    category,
    costPrice,
    sellingPrice,
    quantity,
    lowStockThreshold,
    description,
  } = req.body;

  if (
    sellingPrice != null &&
    (!Number.isFinite(Number(sellingPrice)) || Number(sellingPrice) < 0)
  )
    return res.status(400).json({ error: "sellingPrice must be non-negative" });
  if (
    costPrice != null &&
    (!Number.isFinite(Number(costPrice)) || Number(costPrice) < 0)
  )
    return res.status(400).json({ error: "costPrice must be non-negative" });
  if (
    quantity != null &&
    (!Number.isFinite(Number(quantity)) ||
      Number(quantity) < 0 ||
      !Number.isInteger(Number(quantity)))
  )
    return res
      .status(400)
      .json({ error: "quantity must be a non-negative integer" });
  if (
    lowStockThreshold != null &&
    (!Number.isFinite(Number(lowStockThreshold)) ||
      Number(lowStockThreshold) < 0 ||
      !Number.isInteger(Number(lowStockThreshold)))
  )
    return res
      .status(400)
      .json({ error: "lowStockThreshold must be a non-negative integer" });

  if (sku && sku !== products[idx].sku && products.find((p) => p.sku === sku)) {
    return res.status(400).json({ error: "SKU already in use" });
  }

  const previousQty = products[idx].quantity;
  const nextQty = quantity != null ? Number(quantity) : previousQty;
  const quantityDelta = nextQty - previousQty;

  products[idx] = {
    ...products[idx],
    ...(name != null && { name }),
    ...(sku != null && { sku }),
    ...(category != null && { category }),
    ...(costPrice != null && { costPrice: Number(costPrice) }),
    ...(sellingPrice != null && { sellingPrice: Number(sellingPrice) }),
    ...(quantity != null && { quantity: Number(quantity) }),
    ...(lowStockThreshold != null && {
      lowStockThreshold: Number(lowStockThreshold),
    }),
    ...(description != null && { description }),
  };

  if (quantity != null && quantityDelta !== 0) {
    const deltaType = quantityDelta > 0 ? "addition" : "deduction";
    recordStockMovement(
      products[idx].id,
      products[idx].name,
      Math.abs(quantityDelta),
      `Manual quantity adjustment (${quantityDelta > 0 ? "increase" : "decrease"})`,
      deltaType,
    );
  }

  writeData("products", products);
  res.json(products[idx]);
});

app.delete("/api/products/:id", (req, res) => {
  const products = readData("products");
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Product not found" });
  products.splice(idx, 1);
  writeData("products", products);
  res.json({ success: true });
});

// ─── Customers ────────────────────────────────────────────────────────────────

app.get("/api/customers", (req, res) => {
  res.json(readData("customers"));
});

app.post("/api/customers", (req, res) => {
  const { name, phone, email, notes } = req.body;
  if (!name)
    return res.status(400).json({ error: "Customer name is required" });
  const customers = readData("customers");
  const customer = {
    id: "cust-" + uuidv4().slice(0, 8),
    name,
    phone: phone || "",
    email: email || "",
    notes: notes || "",
    createdAt: now(),
  };
  customers.push(customer);
  writeData("customers", customers);
  res.status(201).json(customer);
});

app.put("/api/customers/:id", (req, res) => {
  const customers = readData("customers");
  const idx = customers.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Customer not found" });
  const { name, phone, email, notes } = req.body;
  customers[idx] = {
    ...customers[idx],
    ...(name != null && { name }),
    ...(phone != null && { phone }),
    ...(email != null && { email }),
    ...(notes != null && { notes }),
  };
  writeData("customers", customers);
  res.json(customers[idx]);
});

app.delete("/api/customers/:id", (req, res) => {
  const customers = readData("customers");
  const idx = customers.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Customer not found" });
  customers.splice(idx, 1);
  writeData("customers", customers);
  res.json({ success: true });
});

// ─── Stock Movements ──────────────────────────────────────────────────────────

app.get("/api/stock-movements", (req, res) => {
  res.json(readData("stockMovements"));
});

app.post("/api/stock-movements", (req, res) => {
  const { productId, quantity, notes } = req.body;
  if (!productId || !quantity || quantity <= 0) {
    return res
      .status(400)
      .json({ error: "productId and positive quantity are required" });
  }
  const products = readData("products");
  const pidx = products.findIndex((p) => p.id === productId);
  if (pidx === -1) return res.status(404).json({ error: "Product not found" });

  products[pidx].quantity += Number(quantity);
  writeData("products", products);

  const movements = readData("stockMovements");
  const movement = {
    id: "mov-" + uuidv4().slice(0, 8),
    productId,
    productName: products[pidx].name,
    type: "addition",
    quantity: Number(quantity),
    notes: notes || "",
    createdAt: now(),
  };
  movements.push(movement);
  writeData("stockMovements", movements);
  res.status(201).json({ movement, product: products[pidx] });
});

// ─── Sales ────────────────────────────────────────────────────────────────────

app.get("/api/sales", (req, res) => {
  res.json(readData("sales").map(paymentRecord));
});

app.post("/api/sales", (req, res) => {
  const {
    customerId,
    customerName,
    items,
    paymentMethod,
    paymentStatus,
    amountPaid,
    notes,
    orderId,
    discount,
  } = req.body;
  if (!items || !items.length)
    return res.status(400).json({ error: "items array required" });

  const discountAmount = normalizeNumber(discount, 0);
  if (!Number.isFinite(discountAmount) || discountAmount < 0)
    return res
      .status(400)
      .json({ error: "Discount must be a non-negative amount" });

  const products = readData("products");
  const normalizedItems = aggregateItems(items);
  const requested = new Map();

  for (const item of normalizedItems) {
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0 || item.qty < 1)
      return res
        .status(400)
        .json({ error: "Each item needs a positive quantity and valid price" });
    const product = products.find((p) => p.id === item.productId);
    if (!product)
      return res
        .status(400)
        .json({ error: `Product ${item.productId} not found` });
    requested.set(
      item.productId,
      (requested.get(item.productId) || 0) + item.qty,
    );
  }

  for (const [productId, qty] of requested) {
    const product = products.find((p) => p.id === productId);
    if (product.quantity < qty) {
      return res.status(400).json({
        error: `Insufficient stock for ${product.name}. Available: ${product.quantity}`,
      });
    }
  }

  const subtotal = normalizedItems.reduce(
    (sum, item) => sum + item.unitPrice * item.qty,
    0,
  );
  if (discountAmount > subtotal) {
    return res
      .status(400)
      .json({ error: "Discount cannot exceed the sale subtotal" });
  }

  const movements = readData("stockMovements");
  const saleId = "sale-" + uuidv4().slice(0, 8);
  let totalCost = 0;
  const enrichedItems = [];

  for (const item of normalizedItems) {
    const pidx = products.findIndex((p) => p.id === item.productId);
    products[pidx].quantity -= item.qty;
    const cost = products[pidx].costPrice || 0;
    totalCost += cost * item.qty;
    enrichedItems.push({
      productId: item.productId,
      productName: products[pidx].name,
      qty: item.qty,
      unitPrice: item.unitPrice,
      costPrice: cost,
    });
    movements.push({
      id: "mov-" + uuidv4().slice(0, 8),
      productId: item.productId,
      productName: products[pidx].name,
      type: "deduction",
      quantity: item.qty,
      notes: `Sale ${saleId}`,
      createdAt: now(),
    });
  }

  const saleTotal = Math.max(0, subtotal - discountAmount);
  const payment = resolvePayment(saleTotal, paymentStatus, amountPaid);
  if (payment.error) return res.status(400).json({ error: payment.error });
  const sale = {
    id: saleId,
    orderId: orderId || null,
    customerId: customerId || null,
    customerName: customerName || "Walk-in Customer",
    items: enrichedItems,
    subtotal,
    discount: discountAmount,
    total: saleTotal,
    totalCost,
    grossProfit: saleTotal - totalCost,
    paymentMethod: paymentMethod || "cash",
    ...payment,
    notes: notes || "",
    createdAt: now(),
  };

  const sales = readData("sales");
  sales.push(sale);

  writeData("products", products);
  writeData("stockMovements", movements);
  writeData("sales", sales);

  _autoThankYouMessage(sale);
  if (sale.paymentStatus === "paid")
    _simulateOrderMessage(sale, "payment_confirmation");

  res.status(201).json(sale);
});

app.put("/api/sales/:id/payment", (req, res) => {
  const sales = readData("sales");
  const index = sales.findIndex((sale) => sale.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Sale not found" });
  const sale = paymentRecord(sales[index]);
  if (sale.paymentStatus === "refunded")
    return res
      .status(409)
      .json({ error: "A refunded sale cannot receive payment" });
  const linkedOrders = readData("orders");
  const linkedOrder = linkedOrders.find((order) => order.id === sale.orderId);
  const knownPaidAmounts = [
    sale.amountPaid,
    linkedOrder && linkedOrder.amountPaid,
  ].filter(Number.isFinite);
  if (knownPaidAmounts.length === 0 && req.body.amountPaid === undefined)
    return res.status(400).json({
      error:
        "Enter the actual cumulative amount paid for this legacy part-paid sale",
    });

  const payment = resolvePayment(
    sale.total,
    req.body.paymentStatus,
    req.body.amountPaid,
  );
  if (payment.error) return res.status(400).json({ error: payment.error });
  if (
    knownPaidAmounts.length &&
    payment.amountPaid < Math.max(...knownPaidAmounts)
  )
    return res.status(400).json({
      error:
        "amountPaid cannot be less than the previously recorded amountPaid",
    });
  Object.assign(sale, payment);
  if (req.body.paymentMethod != null)
    sale.paymentMethod = req.body.paymentMethod;
  sales[index] = sale;
  if (!writeData("sales", sales))
    return res.status(500).json({ error: "Could not save sale payment" });

  const orders = linkedOrders;
  const orderIndex = orders.findIndex((order) => order.id === sale.orderId);
  if (orderIndex !== -1) {
    Object.assign(orders[orderIndex], payment);
    if (!writeData("orders", orders))
      return res
        .status(500)
        .json({ error: "Sale payment saved but order payment sync failed" });
  }
  notifyPaymentComplete(sale);
  res.json(sale);
});

function _autoThankYouMessage(sale) {
  const messages = readData("messages");
  const templates = readData("messageTemplates");
  const settings = readData("settings");
  const exists = messages.find(
    (m) =>
      m.type === "thank_you" &&
      (m.saleId === sale.id ||
        (sale.orderId && m.orderId === sale.orderId) ||
        (!sale.orderId && m.saleId === sale.id)),
  );
  if (exists) return;

  const tpl = templates.find((t) => t.type === "thank_you");
  const body = tpl
    ? tpl.body
        .replace(/{{customerName}}/g, sale.customerName)
        .replace(/{{businessName}}/g, settings.businessName || "Our Store")
        .replace(/{{orderNumber}}/g, sale.orderId || sale.id)
        .replace(/{{orderTotal}}/g, "₦" + sale.total.toLocaleString())
    : `Dear ${sale.customerName},\n\nThank you for your purchase at ${settings.businessName}!\n\nOrder: ${sale.orderId || sale.id}\n\nWarm regards,\n${settings.businessName}`;

  messages.push({
    id: "msg-" + uuidv4().slice(0, 8),
    customerId: sale.customerId,
    customerName: sale.customerName,
    type: "thank_you",
    subject: "Thank You for Your Purchase!",
    body,
    status: "simulated",
    saleId: sale.id,
    orderId: sale.orderId,
    createdAt: now(),
  });
  writeData("messages", messages);
}

// ─── Orders ───────────────────────────────────────────────────────────────────

app.get("/api/orders", (req, res) => {
  res.json(readData("orders").map(paymentRecord));
});

app.post("/api/orders", (req, res) => {
  const {
    customerId,
    customerName,
    items,
    paymentMethod,
    paymentStatus,
    amountPaid,
    notes,
  } = req.body;
  if (!items || !items.length)
    return res.status(400).json({ error: "Order must have at least one item" });
  if (!customerName)
    return res.status(400).json({ error: "Customer name is required" });
  if (paymentStatus && !["paid", "unpaid", "part_paid"].includes(paymentStatus))
    return res.status(400).json({ error: "Invalid payment status" });
  const products = readData("products");
  for (const item of items) {
    if (
      !Number.isInteger(Number(item.qty)) ||
      Number(item.qty) < 1 ||
      !Number.isFinite(Number(item.unitPrice)) ||
      Number(item.unitPrice) < 0
    )
      return res.status(400).json({
        error:
          "Order items need a positive whole quantity and non-negative price",
      });
    if (!products.some((product) => product.id === item.productId))
      return res
        .status(400)
        .json({ error: `Product ${item.productId} not found` });
  }

  const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const payment = resolvePayment(total, paymentStatus || "unpaid", amountPaid);
  if (payment.error) return res.status(400).json({ error: payment.error });
  const order = {
    id: "ord-" + uuidv4().slice(0, 8),
    customerId: customerId || null,
    customerName,
    items,
    total,
    status: "pending",
    ...payment,
    paymentMethod: paymentMethod || "cash",
    notes: notes || "",
    stockDeducted: false,
    saleId: null,
    createdAt: now(),
  };
  const orders = readData("orders");
  orders.push(order);
  writeData("orders", orders);
  notifyPaymentComplete(order);
  res.status(201).json(order);
});

app.put("/api/orders/:id/payment", (req, res) => {
  const orders = readData("orders");
  const index = orders.findIndex((order) => order.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Order not found" });
  const order = paymentRecord(orders[index]);
  if (order.paymentStatus === "refunded")
    return res
      .status(409)
      .json({ error: "A refunded order cannot receive payment" });
  const sales = readData("sales");
  const linkedSale = sales.find((sale) => sale.orderId === order.id);
  const knownPaidAmounts = [
    order.amountPaid,
    linkedSale && linkedSale.amountPaid,
  ].filter(Number.isFinite);
  if (knownPaidAmounts.length === 0 && req.body.amountPaid === undefined)
    return res.status(400).json({
      error:
        "Enter the actual cumulative amount paid for this legacy part-paid order",
    });

  const payment = resolvePayment(
    order.total,
    req.body.paymentStatus,
    req.body.amountPaid,
  );
  if (payment.error) return res.status(400).json({ error: payment.error });
  if (
    knownPaidAmounts.length &&
    payment.amountPaid < Math.max(...knownPaidAmounts)
  )
    return res.status(400).json({
      error:
        "amountPaid cannot be less than the previously recorded amountPaid",
    });
  Object.assign(order, payment);
  if (req.body.paymentMethod != null)
    order.paymentMethod = req.body.paymentMethod;
  orders[index] = order;
  if (!writeData("orders", orders))
    return res.status(500).json({ error: "Could not save order payment" });

  const saleIndex = sales.findIndex((sale) => sale.orderId === order.id);
  if (saleIndex !== -1) {
    Object.assign(sales[saleIndex], payment);
    if (!writeData("sales", sales))
      return res
        .status(500)
        .json({ error: "Order payment saved but sale payment sync failed" });
  }
  notifyPaymentComplete(order);
  res.json(order);
});

function processFullRefund({ sale, order, reason, returnedStock }) {
  if (returnedStock != null && typeof returnedStock !== "boolean") {
    return { status: 400, error: "returnedStock must be true or false" };
  }
  const saleAlreadyRefunded = sale && sale.paymentStatus === "refunded";
  const orderAlreadyRefunded = order && order.paymentStatus === "refunded";
  if (saleAlreadyRefunded && (!order || orderAlreadyRefunded))
    return { status: 409, error: "This sale has already been refunded" };
  if (orderAlreadyRefunded && (!sale || saleAlreadyRefunded))
    return { status: 409, error: "This order has already been refunded" };

  const target = sale || order;
  if (!target) return { status: 404, error: "Transaction not found" };
  const normalized = paymentRecord(target);
  const collected = normalized.amountPaid;
  if (
    !saleAlreadyRefunded &&
    !orderAlreadyRefunded &&
    (!Number.isFinite(collected) || collected <= 0)
  )
    return { status: 409, error: "There is no recorded payment to refund" };
  if (
    !saleAlreadyRefunded &&
    !orderAlreadyRefunded &&
    sale &&
    collected < normalizeNumber(sale.total, 0)
  )
    return {
      status: 409,
      error: "A full sale refund requires the sale to be fully paid",
    };

  if (returnedStock && order && order.status !== "completed")
    return {
      status: 409,
      error: "Stock can only be returned for a completed order",
    };

  const items = sale ? sale.items : order.items;
  const restorationId = `refund:${sale ? sale.id : order.id}`;
  const products = readData("products");
  const aggregatedItems = aggregateItems(items);
  const restorationRecorded =
    aggregatedItems.length > 0 &&
    aggregatedItems.every((item) => {
      const product = products.find((entry) => entry.id === item.productId);
      return (
        product &&
        Array.isArray(product.stockRestorationIds) &&
        product.stockRestorationIds.includes(restorationId)
      );
    });
  const shouldReturnStock = Boolean(
    returnedStock === true ||
    restorationRecorded ||
    (sale && sale.restockedOnRefund) ||
    (order && order.restockedOnRefund),
  );
  if (shouldReturnStock) {
    const restoration = restoreStockOnce(
      products,
      readData("stockMovements"),
      items,
      restorationId,
      `Refund ${sale ? sale.id : order.id} - goods returned`,
    );
    if (restoration.error)
      return {
        status: restoration.error.includes("Product ") ? 400 : 500,
        error: restoration.error,
      };
  }

  const refundedAt = now();
  if (sale) {
    sale.paymentStatus = "refunded";
    sale.refundedAmount = sale.total;
    sale.refundReason =
      (saleAlreadyRefunded && sale.refundReason) || reason || "Full refund";
    sale.refundedAt = (saleAlreadyRefunded && sale.refundedAt) || refundedAt;
    sale.balanceDue = 0;
    sale.restockedOnRefund = shouldReturnStock;
  }
  if (order) {
    order.paymentStatus = "refunded";
    order.refundedAmount =
      (orderAlreadyRefunded && order.refundedAmount) || collected;
    order.refundReason =
      (orderAlreadyRefunded && order.refundReason) || reason || "Full refund";
    order.refundedAt = (orderAlreadyRefunded && order.refundedAt) || refundedAt;
    order.balanceDue = 0;
    order.restockedOnRefund = shouldReturnStock;
    if (shouldReturnStock) order.stockDeducted = false;
  }

  if (sale) {
    const sales = readData("sales");
    const index = sales.findIndex((entry) => entry.id === sale.id);
    sales[index] = sale;
    if (!writeData("sales", sales))
      return { status: 500, error: "Could not save refund" };
  }
  if (order) {
    const orders = readData("orders");
    const index = orders.findIndex((entry) => entry.id === order.id);
    orders[index] = order;
    if (!writeData("orders", orders))
      return { status: 500, error: "Could not save refund" };
  }
  return { data: sale || order };
}

app.post("/api/sales/:id/refund", (req, res) => {
  const sales = readData("sales");
  const sale = sales.find((entry) => entry.id === req.params.id);
  if (!sale) return res.status(404).json({ error: "Sale not found" });
  const orders = readData("orders");
  const order = orders.find((entry) => entry.id === sale.orderId);
  const result = processFullRefund({ sale, order, ...req.body });
  if (result.error)
    return res.status(result.status).json({ error: result.error });
  res.json(paymentRecord(result.data));
});

app.post("/api/orders/:id/refund", (req, res) => {
  const orders = readData("orders");
  const order = orders.find((entry) => entry.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const sales = readData("sales");
  const sale = sales.find((entry) => entry.orderId === order.id);
  const result = processFullRefund({ sale, order, ...req.body });
  if (result.error)
    return res.status(result.status).json({ error: result.error });
  res.json(paymentRecord(order));
});

app.put("/api/orders/:id/status", (req, res) => {
  const { status, paymentStatus, paymentMethod } = req.body;
  const orders = readData("orders");
  const idx = orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Order not found" });

  const order = orders[idx];
  if (status === "refunded") {
    const sale = readData("sales").find(
      (record) => record.orderId === order.id,
    );
    const result = processFullRefund({ sale, order, ...req.body });
    if (result.error)
      return res.status(result.status).json({ error: result.error });
    return res.json(paymentRecord(result.data));
  }
  const prevStatus = order.status;
  const prevPaymentStatus = order.paymentStatus;

  let paymentUpdate = null;
  if (paymentStatus != null || req.body.amountPaid != null) {
    paymentUpdate = resolvePayment(
      order.total,
      paymentStatus,
      req.body.amountPaid,
    );
    if (paymentUpdate.error)
      return res.status(400).json({ error: paymentUpdate.error });
    if (
      Number.isFinite(order.amountPaid) &&
      paymentUpdate.amountPaid < order.amountPaid
    )
      return res.status(400).json({
        error:
          "amountPaid cannot be less than the previously recorded amountPaid",
      });
  }

  const validStatuses = [
    "pending",
    "confirmed",
    "processing",
    "ready",
    "completed",
    "cancelled",
  ];
  if (!validStatuses.includes(status))
    return res.status(400).json({ error: "Invalid status" });
  const transitions = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["processing", "cancelled"],
    processing: ["ready", "cancelled"],
    ready: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
    refunded: [],
  };
  if (status !== prevStatus && !transitions[prevStatus]?.includes(status))
    return res
      .status(409)
      .json({ error: `Cannot move an order from ${prevStatus} to ${status}` });
  if (paymentStatus && !["paid", "unpaid", "part_paid"].includes(paymentStatus))
    return res.status(400).json({ error: "Invalid payment status" });

  if (paymentUpdate) Object.assign(order, paymentUpdate);

  const products = readData("products");
  const aggregatedItems = aggregateItems(order.items);

  if (
    ["confirmed", "processing", "ready"].includes(status) &&
    !order.stockDeducted
  ) {
    for (const item of aggregatedItems) {
      const product = products.find((p) => p.id === item.productId);
      if (!product)
        return res
          .status(400)
          .json({ error: `Product ${item.productId} not found` });
      if (product.quantity < item.qty)
        return res.status(400).json({
          error: `Insufficient stock for ${product.name}. Available: ${product.quantity}`,
        });
    }

    const movements = readData("stockMovements");
    for (const item of aggregatedItems) {
      const product = products.find((p) => p.id === item.productId);
      product.quantity -= item.qty;
      movements.push({
        id: "mov-" + uuidv4().slice(0, 8),
        productId: item.productId,
        productName: product.name,
        type: "deduction",
        quantity: item.qty,
        notes: `Order ${order.id} confirmed - stock reserved`,
        createdAt: now(),
      });
    }
    writeData("products", products);
    writeData("stockMovements", movements);
    orders[idx].stockDeducted = true;
  }

  if (status === "completed" && prevStatus !== "completed") {
    if (!order.stockDeducted) {
      for (const item of aggregatedItems) {
        const product = products.find((p) => p.id === item.productId);
        if (!product)
          return res
            .status(400)
            .json({ error: `Product ${item.productId} not found` });
        if (product.quantity < item.qty)
          return res.status(400).json({
            error: `Insufficient stock for ${product.name}. Available: ${product.quantity}`,
          });
      }
    }

    const sales = readData("sales");
    const existingSale = sales.find((s) => s.orderId === order.id);
    if (!existingSale) {
      const movements = readData("stockMovements");
      let subtotal = 0;
      let totalCost = 0;
      const enrichedItems = [];

      for (const item of aggregatedItems) {
        const product = products.find((p) => p.id === item.productId);
        if (!order.stockDeducted) {
          product.quantity -= item.qty;
          movements.push({
            id: "mov-" + uuidv4().slice(0, 8),
            productId: item.productId,
            productName: product.name,
            type: "deduction",
            quantity: item.qty,
            notes: `Order ${order.id} completed`,
            createdAt: now(),
          });
        }
        subtotal += (item.unitPrice || 0) * item.qty;
        totalCost += (product.costPrice || 0) * item.qty;
        enrichedItems.push({
          productId: item.productId,
          productName: item.productName || product.name,
          qty: item.qty,
          unitPrice: item.unitPrice || product.sellingPrice,
          costPrice: product.costPrice || 0,
        });
      }

      if (!order.stockDeducted) {
        writeData("products", products);
        writeData("stockMovements", movements);
        orders[idx].stockDeducted = true;
      }

      const saleId = "sale-" + uuidv4().slice(0, 8);
      const orderPayment = paymentRecord(order);
      const sale = {
        id: saleId,
        orderId: order.id,
        customerId: order.customerId,
        customerName: order.customerName,
        items: enrichedItems,
        subtotal,
        total: subtotal,
        totalCost,
        grossProfit: subtotal - totalCost,
        paymentMethod: paymentMethod || order.paymentMethod,
        paymentStatus: orderPayment.paymentStatus,
        amountPaid: orderPayment.amountPaid,
        balanceDue: orderPayment.balanceDue,
        notes: order.notes,
        createdAt: now(),
      };
      sales.push(sale);
      writeData("sales", sales);
      orders[idx].saleId = saleId;
    }

    const completedSale = readData("sales").find(
      (sale) => sale.orderId === order.id,
    );
    if (completedSale) _autoThankYouMessage(completedSale);
  }

  if (status === "cancelled" && order.stockDeducted) {
    const restoration = restoreStockOnce(
      products,
      readData("stockMovements"),
      order.items,
      `cancel:${order.id}`,
      `Order ${order.id} cancelled - stock restored`,
    );
    if (restoration.error)
      return res
        .status(restoration.error.includes("Product ") ? 400 : 500)
        .json({ error: restoration.error });
    orders[idx].stockDeducted = false;
  }

  orders[idx].status = status;
  if (paymentMethod) orders[idx].paymentMethod = paymentMethod;
  if (!writeData("orders", orders))
    return res.status(500).json({ error: "Could not save order status" });
  if (status === "confirmed" && prevStatus !== "confirmed")
    _simulateOrderMessage(orders[idx], "order_confirmation");
  if (status === "ready" && prevStatus !== "ready")
    _simulateOrderMessage(orders[idx], "dispatch");
  if (orders[idx].paymentStatus === "paid" && prevPaymentStatus !== "paid")
    notifyPaymentComplete(orders[idx]);
  res.json(orders[idx]);
});

app.delete("/api/orders/:id", (req, res) => {
  const orders = readData("orders");
  const idx = orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Order not found" });

  const order = orders[idx];
  if (order.stockDeducted && order.status !== "completed") {
    const products = readData("products");
    const movements = readData("stockMovements");
    const restoration = restoreStockOnce(
      products,
      movements,
      order.items,
      `delete:${order.id}`,
      `Order ${order.id} deleted - stock restored`,
    );
    if (restoration.error)
      return res
        .status(restoration.error.includes("Product ") ? 400 : 500)
        .json({ error: restoration.error });
  }

  orders.splice(idx, 1);
  if (!writeData("orders", orders))
    return res.status(500).json({ error: "Could not delete order" });
  res.json({ success: true });
});

// ─── Messages ────────────────────────────────────────────────────────────────

app.get("/api/messages", (req, res) => {
  res.json(readData("messages"));
});

app.post("/api/messages", (req, res) => {
  const { customerId, customerName, type, subject, body, orderId, saleId } =
    req.body;
  if (!body || !customerName)
    return res.status(400).json({ error: "body and customerName required" });
  const messages = readData("messages");
  const message = {
    id: "msg-" + uuidv4().slice(0, 8),
    customerId: customerId || null,
    customerName,
    type: type || "custom",
    subject: subject || "Message",
    body,
    status: "simulated",
    saleId: saleId || null,
    orderId: orderId || null,
    createdAt: now(),
  };
  messages.push(message);
  writeData("messages", messages);
  res.status(201).json(message);
});

app.put("/api/messages/:id/status", (req, res) => {
  const { status } = req.body;
  if (!["pending", "simulated", "failed"].includes(status))
    return res.status(400).json({
      error: "A message can only be marked sent after provider confirmation",
    });
  const messages = readData("messages");
  const idx = messages.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Message not found" });
  messages[idx].status = status;
  writeData("messages", messages);
  res.json(messages[idx]);
});

app.delete("/api/messages/:id", (req, res) => {
  const messages = readData("messages");
  const idx = messages.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Message not found" });
  messages.splice(idx, 1);
  writeData("messages", messages);
  res.json({ success: true });
});

// ─── Message Templates ────────────────────────────────────────────────────────

app.get("/api/message-templates", (req, res) => {
  res.json(readData("messageTemplates"));
});

app.post("/api/message-templates", (req, res) => {
  const { name, type, body } = req.body;
  if (!name || !body)
    return res.status(400).json({ error: "name and body required" });
  const templates = readData("messageTemplates");
  const template = {
    id: "tpl-" + uuidv4().slice(0, 8),
    name,
    type: type || "custom",
    body,
  };
  templates.push(template);
  writeData("messageTemplates", templates);
  res.status(201).json(template);
});

app.put("/api/message-templates/:id", (req, res) => {
  const templates = readData("messageTemplates");
  const idx = templates.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Template not found" });
  const { name, type, body } = req.body;
  templates[idx] = {
    ...templates[idx],
    ...(name != null && { name }),
    ...(type != null && { type }),
    ...(body != null && { body }),
  };
  writeData("messageTemplates", templates);
  res.json(templates[idx]);
});

app.delete("/api/message-templates/:id", (req, res) => {
  const templates = readData("messageTemplates");
  const idx = templates.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Template not found" });
  templates.splice(idx, 1);
  writeData("messageTemplates", templates);
  res.json({ success: true });
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

app.get("/api/dashboard", (req, res) => {
  const sales = readData("sales");
  const recognizedSales = sales;
  const products = readData("products");
  const orders = readData("orders");

  const todayStr = new Date().toISOString().slice(0, 10);
  const todaySales = recognizedSales.filter(
    (s) => s.createdAt.slice(0, 10) === todayStr,
  );
  const todayRevenue = todaySales.reduce(
    (sum, sale) => sum + paymentMetrics(sale).revenue,
    0,
  );
  const todayProfit = todaySales.reduce(
    (sum, sale) => sum + paymentMetrics(sale).profit,
    0,
  );

  const totalRevenue = recognizedSales.reduce(
    (sum, sale) => sum + paymentMetrics(sale).revenue,
    0,
  );
  const totalProfit = recognizedSales.reduce(
    (sum, sale) => sum + paymentMetrics(sale).profit,
    0,
  );

  const settings = readData("settings");
  const lowStockThreshold = settings.lowStockThreshold || 5;
  const lowStockItems = products.filter(
    (p) => p.quantity <= p.lowStockThreshold || p.quantity <= lowStockThreshold,
  );

  // Best sellers (by qty sold)
  const productSales = {};
  for (const sale of recognizedSales) {
    for (const item of sale.items) {
      if (!productSales[item.productId]) {
        productSales[item.productId] = {
          name: item.productName,
          qty: 0,
          revenue: 0,
        };
      }
      if (!sale.restockedOnRefund) productSales[item.productId].qty += item.qty;
      const metrics = paymentMetrics(sale);
      const base = sale.items.reduce(
        (sum, line) => sum + (line.unitPrice || 0) * (line.qty || 0),
        0,
      );
      productSales[item.productId].revenue += base
        ? (metrics.revenue * item.unitPrice * item.qty) / base
        : 0;
    }
  }
  const bestSellers = Object.entries(productSales)
    .map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // Recent transactions (last 5 sales)
  const recentTransactions = [...recognizedSales]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  res.json({
    todayRevenue,
    todayProfit,
    todaySalesCount: todaySales.length,
    totalRevenue,
    totalProfit,
    totalOrders: orders.length,
    openOrders: orders.filter((order) =>
      ["pending", "confirmed", "processing", "ready"].includes(order.status),
    ).length,
    totalProducts: products.length,
    lowStockCount: lowStockItems.length,
    lowStockItems,
    bestSellers,
    recentTransactions,
  });
});

// ─── Analytics ───────────────────────────────────────────────────────────────

app.get("/api/analytics", (req, res) => {
  const { from, to, days } = req.query;
  const sales = readData("sales");
  const products = readData("products");
  const customers = readData("customers");
  const orders = readData("orders");

  const now = new Date();
  let startDate = from ? new Date(from) : null;
  let endDate = to ? new Date(to + "T23:59:59.999") : null;

  if (days && !from && !to) {
    startDate = new Date(now.getTime() - Number(days) * 86400000);
    endDate = now;
  }

  if (!startDate && !endDate && !days) {
    startDate = new Date(now.getTime() - 30 * 86400000);
    endDate = now;
  }

  let filteredSales = sales.filter((sale) => {
    const createdAt = new Date(sale.createdAt);
    if (startDate && createdAt < startDate) return false;
    if (endDate && createdAt > endDate) return false;
    return true;
  });

  if (from || to || days) {
    filteredSales = sales.filter((sale) => {
      const createdAt = new Date(sale.createdAt);
      if (startDate && createdAt < startDate) return false;
      if (endDate && createdAt > endDate) return false;
      return true;
    });
  }

  const recognizedSales = filteredSales;
  const totalRevenue = recognizedSales.reduce(
    (sum, sale) => sum + paymentMetrics(sale).revenue,
    0,
  );
  const totalProfit = recognizedSales.reduce(
    (sum, sale) => sum + paymentMetrics(sale).profit,
    0,
  );
  const totalCost = recognizedSales.reduce(
    (sum, sale) => sum + paymentMetrics(sale).cost,
    0,
  );
  const avgOrderValue = recognizedSales.length
    ? totalRevenue / recognizedSales.length
    : 0;

  const dayMap = {};
  const startFill =
    startDate && !days
      ? new Date(startDate)
      : new Date(now.getTime() - 29 * 86400000);
  const endFill = endDate || now;
  const dateCursor = new Date(startFill);
  while (dateCursor <= endFill) {
    const key = dateCursor.toISOString().slice(0, 10);
    dayMap[key] = { revenue: 0, profit: 0, count: 0 };
    dateCursor.setDate(dateCursor.getDate() + 1);
  }
  for (const sale of recognizedSales) {
    const day = sale.createdAt.slice(0, 10);
    if (dayMap[day]) {
      const metrics = paymentMetrics(sale);
      dayMap[day].revenue += metrics.revenue;
      dayMap[day].profit += metrics.profit;
      if (metrics.revenue > 0) dayMap[day].count += 1;
    }
  }
  const revenueByDay = Object.entries(dayMap).map(([date, data]) => ({
    date,
    ...data,
  }));

  const productSalesMap = {};
  for (const product of products) {
    productSalesMap[product.id] = {
      id: product.id,
      name: product.name,
      qty: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
    };
  }
  for (const sale of recognizedSales) {
    const saleSubtotal = sale.items.reduce(
      (sum, item) => sum + (item.unitPrice || 0) * (item.qty || 0),
      0,
    );
    const saleRevenue = paymentMetrics(sale).revenue;
    for (const item of sale.items) {
      const nextValue = (item.unitPrice || 0) * (item.qty || 0);
      const itemRevenue =
        saleSubtotal > 0 ? (nextValue / saleSubtotal) * saleRevenue : 0;
      const itemCost = sale.restockedOnRefund
        ? 0
        : (item.costPrice || 0) * (item.qty || 0);
      if (!productSalesMap[item.productId]) {
        productSalesMap[item.productId] = {
          id: item.productId,
          name: item.productName,
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        };
      }
      if (!sale.restockedOnRefund)
        productSalesMap[item.productId].qty += item.qty;
      productSalesMap[item.productId].revenue += itemRevenue;
      productSalesMap[item.productId].cost += itemCost;
      productSalesMap[item.productId].profit += itemRevenue - itemCost;
    }
  }
  const productStats = Object.values(productSalesMap)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      qty: entry.qty,
      revenue: entry.revenue,
      cost: entry.cost,
      profit: entry.profit,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const bestSellers = productStats.slice(0, 5);
  const slowMovers = [...productStats]
    .sort((a, b) => a.qty - b.qty)
    .slice(0, 5);

  const categoryMap = {};
  for (const sale of recognizedSales) {
    const saleSubtotal = sale.items.reduce(
      (sum, item) => sum + (item.unitPrice || 0) * (item.qty || 0),
      0,
    );
    const saleRevenue = paymentMetrics(sale).revenue;
    for (const item of sale.items) {
      const product = products.find((p) => p.id === item.productId);
      const cat = product ? product.category : "Unknown";
      const lineValue = (item.unitPrice || 0) * (item.qty || 0);
      categoryMap[cat] =
        (categoryMap[cat] || 0) +
        (saleSubtotal > 0 ? (lineValue / saleSubtotal) * saleRevenue : 0);
    }
  }
  const revenueByCategory = Object.entries(categoryMap).map(
    ([category, revenue]) => ({ category, revenue }),
  );

  const inventoryValuation = products.map((p) => ({
    id: p.id,
    name: p.name,
    quantity: p.quantity,
    costPrice: p.costPrice,
    totalValue: p.costPrice * p.quantity,
    sellingPrice: p.sellingPrice,
    potentialRevenue: p.sellingPrice * p.quantity,
  }));
  const totalInventoryValue = inventoryValuation.reduce(
    (s, p) => s + p.totalValue,
    0,
  );

  const custMap = {};
  for (const sale of recognizedSales) {
    if (!sale.customerId) continue;
    if (!custMap[sale.customerId]) {
      custMap[sale.customerId] = {
        customerId: sale.customerId,
        customerName: sale.customerName,
        totalSpent: 0,
        purchases: 0,
        lastPurchase: null,
      };
    }
    custMap[sale.customerId].totalSpent += paymentMetrics(sale).revenue;
    custMap[sale.customerId].purchases += 1;
    if (
      !custMap[sale.customerId].lastPurchase ||
      sale.createdAt > custMap[sale.customerId].lastPurchase
    ) {
      custMap[sale.customerId].lastPurchase = sale.createdAt;
    }
  }
  const customerActivity = Object.values(custMap).sort(
    (a, b) => b.totalSpent - a.totalSpent,
  );

  res.json({
    totalRevenue,
    totalProfit,
    totalCost,
    avgOrderValue,
    totalSales: recognizedSales.length,
    revenueByDay,
    revenueByCategory,
    bestSellers,
    slowMovers,
    productStats,
    inventoryValuation,
    totalInventoryValue,
    customerActivity,
    sales: filteredSales,
  });
});

// ─── Fallback to index.html ───────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n✅ Business Assistant running at http://localhost:${PORT}`);
  console.log(`   [DEMO MODE] Using local JSON data files`);
  console.log(`   Data directory: ${DATA_DIR}\n`);
});
