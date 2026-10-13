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
  try {
    return JSON.parse(fs.readFileSync(dataPath(file), "utf8"));
  } catch (e) {
    return Array.isArray(JSON.parse(fs.readFileSync(dataPath(file), "utf8")))
      ? []
      : {};
  }
}

function writeData(file, data) {
  fs.writeFileSync(dataPath(file), JSON.stringify(data, null, 2));
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

function automationEnabled(type) {
  const settings = readData("settings");
  return (
    (settings.automations || {})[type] !== false &&
    AUTOMATION_DEFAULTS[type] !== false
  );
}

function _simulateOrderMessage(order, type) {
  if (!automationEnabled(type)) return;
  if (!automationEnabled("thank_you")) return;
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
  const updated = { ...current, ...req.body };
  writeData("settings", updated);
  res.json(updated);
});

// ─── Products ────────────────────────────────────────────────────────────────

app.get("/api/products", (req, res) => {
  res.json(readData("products"));
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
  if (sellingPrice < 0 || costPrice < 0 || quantity < 0) {
    return res
      .status(400)
      .json({ error: "Prices and quantity must be non-negative" });
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
    costPrice: Number(costPrice) || 0,
    sellingPrice: Number(sellingPrice),
    quantity: Number(quantity),
    lowStockThreshold: Number(lowStockThreshold) || 5,
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
  if (sellingPrice != null && sellingPrice < 0)
    return res.status(400).json({ error: "sellingPrice must be non-negative" });
  if (costPrice != null && costPrice < 0)
    return res.status(400).json({ error: "costPrice must be non-negative" });
  if (quantity != null && quantity < 0)
    return res.status(400).json({ error: "quantity must be non-negative" });
  // check sku uniqueness if changed
  if (sku && sku !== products[idx].sku && products.find((p) => p.sku === sku)) {
    return res.status(400).json({ error: "SKU already in use" });
  }
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
  res.json(readData("sales"));
});

app.post("/api/sales", (req, res) => {
  const {
    customerId,
    customerName,
    items,
    paymentMethod,
    paymentStatus,
    notes,
    orderId,
    discount,
  } = req.body;
  if (!items || !items.length)
    return res.status(400).json({ error: "items array required" });
  const discountAmount = Number(discount) || 0;
  if (!Number.isFinite(discountAmount) || discountAmount < 0)
    return res
      .status(400)
      .json({ error: "Discount must be a non-negative amount" });

  const products = readData("products");
  const requested = new Map();

  // Validate stock
  for (const item of items) {
    if (
      !Number.isInteger(Number(item.qty)) ||
      Number(item.qty) < 1 ||
      !Number.isFinite(Number(item.unitPrice)) ||
      Number(item.unitPrice) < 0
    ) {
      return res.status(400).json({
        error:
          "Each item needs a positive whole quantity and non-negative price",
      });
    }
    const p = products.find((p) => p.id === item.productId);
    if (!p)
      return res
        .status(400)
        .json({ error: `Product ${item.productId} not found` });
    requested.set(
      item.productId,
      (requested.get(item.productId) || 0) + Number(item.qty),
    );
  }
  for (const [productId, qty] of requested) {
    const product = products.find((p) => p.id === productId);
    if (product.quantity < qty)
      return res.status(400).json({
        error: `Insufficient stock for ${product.name}. Available: ${product.quantity}`,
      });
  }

  // Deduct stock and create movements
  const movements = readData("stockMovements");
  const saleId = "sale-" + uuidv4().slice(0, 8);
  let subtotal = 0,
    totalCost = 0;
  const enrichedItems = [];

  for (const item of items) {
    const pidx = products.findIndex((p) => p.id === item.productId);
    products[pidx].quantity -= Number(item.qty);
    subtotal += item.unitPrice * item.qty;
    const cost = products[pidx].costPrice || 0;
    totalCost += cost * item.qty;
    enrichedItems.push({ ...item, costPrice: cost });
    movements.push({
      id: "mov-" + uuidv4().slice(0, 8),
      productId: item.productId,
      productName: products[pidx].name,
      type: "deduction",
      quantity: Number(item.qty),
      notes: `Sale ${saleId}`,
      createdAt: now(),
    });
  }

  if (discountAmount > subtotal)
    return res
      .status(400)
      .json({ error: "Discount cannot exceed the sale subtotal" });
  writeData("products", products);
  writeData("stockMovements", movements);

  const sale = {
    id: saleId,
    orderId: orderId || null,
    customerId: customerId || null,
    customerName: customerName || "Walk-in Customer",
    items: enrichedItems,
    subtotal,
    discount: discountAmount,
    total: subtotal - discountAmount,
    totalCost,
    grossProfit: subtotal - discountAmount - totalCost,
    paymentMethod: paymentMethod || "cash",
    paymentStatus: paymentStatus || "paid",
    notes: notes || "",
    createdAt: now(),
  };

  const sales = readData("sales");
  sales.push(sale);
  writeData("sales", sales);

  // Auto thank-you message (deduplicated)
  _autoThankYouMessage(sale);
  if (sale.paymentStatus === "paid")
    _simulateOrderMessage(sale, "payment_confirmation");

  res.status(201).json(sale);
});

function _autoThankYouMessage(sale) {
  const messages = readData("messages");
  const templates = readData("messageTemplates");
  const settings = readData("settings");
  // Dedup check
  const exists = messages.find(
    (m) => m.saleId === sale.id && m.type === "thank_you",
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
  res.json(readData("orders"));
});

app.post("/api/orders", (req, res) => {
  const {
    customerId,
    customerName,
    items,
    paymentMethod,
    paymentStatus,
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
  const order = {
    id: "ord-" + uuidv4().slice(0, 8),
    customerId: customerId || null,
    customerName,
    items,
    total,
    status: "pending",
    paymentStatus: paymentStatus || "unpaid",
    paymentMethod: paymentMethod || "cash",
    notes: notes || "",
    stockDeducted: false,
    saleId: null,
    createdAt: now(),
  };
  const orders = readData("orders");
  orders.push(order);
  writeData("orders", orders);
  if (order.paymentStatus === "paid")
    _simulateOrderMessage(order, "payment_confirmation");
  res.status(201).json(order);
});

app.put("/api/orders/:id/status", (req, res) => {
  const { status, paymentStatus, paymentMethod } = req.body;
  const orders = readData("orders");
  const idx = orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Order not found" });

  const order = orders[idx];
  const prevStatus = order.status;
  const prevPaymentStatus = order.paymentStatus;

  const validStatuses = [
    "pending",
    "confirmed",
    "processing",
    "ready",
    "completed",
    "cancelled",
    "refunded",
  ];
  if (!validStatuses.includes(status))
    return res.status(400).json({ error: "Invalid status" });
  const transitions = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["processing", "cancelled"],
    processing: ["ready", "cancelled"],
    ready: ["completed", "cancelled"],
    completed: ["refunded"],
    cancelled: [],
    refunded: [],
  };
  if (status !== prevStatus && !transitions[prevStatus]?.includes(status))
    return res
      .status(409)
      .json({ error: `Cannot move an order from ${prevStatus} to ${status}` });
  if (
    paymentStatus &&
    !["paid", "unpaid", "part_paid", "refunded"].includes(paymentStatus)
  )
    return res.status(400).json({ error: "Invalid payment status" });

  const products = readData("products");

  // Reserve stock on confirmation, including legacy confirmed orders without a reservation flag.
  if (
    ["confirmed", "processing", "ready"].includes(status) &&
    !order.stockDeducted
  ) {
    for (const item of order.items) {
      const p = products.find((p) => p.id === item.productId);
      if (!p)
        return res
          .status(400)
          .json({ error: `Product ${item.productId} not found` });
      const requested = order.items
        .filter((line) => line.productId === item.productId)
        .reduce((sum, line) => sum + Number(line.qty), 0);
      if (p.quantity < requested)
        return res.status(400).json({
          error: `Insufficient stock for ${p.name}. Available: ${p.quantity}`,
        });
    }
    const movements = readData("stockMovements");
    for (const item of order.items) {
      const product = products.find((p) => p.id === item.productId);
      product.quantity -= Number(item.qty);
      movements.push({
        id: "mov-" + uuidv4().slice(0, 8),
        productId: item.productId,
        productName: product.name,
        type: "deduction",
        quantity: Number(item.qty),
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
      // Check stock
      for (const item of order.items) {
        const p = products.find((p) => p.id === item.productId);
        if (!p)
          return res
            .status(400)
            .json({ error: `Product ${item.productId} not found` });
        if (p.quantity < item.qty) {
          return res.status(400).json({
            error: `Insufficient stock for ${p.name}. Available: ${p.quantity}`,
          });
        }
      }
    }

    // Create sale if not already created
    const sales = readData("sales");
    const existingSale = sales.find((s) => s.orderId === order.id);
    if (!existingSale) {
      const movements = readData("stockMovements");
      let subtotal = 0,
        totalCost = 0;
      const enrichedItems = [];

      for (const item of order.items) {
        const pidx = products.findIndex((p) => p.id === item.productId);
        if (!order.stockDeducted) {
          products[pidx].quantity -= Number(item.qty);
          movements.push({
            id: "mov-" + uuidv4().slice(0, 8),
            productId: item.productId,
            productName: products[pidx].name,
            type: "deduction",
            quantity: Number(item.qty),
            notes: `Order ${order.id} completed`,
            createdAt: now(),
          });
        }
        subtotal += item.unitPrice * item.qty;
        const cost = products[pidx].costPrice || 0;
        totalCost += cost * item.qty;
        enrichedItems.push({ ...item, costPrice: cost });
      }

      if (!order.stockDeducted) {
        writeData("products", products);
        writeData("stockMovements", movements);
        orders[idx].stockDeducted = true;
      }

      const saleId = "sale-" + uuidv4().slice(0, 8);
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
        paymentStatus: paymentStatus || order.paymentStatus,
        notes: order.notes,
        createdAt: now(),
      };
      sales.push(sale);
      writeData("sales", sales);
      orders[idx].saleId = saleId;

      _autoThankYouMessage(sale);
    }
  }

  // Handle cancellation: restore stock only if it was deducted
  if (
    (status === "cancelled" || status === "refunded") &&
    order.stockDeducted
  ) {
    for (const item of order.items) {
      const pidx = products.findIndex((p) => p.id === item.productId);
      if (pidx !== -1) products[pidx].quantity += Number(item.qty);
    }
    writeData("products", products);
    orders[idx].stockDeducted = false;

    const movements = readData("stockMovements");
    for (const item of order.items) {
      const p = products.find((p) => p.id === item.productId);
      movements.push({
        id: "mov-" + uuidv4().slice(0, 8),
        productId: item.productId,
        productName: p ? p.name : item.productName,
        type: "addition",
        quantity: Number(item.qty),
        notes: `Order ${order.id} ${status} - stock restored`,
        createdAt: now(),
      });
    }
    writeData("stockMovements", movements);
  }

  if (status === "refunded") {
    const sales = readData("sales");
    const sale = sales.find(
      (record) => record.orderId === order.id || record.id === order.saleId,
    );
    if (sale) {
      sale.paymentStatus = "refunded";
      sale.refundedAt = now();
      writeData("sales", sales);
    }
    orders[idx].paymentStatus = "refunded";
  }

  orders[idx].status = status;
  if (paymentStatus) orders[idx].paymentStatus = paymentStatus;
  if (paymentMethod) orders[idx].paymentMethod = paymentMethod;
  writeData("orders", orders);
  if (status === "confirmed" && prevStatus !== "confirmed")
    _simulateOrderMessage(orders[idx], "order_confirmation");
  if (status === "ready" && prevStatus !== "ready")
    _simulateOrderMessage(orders[idx], "dispatch");
  if (orders[idx].paymentStatus === "paid" && prevPaymentStatus !== "paid")
    _simulateOrderMessage(orders[idx], "payment_confirmation");
  res.json(orders[idx]);
});

app.delete("/api/orders/:id", (req, res) => {
  const orders = readData("orders");
  const idx = orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Order not found" });
  orders.splice(idx, 1);
  writeData("orders", orders);
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
  const recognizedSales = sales.filter(
    (sale) => sale.paymentStatus !== "refunded",
  );
  const products = readData("products");
  const orders = readData("orders");

  const todayStr = new Date().toISOString().slice(0, 10);
  const todaySales = recognizedSales.filter(
    (s) => s.createdAt.slice(0, 10) === todayStr,
  );
  const todayRevenue = todaySales.reduce((sum, s) => sum + s.total, 0);
  const todayProfit = todaySales.reduce(
    (sum, s) => sum + (s.grossProfit || 0),
    0,
  );

  const totalRevenue = recognizedSales.reduce((sum, s) => sum + s.total, 0);
  const totalProfit = recognizedSales.reduce(
    (sum, s) => sum + (s.grossProfit || 0),
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
      productSales[item.productId].qty += item.qty;
      productSales[item.productId].revenue += item.unitPrice * item.qty;
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

  let filteredSales = sales;
  if (from || to || days) {
    const now = new Date();
    const startDate = days
      ? new Date(now - Number(days) * 86400000)
      : from
        ? new Date(from)
        : new Date(0);
    const endDate = to ? new Date(to + "T23:59:59") : now;
    filteredSales = sales.filter((s) => {
      const d = new Date(s.createdAt);
      return d >= startDate && d <= endDate;
    });
  }

  const recognizedSales = filteredSales.filter(
    (sale) => sale.paymentStatus !== "refunded",
  );

  const totalRevenue = recognizedSales.reduce((s, sale) => s + sale.total, 0);
  const totalProfit = recognizedSales.reduce(
    (s, sale) => s + (sale.grossProfit || 0),
    0,
  );
  const totalCost = recognizedSales.reduce(
    (s, sale) => s + (sale.totalCost || 0),
    0,
  );
  const avgOrderValue = recognizedSales.length
    ? totalRevenue / recognizedSales.length
    : 0;

  // Revenue by day (last 30 days default)
  const dayMap = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayMap[d.toISOString().slice(0, 10)] = { revenue: 0, profit: 0, count: 0 };
  }
  for (const sale of recognizedSales) {
    const day = sale.createdAt.slice(0, 10);
    if (dayMap[day]) {
      dayMap[day].revenue += sale.total;
      dayMap[day].profit += sale.grossProfit || 0;
      dayMap[day].count += 1;
    }
  }
  const revenueByDay = Object.entries(dayMap).map(([date, data]) => ({
    date,
    ...data,
  }));

  // Product sales
  const productSalesMap = {};
  for (const sale of recognizedSales) {
    for (const item of sale.items) {
      if (!productSalesMap[item.productId]) {
        productSalesMap[item.productId] = {
          name: item.productName,
          qty: 0,
          revenue: 0,
          cost: 0,
        };
      }
      productSalesMap[item.productId].qty += item.qty;
      productSalesMap[item.productId].revenue += item.unitPrice * item.qty;
      productSalesMap[item.productId].cost += (item.costPrice || 0) * item.qty;
    }
  }
  const productStats = Object.entries(productSalesMap)
    .map(([id, d]) => ({ id, ...d, profit: d.revenue - d.cost }))
    .sort((a, b) => b.revenue - a.revenue);

  const bestSellers = productStats.slice(0, 5);
  const slowMovers = productStats.slice(-5).reverse();

  // Category revenue
  const categoryMap = {};
  for (const sale of recognizedSales) {
    for (const item of sale.items) {
      const p = products.find((p) => p.id === item.productId);
      const cat = p ? p.category : "Unknown";
      categoryMap[cat] = (categoryMap[cat] || 0) + item.unitPrice * item.qty;
    }
  }
  const revenueByCategory = Object.entries(categoryMap).map(
    ([category, revenue]) => ({ category, revenue }),
  );

  // Inventory valuation
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

  // Customer activity
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
    custMap[sale.customerId].totalSpent += sale.total;
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
