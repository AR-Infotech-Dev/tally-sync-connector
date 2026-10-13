import { io } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { CONNECTOR_EVENTS as EVENTS } from "./events.js";
import { fetchSalesOrderRequest } from "../services/salesOrder.api.js";
import { updateSalesVoucherPdfStatus, uploadSalesVoucherPdf } from "../services/salesVoucherPdf.api.js";
import { buildLedgerMasterImport, buildPaymentVoucherXml, buildPurchaseOrderXml, buildPurchaseVoucherXml, buildReceiptVoucherXml, buildSalesOrderXml } from "../utils/tally-connector-engine/xml.js";
import { buildSalesInvoicePdfRequest } from "../utils/tally-connector-engine/salesInvoicePdf.js";
import { createTallyHttpTransport } from "../utils/tally-connector-engine/tallyHttpTransport.js";
import { createTallyConnectorEngine } from "../utils/tally-connector-engine/index.js";

export function createConnectorSocket({ config, notify, onActivity, temporaryDirectory }) {
  let heartbeatTimer;
  let registeredAt = null;
  const activeSalesOrders = new Set();
  const activeSalesPdfExports = new Set();
  const transactionTypesByRequest = new Map();
  const socket = io(config.serverUrl, {
    // Keep polling as a fallback when a proxy or customer network cannot
    // establish a WebSocket upgrade; Socket.IO will upgrade when available.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 15_000,
    timeout: 20_000,
  });
  const recordConnectionActivity = (status, message) => onActivity?.({ status, message, at: new Date().toISOString() });

  function getLedgerCandidates(voucher, transactionType) {
    const candidates = new Map();
    const add = (name, parent, billWise = false) => {
      if (typeof name !== "string" || !name.trim() || typeof parent !== "string" || !parent.trim()) return;
      const cleanName = name.trim();
      candidates.set(cleanName.toLocaleLowerCase(), { name: cleanName, parent: parent.trim(), billWise });
    };
    const party = voucher.party?.ledger_name || voucher.party_ledger || voucher.party_name
      || voucher.customer_ledger || voucher.customer_name || voucher.party_ledger_entry?.ledger;
    const supplierTransaction = ["purchase_order", "purchase_voucher", "payment_voucher"].includes(transactionType);
    add(party, voucher.party?.group || voucher.party?.parent || (supplierTransaction ? "Sundry Creditors" : "Sundry Debtors"), true);

    if (transactionType === "receipt_voucher") {
      const payment = voucher.payment || {};
      const paymentName = payment.ledger_name || voucher.payment_ledger;
      const paymentKind = String(payment.type || payment.account_type || "").toLowerCase();
      const paymentParent = payment.group || payment.parent
        || (paymentKind === "cash" || /\bcash\b/i.test(paymentName || "") ? "Cash-in-Hand" : "Bank Accounts");
      add(paymentName, paymentParent);
      return candidates;
    }

    if (transactionType === "payment_voucher") {
      const payment = voucher.payment || {};
      const paymentName = payment.ledger_name || voucher.payment_ledger;
      const paymentKind = String(payment.type || payment.account_type || "").toLowerCase();
      const paymentParent = payment.group || payment.parent
        || (paymentKind === "cash" || /\bcash\b/i.test(paymentName || "") ? "Cash-in-Hand" : "Bank Accounts");
      add(paymentName, paymentParent);
      return candidates;
    }

    if (transactionType === "purchase_order" || transactionType === "purchase_voucher") {
      const items = voucher.items || voucher.line_items || voucher.lineItems || [];
      for (const item of items) add(item.purchase_ledger || voucher.purchase_ledger, item.purchase_ledger_group || voucher.purchase_ledger_group || "Purchase Accounts");
      add(voucher.purchase_ledger, voucher.purchase_ledger_group || "Purchase Accounts");
      return candidates;
    }

    const items = voucher.items || voucher.line_items || voucher.lineItems || [];
    for (const item of items) {
      add(item.sales_ledger || voucher.sales_ledger, item.sales_ledger_group || voucher.sales_ledger_group || "Sales Accounts");
    }
    add(voucher.sales_ledger, voucher.sales_ledger_group || "Sales Accounts");
    return candidates;
  }

  function findMissingLedgers(errors = []) {
    return [...new Set(errors.flatMap((message) => [...String(message).matchAll(/ledger\s+['"](.+?)['"]\s+does not exist/gi)].map((match) => match[1].trim())))];
  }

  function summarizeTallyFailure(result) {
    if (result.summary && result.summary.errors === 0 && result.summary.created + result.summary.altered === 0) {
      const { ignored = 0, cancelled = 0, tallyStatus, voucherNumber } = result.summary;
      const responseExcerpt = String(result.raw || "")
        .replace(/<\/?(?:ENVELOPE|HEADER|BODY|DATA|IMPORTRESULT|TALLYMESSAGE)\b[^>]*>/gi, " ")
        .replace(/<([A-Za-z][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g, "$2 ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
        .replace(/\s+/g, " ").trim().slice(0, 700);
      const details = [
        ignored ? `ignored=${ignored}` : null,
        cancelled ? `cancelled=${cancelled}` : null,
        tallyStatus ? `Tally status=${tallyStatus}` : null,
        voucherNumber ? `Tally voucher number=${voucherNumber}` : null,
        responseExcerpt ? `response=${responseExcerpt}` : null,
      ].filter(Boolean).join(", ");
      return `Tally returned no import errors, but created or altered no vouchers.${details ? ` Import details: ${details}.` : ""} Check the selected company, voucher type, and required order/item allocations.`;
    }
    return result.summary?.lineErrors?.join("; ")
      || `Tally reported ${result.summary?.errors ?? "an"} error(s).`;
  }

  async function pushVoucherWithLedgerRecovery({ engine, tally, xml, companyName, voucherData, transactionType, timeoutMs, update }) {
    const candidates = getLedgerCandidates(voucherData, transactionType);
    const createdLedgers = new Set();
    let result;

    // Retry only after creating a missing ledger whose role and parent group are known.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      result = await engine.importXml(tally, xml, { timeoutMs });
      if (result.ok) return result;

      const missingNames = findMissingLedgers(result.summary?.lineErrors);
      if (!missingNames.length) throw new Error(summarizeTallyFailure(result));
      const ledgersToCreate = missingNames.map((name) => candidates.get(name.toLocaleLowerCase()));
      const unresolved = missingNames.filter((_name, index) => !ledgersToCreate[index]);
      if (unresolved.length) {
        throw new Error(`${summarizeTallyFailure(result)} Cannot auto-create ledger(s) without a known parent group: ${unresolved.join(", ")}.`);
      }
      const freshLedgers = ledgersToCreate.filter((ledger) => !createdLedgers.has(ledger.name.toLocaleLowerCase()));
      if (!freshLedgers.length) throw new Error(summarizeTallyFailure(result));

      update("building_xml", `Tally ledger(s) missing: ${freshLedgers.map((ledger) => ledger.name).join(", ")}. Creating under the matching standard group…`);
      const masterXml = buildLedgerMasterImport({ companyName, ledgers: freshLedgers });
      const masterResult = await engine.importXml(tally, masterXml, { timeoutMs });
      if (!masterResult.ok) {
        throw new Error(`Could not create missing Tally ledger(s): ${summarizeTallyFailure(masterResult)}`);
      }
      freshLedgers.forEach((ledger) => createdLedgers.add(ledger.name.toLocaleLowerCase()));
      update("pushing", `Created missing ledger(s): ${freshLedgers.map((ledger) => ledger.name).join(", ")}. Retrying voucher…`);
    }

    throw new Error(summarizeTallyFailure(result));
  }

  socket.on("connect", () => {
    registeredAt = null;
    recordConnectionActivity("info", `Socket connected to Server (${socket.id}); registering Connector.`);
    notify("connecting", "Socket connected. Waiting for Connector registration…", {
      socketConnected: true,
      registrationState: "pending",
      socketId: socket.id,
    });
    socket.emit(EVENTS.register, {
      client_id: config.clientId,
      connector_id: config.connectorId,
      connector_key: config.connectorKey,
    }, (result) => {
      if (!result?.success) {
        registeredAt = null;
        recordConnectionActivity("failed", `Connector registration was rejected: ${result?.message || "unknown reason"}`);
        notify("error", result?.message || "Connector registration failed.", {
          socketConnected: socket.connected,
          registrationState: "failed",
          socketId: socket.id,
        });
        return;
      }
      registeredAt = result.registered_at || new Date().toISOString();
      recordConnectionActivity("success", "Connector registration accepted by Server.");
      notify("registered", "Socket connected and Connector registered with the Server.", {
        socketConnected: true,
        registrationState: "registered",
        socketId: result.socket_id || socket.id,
        registeredAt,
      });
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        socket.emit(EVENTS.heartbeat, { at: new Date().toISOString() }, (heartbeat) => {
          if (!heartbeat?.success) notify("error", "Server rejected the heartbeat. Connector registration needs attention.", {
            socketConnected: socket.connected,
            registrationState: "failed",
            socketId: socket.id,
            registeredAt: null,
          });
        });
      }, 25_000);
    });
  });
  socket.on("connect_error", (error) => {
    clearInterval(heartbeatTimer);
    registeredAt = null;
    notify("disconnected", `Socket connection failed: ${error.message}`, {
      socketConnected: false,
      registrationState: "not_registered",
      socketId: null,
    });
    recordConnectionActivity("failed", `Socket connection failed: ${error.message}`);
  });
  socket.on("disconnect", (reason) => {
    clearInterval(heartbeatTimer);
    registeredAt = null;
    notify("disconnected", `Socket disconnected from the Server (${reason}).`, {
      socketConnected: false,
      registrationState: "not_registered",
      socketId: null,
      registeredAt: null,
    });
    recordConnectionActivity("warn", `Socket disconnected from Server (${reason}).`);
  });
  socket.io.on("reconnect_attempt", (attempt) => {
    recordConnectionActivity("warn", `Socket reconnect attempt ${attempt}.`);
  });
  socket.io.on("reconnect", () => {
    recordConnectionActivity("success", "Socket transport reconnected; registering Connector again.");
  });
  socket.io.on("reconnect_error", (error) => {
    recordConnectionActivity("failed", `Socket reconnect failed: ${error.message}`);
  });
  socket.on(EVENTS.registered, (result = {}) => notify("registered", "Connector registration confirmed by the Server.", {
    socketConnected: socket.connected,
    registrationState: "registered",
    socketId: result.socket_id || socket.id,
    registeredAt: result.registered_at || registeredAt || new Date().toISOString(),
  }));
  socket.on(EVENTS.test, (payload) => {
    notify("registered", payload?.message || "Test signal received.", {
      socketConnected: socket.connected,
      registrationState: "registered",
      socketId: socket.id,
      registeredAt,
    });
    socket.emit(EVENTS.ack, { event: EVENTS.test, received: true, at: new Date().toISOString() });
  });
  function acknowledgeTransactionSignal(signal, transactionType) {
    const label = ({ receipt_voucher: "Receipt Voucher", sales_voucher: "Sales Voucher", purchase_order: "Purchase Order", purchase_voucher: "Purchase Voucher", payment_voucher: "Payment Voucher" })[transactionType] || "Sales Order";
    recordConnectionActivity("info", `${label} push signal received${signal.request_id ? ` for ${signal.request_id}` : " without a request ID"}.`);
    if (signal.request_id) {
      transactionTypesByRequest.set(signal.request_id, transactionType);
      void processSalesOrder(signal.request_id, transactionType);
    }
    socket.emit(EVENTS.ack, {
      event: ({ receipt_voucher: EVENTS.receiptVoucherPush, sales_voucher: EVENTS.salesVoucherPush, purchase_order: EVENTS.purchaseOrderPush, purchase_voucher: EVENTS.purchaseVoucherPush, payment_voucher: EVENTS.paymentVoucherPush })[transactionType] || EVENTS.salesOrderPush,
      request_id: signal.request_id,
      received: Boolean(signal.request_id),
      at: new Date().toISOString(),
    });
  }
  socket.on(EVENTS.salesOrderPush, (signal = {}) => acknowledgeTransactionSignal(signal, "sales_order"));
  socket.on(EVENTS.salesVoucherPush, (signal = {}) => acknowledgeTransactionSignal(signal, "sales_voucher"));
  socket.on(EVENTS.receiptVoucherPush, (signal = {}) => acknowledgeTransactionSignal(signal, "receipt_voucher"));
  socket.on(EVENTS.purchaseOrderPush, (signal = {}) => acknowledgeTransactionSignal(signal, "purchase_order"));
  socket.on(EVENTS.purchaseVoucherPush, (signal = {}) => acknowledgeTransactionSignal(signal, "purchase_voucher"));
  socket.on(EVENTS.paymentVoucherPush, (signal = {}) => acknowledgeTransactionSignal(signal, "payment_voucher"));
  socket.on(EVENTS.salesVoucherPdfExport, (signal = {}) => {
    const requestId = signal.request_id;
    if (!requestId) {
      recordConnectionActivity("failed", "Sales Voucher PDF signal arrived without a request ID.");
      return;
    }
    recordConnectionActivity("info", `Sales Voucher PDF export signal received for ${requestId}.`);
    socket.emit(EVENTS.ack, { event: EVENTS.salesVoucherPdfExport, request_id: requestId, received: true, at: new Date().toISOString() });
    void processSalesVoucherPdf(requestId);
  });
  socket.on(EVENTS.heartbeatAck, () => {
    const lastHeartbeatAt = new Date().toISOString();
    notify("registered", "Connector is registered. Server heartbeat acknowledged.", {
      socketConnected: socket.connected,
      registrationState: "registered",
      socketId: socket.id,
      registeredAt,
      lastHeartbeatAt,
    });
  });

  async function processSalesOrder(requestId, transactionType = "sales_order") {
    if (activeSalesOrders.has(requestId)) return;
    activeSalesOrders.add(requestId);
    const isReceiptVoucher = transactionType === "receipt_voucher";
    const isPurchaseOrder = transactionType === "purchase_order";
    const isPurchaseVoucher = transactionType === "purchase_voucher";
    const isPaymentVoucher = transactionType === "payment_voucher";
    const transactionLabel = ({ receipt_voucher: "Receipt Voucher", sales_voucher: "Sales Voucher", purchase_order: "Purchase Order", purchase_voucher: "Purchase Voucher", payment_voucher: "Payment Voucher" })[transactionType] || "Sales Order";
    const update = (status, message, extra = {}) => {
      onActivity?.({ requestId, status, message, at: new Date().toISOString() });
      socket.emit(EVENTS.salesOrderUpdate, { request_id: requestId, transaction_type: transactionType, status, ...extra });
    };
    try {
      update("fetching", `Fetching ${transactionLabel} from Server…`);
      const request = await fetchSalesOrderRequest({ config, requestId, transactionType });
      const voucherData = isReceiptVoucher ? request.receipt
        : isPaymentVoucher ? request.payment
          : isPurchaseOrder ? request.purchase_order
            : isPurchaseVoucher ? request.purchase : request.sales || request.sales_order;
      if (!voucherData) throw new Error(`Server returned no voucher data for ${transactionLabel}.`);
      update("building_xml", `${transactionLabel} fetched. Building Tally XML…`);
      const companyName = config.tallyCompany || request.destination?.company || request.destination?.company_name;
      const xml = isReceiptVoucher
        ? buildReceiptVoucherXml({ companyName, receipt: voucherData })
        : isPaymentVoucher ? buildPaymentVoucherXml({ companyName, payment: voucherData })
          : isPurchaseOrder ? buildPurchaseOrderXml({ companyName, order: voucherData })
            : isPurchaseVoucher ? buildPurchaseVoucherXml({ companyName, purchase: voucherData })
              : buildSalesOrderXml({ companyName, order: voucherData });
      console.info(`Built Tally XML for ${transactionLabel.toLowerCase()} ${voucherData.voucher_number || "(no number)"}:\n${xml}`);
      update("pushing", `Sending ${voucherData.voucher_type || transactionLabel} voucher ${voucherData.voucher_number || "(no number)"} dated ${voucherData.date || "(no date)"} to Tally at ${config.tallyUrl}…`, { transaction_type: transactionType });
      const engine = createTallyConnectorEngine();
      const result = await pushVoucherWithLedgerRecovery({
        engine,
        tally: { url: config.tallyUrl },
        xml,
        companyName,
        voucherData,
        transactionType,
        timeoutMs: (Number(config.requestTimeoutSeconds) || 30) * 1000,
        update,
      });
      let voucherNumber = null;
      let voucherNumberSource = "unavailable";
      if (/^\d+$/.test(String(result.summary.lastVoucherId || ""))) {
        try {
          recordConnectionActivity("info", `Reading Tally voucher number for internal voucher ID ${result.summary.lastVoucherId}…`);
          const voucherLookup = await engine.getVoucherById(
            { url: config.tallyUrl },
            { companyName, voucherId: result.summary.lastVoucherId },
            { timeoutMs: (Number(config.requestTimeoutSeconds) || 30) * 1000 },
          );
          if (voucherLookup.ok && voucherLookup.voucherNumber) {
            voucherNumber = voucherLookup.voucherNumber;
            voucherNumberSource = "tally";
          } else {
            const tallyStatus = String(voucherLookup.raw || "").match(/<STATUS\b[^>]*>([\s\S]*?)<\/STATUS>/i)?.[1]?.trim() || "not provided";
            const lookupError = String(voucherLookup.raw || "").match(/<(?:LINEERROR|ERRORMSG|ERROR)\b[^>]*>([\s\S]*?)<\/(?:LINEERROR|ERRORMSG|ERROR)>/i)?.[1]
              ?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
            recordConnectionActivity("warn", `Tally accepted the voucher, but its assigned voucher number could not be read. HTTP ${voucherLookup.httpStatus}, status ${tallyStatus}${lookupError ? `, error: ${lookupError}` : ""}.`);
          }
        } catch (lookupError) {
          recordConnectionActivity("warn", `Tally accepted the voucher, but voucher number lookup failed: ${lookupError.message}`);
        }
      }
      const submittedVoucherNumber = voucherData.voucher_number || voucherData.order_number || null;
      if (!voucherNumber) {
        recordConnectionActivity("warn", `Tally import response number was not resolved for internal voucher ID ${result.summary.lastVoucherId || "(missing)"}; CRM-submitted number ${submittedVoucherNumber || "(none)"} is not being reported as the Tally number.`);
      }
      update("succeeded", `Tally accepted the voucher. Created ${result.summary.created}, altered ${result.summary.altered}.`, {
        tally_result: {
          ...result.summary,
          voucher_number: voucherNumber,
          submitted_voucher_number: submittedVoucherNumber,
          voucher_number_source: voucherNumberSource,
        },
      });
    } catch (error) {
      console.error(error);
      update("failed", error.message, { error: error.message });
    } finally {
      activeSalesOrders.delete(requestId);
    }
  }

  async function processSalesVoucherPdf(requestId) {
    if (activeSalesPdfExports.has(requestId)) return;
    activeSalesPdfExports.add(requestId);
    let outputPath;
    const updateActivity = (status, message) => onActivity?.({ requestId, status, message, at: new Date().toISOString() });
    try {
      updateActivity("fetching", "Fetching the succeeded Sales Voucher and its Tally voucher ID from Server…");
      await updateSalesVoucherPdfStatus({ config, requestId, status: "generating" });
      const request = await fetchSalesOrderRequest({ config, requestId, transactionType: "sales_voucher" });
      const voucherId = request.tally_result?.lastVoucherId;
      if (!/^\d+$/.test(String(voucherId ?? "")) || Number(voucherId) < 1) {
        throw new Error("The saved Tally response has no voucher ID. This Sales Voucher must be pushed again with the updated Connector before its PDF can be exported.");
      }

      const companyName = config.tallyCompany || request.destination?.company || request.destination?.company_name;
      if (!companyName) throw new Error("Tally company is missing from Connector settings and the saved Sales Voucher request.");
      const safeId = randomUUID();
      outputPath = path.join(temporaryDirectory || process.cwd(), `flowups-sales-invoice-${safeId}.pdf`);
      const xml = buildSalesInvoicePdfRequest({ companyName, voucherId, outputPath });
      updateActivity("building_xml", `Preparing Tally's Standard Printed Invoice export for voucher ID ${voucherId}…`);

      const timeoutMs = Math.max((Number(config.requestTimeoutSeconds) || 30) * 1000, 60_000);
      const transport = createTallyHttpTransport({ defaultTimeoutMs: timeoutMs, maxResponseBytes: 15 * 1024 * 1024 });
      const tallyResponse = await transport.postXml({ url: config.tallyUrl, timeoutMs }, xml, { timeoutMs, responseType: "buffer" });
      if (tallyResponse.status < 200 || tallyResponse.status >= 300) {
        throw new Error(`Tally PDF export returned HTTP ${tallyResponse.status}.`);
      }

      let pdf = Buffer.isBuffer(tallyResponse.body) && tallyResponse.body.subarray(0, 5).toString("ascii") === "%PDF-"
        ? tallyResponse.body
        : null;
      if (!pdf) {
        try { pdf = await readFile(outputPath); } catch {
          const responseText = Buffer.isBuffer(tallyResponse.body) ? tallyResponse.body.toString("utf8") : String(tallyResponse.body || "");
          const decodeXmlText = (value) => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">")
            .replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
          const responseFields = [...responseText.matchAll(/<(LINEERROR|ERRORMSG|ERROR|STATUS|CREATED|ALTERED|IGNORED|CANCELLED|LASTVCHID)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
            .map((match) => [match[1].toUpperCase(), decodeXmlText(match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 300)]);
          const details = Object.fromEntries(responseFields);
          const tallyError = details.LINEERROR || details.ERRORMSG || details.ERROR;
          const tallyStatus = details.STATUS;
          const responseSummary = Object.entries(details).map(([key, value]) => `${key}=${value}`).join(", ");
          const responseTags = [...new Set([...responseText.matchAll(/<([A-Za-z][\w:.-]*)\b/g)].map((match) => match[1]))].slice(0, 20);
          const responseShape = `XML bytes=${Buffer.byteLength(responseText, "utf8")}; tags=${responseTags.join(", ") || "none"}`;
          const responseHint = tallyError || (tallyStatus === "0"
            ? "Tally reported status 0 without a detailed error."
            : `Tally replied with ${tallyResponse.headers["content-type"] || "an unlabelled response"} but did not create the PDF file.`);
          throw new Error(`${responseHint}${responseSummary ? ` Tally response details: ${responseSummary}.` : ` Tally response shape: ${responseShape}.`} Confirm the Tally company, voucher ID, and that the Connector's temporary folder is writable by Tally.`);
        }
      }
      if (pdf.length < 8 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error("Tally's invoice export did not produce a valid PDF file.");
      }

      updateActivity("pushing", `Uploading Tally's Standard Sales invoice PDF (${Math.ceil(pdf.length / 1024)} KB) to Server…`);
      const voucher = request.sales || request.sales_order || {};
      const filename = `sales-${String(voucher.voucher_number || requestId).replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
      await uploadSalesVoucherPdf({ config, requestId, pdf, filename });
      updateActivity("succeeded", "Tally Standard Sales invoice PDF uploaded. CRM can download it now.");
    } catch (error) {
      console.error("Sales Voucher PDF export failed:", error);
      updateActivity("failed", error.message);
      try {
        await updateSalesVoucherPdfStatus({ config, requestId, status: "failed", error: error.message });
      } catch (statusError) {
        recordConnectionActivity("failed", `Could not update PDF job failure on Server: ${statusError.message}`);
      }
    } finally {
      activeSalesPdfExports.delete(requestId);
      if (outputPath) await rm(outputPath, { force: true }).catch(() => {});
    }
  }

  // Expose a guarded retry entry point for the Logs UI. The same in-memory
  // processing guard prevents a manual retry from duplicating an active job.
  socket.retrySalesOrder = (requestId) => {
    if (typeof requestId !== "string" || !requestId.trim()) {
      return { success: false, message: "A valid request ID is required." };
    }
    if (!socket.connected) {
      return { success: false, message: "Connect to the Server before retrying this request." };
    }
    if (activeSalesOrders.has(requestId)) {
      return { success: false, message: "This transaction is already being processed." };
    }
    void processSalesOrder(requestId, transactionTypesByRequest.get(requestId) || "sales_order");
    return { success: true };
  };

  return socket;
}
