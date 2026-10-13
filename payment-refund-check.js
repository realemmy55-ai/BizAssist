const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const vm = require("vm");

const tempRoot = path.join(os.tmpdir(), `bizassist-payment-${Date.now()}`);
const port = 3227;
const dataFiles = {
  customers: [],
  messages: [],
  messageTemplates: [],
  orders: [],
  products: [],
  sales: [],
  settings: {},
  stockMovements: [],
};

fs.cpSync(__dirname, tempRoot, { recursive: true, force: true });
for (const [name, value] of Object.entries(dataFiles)) {
  fs.writeFileSync(
    path.join(tempRoot, "data", `${name}.json`),
    JSON.stringify(value, null, 2),
  );
}

const legacyProduct = {
  id: "prod-legacy",
  name: "Legacy item",
  sku: "LEGACY",
  category: "Test",
  costPrice: 10,
  sellingPrice: 30,
  quantity: 10,
  lowStockThreshold: 1,
};
const legacySale = {
  id: "sale-legacy",
  orderId: "ord-legacy",
  customerId: null,
  customerName: "Legacy Customer",
  items: [
    {
      productId: legacyProduct.id,
      productName: legacyProduct.name,
      qty: 1,
      unitPrice: 30,
      costPrice: 10,
    },
  ],
  subtotal: 30,
  total: 30,
  totalCost: 10,
  grossProfit: 20,
  paymentMethod: "cash",
  paymentStatus: "part_paid",
  createdAt: new Date().toISOString(),
};
const legacyOrder = {
  id: "ord-legacy",
  customerId: null,
  customerName: "Legacy Customer",
  items: [
    {
      productId: legacyProduct.id,
      productName: legacyProduct.name,
      qty: 1,
      unitPrice: 30,
    },
  ],
  total: 30,
  status: "completed",
  paymentStatus: "part_paid",
  paymentMethod: "cash",
  stockDeducted: true,
  saleId: legacySale.id,
  createdAt: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(tempRoot, "data", "products.json"),
  JSON.stringify([legacyProduct], null, 2),
);
fs.writeFileSync(
  path.join(tempRoot, "data", "sales.json"),
  JSON.stringify([legacySale], null, 2),
);
fs.writeFileSync(
  path.join(tempRoot, "data", "orders.json"),
  JSON.stringify([legacyOrder], null, 2),
);

const failWriteHook = path.join(tempRoot, "fail-write-once.js");
fs.writeFileSync(
  failWriteHook,
  `
const fs = require("fs");
const originalWriteFileSync = fs.writeFileSync;
fs.writeFileSync = function (filePath, ...args) {
  const trigger = process.env.BIZASSIST_FAIL_WRITE_TRIGGER;
  const target = trigger && fs.existsSync(trigger) ? fs.readFileSync(trigger, "utf8").trim() : "";
  if (target && String(filePath).endsWith(target + ".tmp")) {
    fs.unlinkSync(trigger);
    throw new Error("Injected one-shot write failure for " + target);
  }
  return originalWriteFileSync.call(this, filePath, ...args);
};
`,
);

const child = spawn(
  process.execPath,
  ["-r", failWriteHook, path.join(tempRoot, "server.js")],
  {
    cwd: tempRoot,
    env: {
      ...process.env,
      PORT: String(port),
      BIZASSIST_FAIL_WRITE_TRIGGER: path.join(tempRoot, "fail-next-write"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const serverOutput = [];
child.stdout.on("data", (chunk) => serverOutput.push(chunk.toString()));
child.stderr.on("data", (chunk) => serverOutput.push(chunk.toString()));

function triggerWriteFailure(target = "stockMovements.json") {
  fs.writeFileSync(path.join(tempRoot, "fail-next-write"), target);
}

function runFrontendSource(relativePath, globals) {
  const context = vm.createContext(globals);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, relativePath), "utf8"),
    context,
  );
  return context;
}

async function assertLegacyUiRequiresAmount() {
  let submitted = null;
  let toast = "";
  const salesContext = runFrontendSource("public/js/sales.js", {
    window: { prompt: () => "" },
    API: {
      put: async (...args) => {
        submitted = args;
      },
    },
    showToast: (message) => {
      toast = message;
    },
    loadSales: async () => {},
  });
  vm.runInContext(
    '_salesRecords = [{ id: "sale-legacy", amountPaid: null, balanceDue: null }]',
    salesContext,
  );
  await vm.runInContext('recordSalePayment("sale-legacy")', salesContext);
  assert(
    submitted === null && toast.includes("actual cumulative amount"),
    "legacy sale UI silently submitted zero",
  );

  submitted = null;
  toast = "";
  const orderContext = runFrontendSource("public/js/orders.js", {
    window: { prompt: () => "" },
    API: {
      put: async (...args) => {
        submitted = args;
      },
      get: async () => [],
    },
    showToast: (message) => {
      toast = message;
    },
    closeModal: () => {},
    renderOrders: () => {},
  });
  vm.runInContext(
    '_orders = [{ id: "ord-legacy", amountPaid: null, balanceDue: null }]',
    orderContext,
  );
  await vm.runInContext('recordOrderPayment("ord-legacy")', orderContext);
  assert(
    submitted === null && toast.includes("actual cumulative amount"),
    "legacy order UI silently submitted zero",
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(pathname, method = "GET", body, expectedStatus = 200) {
  const response = await fetch(`http://localhost:${port}${pathname}`, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  assert(
    response.status === expectedStatus,
    `${method} ${pathname}: expected ${expectedStatus}, got ${response.status}: ${text}`,
  );
  return data;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null)
      throw new Error(`Server exited early:\n${serverOutput}`);
    try {
      if ((await fetch(`http://localhost:${port}/api/products`)).ok) return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Server did not start:\n${serverOutput}`);
}

async function product(sku, quantity = 20, price = 30, cost = 10) {
  return request(
    "/api/products",
    "POST",
    {
      name: `Test ${sku}`,
      sku,
      costPrice: cost,
      sellingPrice: price,
      quantity,
      lowStockThreshold: 1,
    },
    201,
  );
}

async function orderFor(item, status = "unpaid", amountPaid) {
  return request(
    "/api/orders",
    "POST",
    {
      customerName: "Payment Regression",
      items: [
        {
          productId: item.id,
          productName: item.name,
          qty: 2,
          unitPrice: item.sellingPrice,
        },
      ],
      paymentStatus: status,
      ...(amountPaid === undefined ? {} : { amountPaid }),
    },
    201,
  );
}

async function setFulfillment(orderId, status) {
  return request(`/api/orders/${orderId}/status`, "PUT", { status });
}

(async () => {
  try {
    await waitForServer();
    const legacyRecords = await request("/api/sales");
    const legacyApiSale = legacyRecords.find(
      (record) => record.id === legacySale.id,
    );
    assert(
      legacyApiSale.amountPaid === null && legacyApiSale.balanceDue === null,
      "legacy part-paid API values were inferred as zero",
    );
    await request(`/api/sales/${legacySale.id}/payment`, "PUT", {}, 400);
    await request(`/api/orders/${legacyOrder.id}/payment`, "PUT", {}, 400);
    await assertLegacyUiRequiresAmount();
    const legacyUpdated = await request(
      `/api/sales/${legacySale.id}/payment`,
      "PUT",
      { amountPaid: 12 },
    );
    assert(
      legacyUpdated.paymentStatus === "part_paid" &&
        legacyUpdated.balanceDue === 18,
      "explicit legacy cumulative amount was not accepted",
    );

    const directProduct = await product("DIRECT");
    const sale = await request(
      "/api/sales",
      "POST",
      {
        customerName: "Payment Regression",
        items: [
          {
            productId: directProduct.id,
            productName: directProduct.name,
            qty: 1,
            unitPrice: 30,
          },
        ],
        paymentStatus: "unpaid",
      },
      201,
    );
    assert(
      sale.amountPaid === 0 && sale.balanceDue === 30,
      "unpaid direct sale defaults are incorrect",
    );
    const messagesAfterSale = await request("/api/messages");
    assert(
      messagesAfterSale.filter((message) => message.type === "thank_you")
        .length === 1,
      "direct sale should generate one thank-you",
    );

    const partialSale = await request(`/api/sales/${sale.id}/payment`, "PUT", {
      amountPaid: 12,
    });
    assert(
      partialSale.paymentStatus === "part_paid" &&
        partialSale.balanceDue === 18,
      "direct sale partial payment not represented",
    );
    const paidSale = await request(`/api/sales/${sale.id}/payment`, "PUT", {
      amountPaid: 30,
    });
    assert(
      paidSale.paymentStatus === "paid" && paidSale.balanceDue === 0,
      "direct sale payment completion failed",
    );
    for (const invalidAmount of [-1, "Infinity", "NaN", 31, null, ""]) {
      await request(
        `/api/sales/${sale.id}/payment`,
        "PUT",
        { amountPaid: invalidAmount },
        400,
      );
    }
    await request(
      `/api/sales/${sale.id}/payment`,
      "PUT",
      { amountPaid: 29 },
      400,
    );
    const afterDecrease = (await request("/api/sales")).find(
      (record) => record.id === sale.id,
    );
    assert(
      afterDecrease.amountPaid === 30,
      "decreasing cumulative payment changed the recorded amount",
    );
    const directQtyAfterInvalidPayments = (await request("/api/products")).find(
      (item) => item.id === directProduct.id,
    ).quantity;
    assert(
      directQtyAfterInvalidPayments === 19,
      "invalid payment retries changed direct-sale inventory",
    );
    assert(
      (await request("/api/messages")).filter(
        (message) => message.type === "thank_you",
      ).length === 1,
      "payment updates duplicated a thank-you",
    );

    const fulfillmentProduct = await product("FULFILL", 20, 30, 10);
    const partOrder = await orderFor(fulfillmentProduct, "part_paid", 20);
    assert(
      partOrder.amountPaid === 20 && partOrder.balanceDue === 40,
      "part-paid order amounts incorrect",
    );
    await request(
      `/api/orders/${partOrder.id}/payment`,
      "PUT",
      { amountPaid: -2 },
      400,
    );
    const afterBadPayment = (await request("/api/orders")).find(
      (entry) => entry.id === partOrder.id,
    );
    assert(
      afterBadPayment.amountPaid === 20 && afterBadPayment.balanceDue === 40,
      "failed payment attempt altered order payment state",
    );

    await setFulfillment(partOrder.id, "confirmed");
    const afterReserve = (await request("/api/products")).find(
      (item) => item.id === fulfillmentProduct.id,
    ).quantity;
    assert(afterReserve === 18, "confirmation did not reserve stock once");
    await setFulfillment(partOrder.id, "processing");
    await setFulfillment(partOrder.id, "ready");
    const completed = await setFulfillment(partOrder.id, "completed");
    assert(
      completed.status === "completed",
      "order completion did not preserve fulfillment status",
    );
    const completedQty = (await request("/api/products")).find(
      (item) => item.id === fulfillmentProduct.id,
    ).quantity;
    assert(
      completedQty === 18,
      "completion deducted reserved stock a second time",
    );
    const linkedSale = (await request("/api/sales")).find(
      (record) => record.orderId === partOrder.id,
    );
    assert(
      linkedSale &&
        linkedSale.paymentStatus === "part_paid" &&
        linkedSale.amountPaid === 20,
      "completed sale did not inherit order payment data",
    );
    const salesBeforeRepeatedCompletion = (await request("/api/sales")).filter(
      (record) => record.orderId === partOrder.id,
    ).length;
    await setFulfillment(partOrder.id, "completed");
    const salesAfterRepeatedCompletion = (await request("/api/sales")).filter(
      (record) => record.orderId === partOrder.id,
    ).length;
    assert(
      salesAfterRepeatedCompletion === salesBeforeRepeatedCompletion,
      "repeated completion duplicated the linked sale",
    );
    const linkedThankYous = (await request("/api/messages")).filter(
      (message) =>
        message.type === "thank_you" &&
        (message.orderId === partOrder.id || message.saleId === linkedSale.id),
    );
    assert(
      linkedThankYous.length === 1,
      "linked order/sale lifecycle generated duplicate thank-yous",
    );

    const paidOrder = await request(
      `/api/orders/${partOrder.id}/payment`,
      "PUT",
      { amountPaid: 60 },
    );
    assert(
      paidOrder.paymentStatus === "paid" && paidOrder.balanceDue === 0,
      "order payment completion failed",
    );
    await request(
      `/api/orders/${partOrder.id}/payment`,
      "PUT",
      { amountPaid: 59 },
      400,
    );
    const paidLinkedSale = (await request("/api/sales")).find(
      (record) => record.orderId === partOrder.id,
    );
    assert(
      paidLinkedSale.paymentStatus === "paid" &&
        paidLinkedSale.amountPaid === 60,
      "order payment was not synchronized to the linked sale",
    );

    const beforeNoReturnRefund = (await request("/api/products")).find(
      (item) => item.id === fulfillmentProduct.id,
    ).quantity;
    const refunded = await request(
      `/api/orders/${partOrder.id}/refund`,
      "POST",
      { reason: "Customer refund", returnedStock: false },
    );
    assert(
      refunded.paymentStatus === "refunded" && refunded.status === "completed",
      "refund changed payment or fulfillment state incorrectly",
    );
    const afterNoReturnRefund = (await request("/api/products")).find(
      (item) => item.id === fulfillmentProduct.id,
    ).quantity;
    assert(
      afterNoReturnRefund === beforeNoReturnRefund,
      "refund without returned goods restored stock",
    );
    await request(
      `/api/orders/${partOrder.id}/refund`,
      "POST",
      { returnedStock: false },
      409,
    );
    const afterRepeatedRefund = (await request("/api/products")).find(
      (item) => item.id === fulfillmentProduct.id,
    ).quantity;
    assert(
      afterRepeatedRefund === beforeNoReturnRefund,
      "repeated refund changed stock",
    );
    const refundedSale = (await request("/api/sales")).find(
      (record) => record.orderId === partOrder.id,
    );
    assert(
      refundedSale.refundedAmount === 60 &&
        refundedSale.refundReason === "Customer refund",
      "sale refund audit fields missing",
    );

    const returnedProduct = await product("RETURNED", 20, 30, 10);
    const returnedOrder = await orderFor(returnedProduct, "paid");
    for (const status of ["confirmed", "processing", "ready", "completed"])
      await setFulfillment(returnedOrder.id, status);
    const quantityBeforeReturn = (await request("/api/products")).find(
      (item) => item.id === returnedProduct.id,
    ).quantity;
    triggerWriteFailure();
    await request(
      `/api/orders/${returnedOrder.id}/refund`,
      "POST",
      { reason: "Goods returned", returnedStock: true },
      500,
    );
    const quantityAfterFailedRefund = (await request("/api/products")).find(
      (item) => item.id === returnedProduct.id,
    ).quantity;
    assert(
      quantityAfterFailedRefund === quantityBeforeReturn + 2,
      "failed refund did not commit its inventory marker and quantity together",
    );
    const returned = await request(
      `/api/orders/${returnedOrder.id}/refund`,
      "POST",
      { reason: "Goods returned", returnedStock: true },
    );
    assert(
      returned.restockedOnRefund === true,
      "returned stock flag was not recorded",
    );
    const quantityAfterReturn = (await request("/api/products")).find(
      (item) => item.id === returnedProduct.id,
    ).quantity;
    assert(
      quantityAfterReturn === quantityAfterFailedRefund,
      "returned stock was not restored once",
    );
    await request(
      `/api/orders/${returnedOrder.id}/refund`,
      "POST",
      { returnedStock: true },
      409,
    );
    const quantityAfterRetry = (await request("/api/products")).find(
      (item) => item.id === returnedProduct.id,
    ).quantity;
    assert(
      quantityAfterRetry === quantityAfterReturn,
      "refund retry restored stock twice",
    );

    const refundRetryResults = [];
    for (const retryReturnedStock of [false, true]) {
      const suffix = retryReturnedStock ? "TRUE" : "FALSE";
      const retryProduct = await product(`RETRY-${suffix}`, 20, 30, 10);
      const retryOrder = await orderFor(retryProduct, "paid");
      for (const status of ["confirmed", "processing", "ready", "completed"])
        await setFulfillment(retryOrder.id, status);
      const quantityBeforeFailedMetadata = (
        await request("/api/products")
      ).find((item) => item.id === retryProduct.id).quantity;

      triggerWriteFailure("sales.json");
      await request(
        `/api/orders/${retryOrder.id}/refund`,
        "POST",
        { reason: "Returned goods; metadata retry", returnedStock: true },
        500,
      );
      const quantityAfterMetadataFailure = (
        await request("/api/products")
      ).find((item) => item.id === retryProduct.id).quantity;
      assert(
        quantityAfterMetadataFailure === quantityBeforeFailedMetadata + 2,
        `metadata failure did not persist returned stock for retry=${retryReturnedStock}`,
      );

      const retryResult = await request(
        `/api/orders/${retryOrder.id}/refund`,
        "POST",
        {
          reason: "Returned goods; metadata retry",
          returnedStock: retryReturnedStock,
        },
      );
      assert(
        retryResult.restockedOnRefund === true,
        `retry with returnedStock=${retryReturnedStock} downgraded the order return flag`,
      );
      const retryOrderRecord = (await request("/api/orders")).find(
        (entry) => entry.id === retryOrder.id,
      );
      const retrySaleRecord = (await request("/api/sales")).find(
        (entry) => entry.orderId === retryOrder.id,
      );
      assert(
        retryOrderRecord.restockedOnRefund === true &&
          retrySaleRecord.restockedOnRefund === true,
        `retry with returnedStock=${retryReturnedStock} did not persist returned flags on both records`,
      );
      const quantityAfterRetry = (await request("/api/products")).find(
        (item) => item.id === retryProduct.id,
      ).quantity;
      assert(
        quantityAfterRetry === quantityAfterMetadataFailure,
        `retry with returnedStock=${retryReturnedStock} restored stock twice`,
      );
      const retryAnalytics = await request("/api/analytics?days=30");
      const retryStats = retryAnalytics.productStats.find(
        (entry) => entry.id === retryProduct.id,
      );
      assert(
        retryStats && retryStats.qty === 0 && retryStats.revenue === 0,
        `retry with returnedStock=${retryReturnedStock} reports goods as not returned`,
      );
      refundRetryResults.push({
        retryReturnedStock,
        firstAttemptStatus: 500,
        finalRestockedOnRefund: retryOrderRecord.restockedOnRefund,
        restoredQuantity: quantityAfterRetry - quantityBeforeFailedMetadata,
        reportedNetQty: retryStats.qty,
      });
    }

    const cancelProduct = await product("CANCEL", 10, 30, 10);
    const cancelledOrder = await orderFor(cancelProduct);
    await setFulfillment(cancelledOrder.id, "confirmed");
    triggerWriteFailure();
    await request(
      `/api/orders/${cancelledOrder.id}/status`,
      "PUT",
      { status: "cancelled" },
      500,
    );
    const quantityAfterFailedCancel = (await request("/api/products")).find(
      (item) => item.id === cancelProduct.id,
    ).quantity;
    assert(
      quantityAfterFailedCancel === 10,
      "failed cancellation did not persist restored quantity exactly once",
    );
    await setFulfillment(cancelledOrder.id, "cancelled");
    const cancelledRecord = (await request("/api/orders")).find(
      (entry) => entry.id === cancelledOrder.id,
    );
    assert(
      cancelledRecord.paymentStatus === "unpaid" &&
        cancelledRecord.refundedAmount === undefined,
      "cancellation incorrectly recorded a financial refund",
    );
    const quantityAfterCancel = (await request("/api/products")).find(
      (item) => item.id === cancelProduct.id,
    ).quantity;
    assert(
      quantityAfterCancel === 10,
      "cancellation did not release reserved stock",
    );
    await setFulfillment(cancelledOrder.id, "cancelled");
    const quantityAfterCancelRetry = (await request("/api/products")).find(
      (item) => item.id === cancelProduct.id,
    ).quantity;
    assert(
      quantityAfterCancelRetry === 10,
      "repeated cancellation restored stock twice",
    );

    const analytics = await request("/api/analytics?days=30");
    const returnedStats = analytics.productStats.find(
      (entry) => entry.id === returnedProduct.id,
    );
    assert(
      returnedStats && returnedStats.qty === 0 && returnedStats.revenue === 0,
      "returned goods remain in net product sales",
    );
    const dashboard = await request("/api/dashboard");
    const dashboardReturnedStats = dashboard.bestSellers.find(
      (entry) => entry.id === returnedProduct.id,
    );
    assert(
      dashboardReturnedStats &&
        dashboardReturnedStats.qty === returnedStats.qty,
      "dashboard and analytics disagree on returned quantities",
    );

    const salesContext = runFrontendSource("public/js/sales.js", {
      window: {},
    });
    const allSales = await request("/api/sales");
    salesContext.auditSales = allSales;
    const salesTotals = vm.runInContext(
      "salesFinancialTotals(auditSales)",
      salesContext,
    );
    assert(
      Math.abs(salesTotals.revenue - dashboard.totalRevenue) < 0.001,
      "Sales page and dashboard revenue disagree",
    );
    assert(
      Math.abs(salesTotals.profit - dashboard.totalProfit) < 0.001,
      "Sales page and dashboard profit disagree",
    );
    assert(
      Math.abs(analytics.totalRevenue - dashboard.totalRevenue) < 0.001,
      "dashboard and analytics revenue disagree",
    );
    assert(
      Math.abs(analytics.totalProfit - dashboard.totalProfit) < 0.001,
      "dashboard and analytics profit disagree",
    );

    console.log(
      JSON.stringify(
        {
          unpaidSale: {
            amountPaid: sale.amountPaid,
            balanceDue: sale.balanceDue,
          },
          salePaymentCompletion: paidSale.paymentStatus,
          partPaidOrder: {
            amountPaid: partOrder.amountPaid,
            balanceDue: partOrder.balanceDue,
          },
          completedOrder: completed.status,
          repeatedCompletionSales: salesAfterRepeatedCompletion,
          linkedThankYouCount: linkedThankYous.length,
          fullRefundWithoutReturn: {
            refundedAmount: refundedSale.refundedAmount,
            stockUnchanged: afterNoReturnRefund === beforeNoReturnRefund,
          },
          returnedStockOnce: quantityAfterReturn - quantityBeforeReturn,
          repeatedRefundStatus: 409,
          cancellationStockRestoredOnce: quantityAfterCancelRetry,
          failedRefundRetry: {
            statusAfterFirstAttempt: 500,
            finalStock: quantityAfterReturn,
          },
          refundMetadataFailureRetries: refundRetryResults,
          failedCancellationRetry: {
            statusAfterFirstAttempt: 500,
            finalStock: quantityAfterCancelRetry,
          },
          returnedProductNetQty: returnedStats.qty,
          reportingAgreement: {
            revenue: dashboard.totalRevenue,
            profit: dashboard.totalProfit,
            salesRevenue: salesTotals.revenue,
            salesProfit: salesTotals.profit,
            analyticsRevenue: analytics.totalRevenue,
            analyticsProfit: analytics.totalProfit,
            dashboardReturnedQty: dashboardReturnedStats.qty,
            analyticsReturnedQty: returnedStats.qty,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.stack || error.message);
    console.error(serverOutput);
    process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
  }
})();
