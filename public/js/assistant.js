let _assistantData = null;

async function loadAssistant() {
  const content = document.getElementById("app-content");
  content.innerHTML =
    '<div class="loading-spinner-wrap"><div class="spinner"></div></div>';
  try {
    const [sales, products, orders, customers] = await Promise.all([
      API.get("/api/sales"),
      API.get("/api/products"),
      API.get("/api/orders"),
      API.get("/api/customers"),
    ]);
    _assistantData = { sales, products, orders, customers };
    content.innerHTML = `
      <div class="section-header"><div><h1 class="section-title">Business Assistant</h1><div class="form-hint">Local answers based on your current business records. No external AI service is connected.</div></div><span class="badge badge-info">Local data mode</span></div>
      <div class="assistant-shell">
        <div class="assistant-feed" id="assistantFeed" aria-live="polite">
          <div class="assistant-message assistant-response"><strong>Ask about your business</strong><span>I can look up recorded sales, gross profit, restocking needs, top-selling items, pending orders, and frequent customers.</span></div>
        </div>
        <div class="assistant-prompts">${["How much did I sell today?", "What was my gross profit this month?", "Which products need restocking?", "What are my five best-selling products?", "Which orders are pending?", "Who are my most frequent customers?"].map((prompt) => `<button class="btn btn-secondary btn-sm assistant-prompt" type="button">${prompt}</button>`).join("")}</div>
        <form class="assistant-input-row" id="assistantForm"><input class="form-input" id="assistantQuestion" autocomplete="off" placeholder="Ask a question about your records…" aria-label="Ask the Business Assistant" required /><button type="submit" class="btn btn-primary">Ask</button></form>
      </div>`;
    document.getElementById("assistantForm").onsubmit = (event) => {
      event.preventDefault();
      const input = document.getElementById("assistantQuestion");
      askBusinessAssistant(input.value.trim());
      input.value = "";
    };
    document
      .querySelectorAll(".assistant-prompt")
      .forEach(
        (button) =>
          (button.onclick = () => askBusinessAssistant(button.textContent)),
      );
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-title">Could not load business records</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

function askBusinessAssistant(question) {
  if (!question || !_assistantData) return;
  const feed = document.getElementById("assistantFeed");
  const prompt = document.createElement("div");
  prompt.className = "assistant-message assistant-question";
  prompt.textContent = question;
  feed.appendChild(prompt);
  const response = document.createElement("div");
  response.className = "assistant-message assistant-response";
  response.textContent = answerBusinessQuestion(question);
  feed.appendChild(response);
  feed.scrollTop = feed.scrollHeight;
}

function answerBusinessQuestion(question) {
  const { sales, products, orders, customers } = _assistantData;
  const recognizedSales = sales.filter(
    (sale) => sale.paymentStatus !== "refunded",
  );
  const text = question.toLowerCase();
  const currency = (amount) => formatCurrency(Math.round(amount));
  const today = new Date();
  const todayKey = today.toLocaleDateString("en-CA");
  if (/sell|revenue|sales|turnover/.test(text) && /today|this day/.test(text)) {
    const todaysSales = recognizedSales.filter(
      (sale) =>
        new Date(sale.createdAt).toLocaleDateString("en-CA") === todayKey,
    );
    return `Recorded today: ${currency(todaysSales.reduce((sum, sale) => sum + sale.total, 0))} across ${todaysSales.length} sale${todaysSales.length === 1 ? "" : "s"}. This counts sale records only.`;
  }
  if (/profit|margin/.test(text) && /month|monthly/.test(text)) {
    const monthSales = recognizedSales.filter((sale) => {
      const date = new Date(sale.createdAt);
      return (
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth()
      );
    });
    return `Recorded gross profit this month: ${currency(monthSales.reduce((sum, sale) => sum + (sale.grossProfit || 0), 0))} from ${monthSales.length} sale${monthSales.length === 1 ? "" : "s"}.`;
  }
  if (/restock|low.stock|out.of.stock|replenish/.test(text)) {
    const low = products.filter(
      (product) => product.quantity <= Number(product.lowStockThreshold || 0),
    );
    return low.length
      ? `Restocking needed (${low.length}): ${low.map((product) => `${product.name} (${product.quantity} on hand; threshold ${product.lowStockThreshold})`).join(", ")}.`
      : "No products are currently at or below their low-stock thresholds.";
  }
  if (/best.sell|top.sell|top product|best product/.test(text)) {
    const totals = new Map();
    recognizedSales.forEach((sale) =>
      sale.items.forEach((item) => {
        const row = totals.get(item.productId) || {
          name: item.productName,
          qty: 0,
        };
        row.qty += Number(item.qty);
        totals.set(item.productId, row);
      }),
    );
    const top = [...totals.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
    return top.length
      ? `Top products by units sold: ${top.map((item, index) => `${index + 1}. ${item.name} (${item.qty})`).join("; ")}.`
      : "There are no recorded sales to rank products yet.";
  }
  if (/pending|outstanding order/.test(text)) {
    const pending = orders.filter((order) =>
      ["pending", "confirmed", "processing", "ready"].includes(order.status),
    );
    return pending.length
      ? `${pending.length} open order${pending.length === 1 ? "" : "s"}: ${pending.map((order) => `${order.id} for ${order.customerName} (${capitalize(order.status)})`).join("; ")}.`
      : "There are no open orders in the current records.";
  }
  if (/frequent|repeat|customer|who/.test(text)) {
    const counts = new Map();
    recognizedSales.forEach((sale) => {
      if (!sale.customerId) return;
      const row = counts.get(sale.customerId) || {
        name: sale.customerName,
        purchases: 0,
        spent: 0,
      };
      row.purchases += 1;
      row.spent += sale.total;
      counts.set(sale.customerId, row);
    });
    const frequent = [...counts.values()]
      .sort((a, b) => b.purchases - a.purchases)
      .slice(0, 5);
    return frequent.length
      ? `Most frequent customers by recorded sales: ${frequent.map((customer) => `${customer.name} (${customer.purchases} purchases, ${currency(customer.spent)} spent)`).join("; ")}.`
      : `There are ${customers.length} customer profiles, but no customer-linked sales to rank yet.`;
  }
  if (/order|sale|customer|product/.test(text)) {
    return `Current records: ${sales.length} sales, ${orders.length} orders, ${products.length} products, and ${customers.length} customer profiles. Try asking about today's sales, monthly gross profit, restocking, best sellers, pending orders, or frequent customers.`;
  }
  return "I could not match that to a supported local-data query. Try one of the suggested questions; answers are calculated from the records currently stored in this demo.";
}
