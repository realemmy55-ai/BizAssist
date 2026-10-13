const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = __dirname;
const tempRoot = path.join(os.tmpdir(), `bizassist-regression-${Date.now()}`);
fs.cpSync(repoRoot, tempRoot, { recursive: true, force: true });

const resetData = {
  customers: [],
  messages: [],
  messageTemplates: [],
  orders: [],
  products: [],
  sales: [],
  settings: {},
  stockMovements: [],
};

for (const [file, value] of Object.entries(resetData)) {
  fs.writeFileSync(
    path.join(tempRoot, "data", `${file}.json`),
    JSON.stringify(value, null, 2),
  );
}

const serverFile = path.join(tempRoot, "server.js");
const port = 3217;
const child = spawn(process.execPath, [serverFile], {
  cwd: tempRoot,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
child.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://localhost:${port}/api/products`);
      if (res.ok) return;
    } catch (error) {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`Server did not start in time. Output:\n${serverOutput}`);
}

async function api(pathname, method = "GET", body) {
  const res = await fetch(`http://localhost:${port}${pathname}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = text;
  }
  if (!res.ok) {
    throw new Error(
      `API failed ${method} ${pathname}: ${JSON.stringify(data)}`,
    );
  }
  return data;
}

(async () => {
  try {
    await waitForServer();

    const product = await api("/api/products", "POST", {
      name: "Regression Widget",
      sku: "REG-001",
      costPrice: 20,
      sellingPrice: 50,
      quantity: 10,
      lowStockThreshold: 2,
      category: "Test",
    });

    const customer = await api("/api/customers", "POST", {
      name: "Regression Customer",
      phone: "08000000000",
      email: "reg@example.com",
    });

    const sale = await api("/api/sales", "POST", {
      customerId: customer.id,
      customerName: customer.name,
      items: [
        {
          productId: product.id,
          productName: product.name,
          qty: 3,
          unitPrice: 50,
        },
      ],
      paymentMethod: "cash",
      paymentStatus: "paid",
      discount: 10,
      notes: "regression-sale",
    });

    const remainingAfterSale = (await api("/api/products")).find(
      (item) => item.id === product.id,
    ).quantity;
    if (remainingAfterSale !== 7) {
      throw new Error(
        `Direct sale stock mismatch. Expected 7, got ${remainingAfterSale}`,
      );
    }

    const settings = await api("/api/settings", "PUT", {
      businessName: "Regression Co",
      automations: {
        order_confirmation: false,
        payment_confirmation: true,
        thank_you: true,
      },
    });
    if (settings.automations.order_confirmation !== false) {
      throw new Error("Settings automation merge failed");
    }

    const order = await api("/api/orders", "POST", {
      customerId: customer.id,
      customerName: customer.name,
      items: [
        {
          productId: product.id,
          productName: product.name,
          qty: 2,
          unitPrice: 50,
        },
      ],
      paymentStatus: "unpaid",
      paymentMethod: "cash",
      notes: "regression-order",
    });

    const confirmed = await api(`/api/orders/${order.id}/status`, "PUT", {
      status: "confirmed",
      paymentStatus: "paid",
    });
    const cancelled = await api(`/api/orders/${order.id}/status`, "PUT", {
      status: "cancelled",
    });
    const restoredQty = (await api("/api/products")).find(
      (item) => item.id === product.id,
    ).quantity;
    if (restoredQty !== 7) {
      throw new Error(
        `Order cancellation restore mismatch. Expected 7, got ${restoredQty}`,
      );
    }

    const messages = await api("/api/messages");
    const thankYous = messages.filter(
      (message) => message.type === "thank_you",
    );
    if (thankYous.length !== 1) {
      throw new Error(`Expected 1 thank-you message; got ${thankYous.length}`);
    }

    const analytics = await api("/api/analytics?days=30");
    const expectedTotal = sale.total;
    if (Math.round(Number(analytics.totalRevenue)) !== expectedTotal) {
      throw new Error(
        `Analytics revenue mismatch. Expected ${expectedTotal}, got ${analytics.totalRevenue}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          directSaleRemaining: remainingAfterSale,
          orderStatus: confirmed.status,
          cancelStatus: cancelled.status,
          thankYouCount: thankYous.length,
          analyticsRevenue: analytics.totalRevenue,
          settingsAutomation: settings.automations.order_confirmation,
        },
        null,
        2,
      ),
    );

    child.kill("SIGTERM");
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    if (!child.killed) child.kill("SIGTERM");
    process.exit(1);
  }
})();
