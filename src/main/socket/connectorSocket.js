import { io } from "socket.io-client";
import { fetchLedgerStatement, fetchGroupSummary } from "../services/ledgerStatement.service.js";
import { buildSalesOrderSearchRequest, parseSalesOrderSearchResponse, buildSalesOrderObjectRequest, parseSalesOrderObjectResponse } from "../utils/tally-connector-engine/modules/vouchers/sales-order/sales-order.lookup.js";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { CONNECTOR_EVENTS as EVENTS } from "./events.js";
import { fetchSalesOrderRequest } from "../modules/vouchers/sales-order/services/sales-order.api.js";
import { fetchSalesVoucherRequest } from "../modules/vouchers/sales/services/sales.api.js";
import { fetchPurchaseOrderRequest } from "../modules/vouchers/purchase-order/services/purchase-order.api.js";
import { fetchPurchaseVoucherRequest } from "../modules/vouchers/purchase/services/purchase.api.js";
import { fetchReceiptVoucherRequest } from "../modules/vouchers/receipt/services/receipt.api.js";
import { fetchPaymentVoucherRequest } from "../modules/vouchers/payment/services/payment.api.js";
import { fetchSalesPdfJob, updateSalesVoucherPdfStatus, uploadSalesVoucherPdf } from "../modules/vouchers/sales/services/salesPdf.api.js";
import { buildSalesVoucherSearchRequest, parseSalesVoucherSearchResponse } from "../utils/tally-connector-engine/modules/vouchers/sales/sales.lookup.js";
import { buildLedgerMasterImport, buildPaymentVoucherXml, buildPurchaseOrderXml, buildPurchaseVoucherXml, buildReceiptVoucherXml, buildSalesOrderXml, buildSalesVoucherXml } from "../utils/tally-connector-engine/xml.js";
import { buildSalesInvoicePdfRequest } from "../utils/tally-connector-engine/modules/vouchers/sales/sales.pdf.js";
import { createTallyHttpTransport } from "../utils/tally-connector-engine/transport/httpTransport.js";
import { createTallyConnectorEngine } from "../utils/tally-connector-engine/client.js";
import { registerTallyAvailabilityCheck } from "../services/tallyAvailability.service.js";
import { tallyFailureResult } from "../utils/tallyFailure.js";

export function createConnectorSocket({ config, notify, onActivity, temporaryDirectory, ledgerSync }) {
  let heartbeatTimer;
  let registeredAt = null;
  const activeSalesOrders = new Set();
  const activeSalesPdfExports = new Set();
  const transactionTypesByRequest = new Map();
  const voucherRequestServices = {
    sales_order: fetchSalesOrderRequest, sales_voucher: fetchSalesVoucherRequest,
    receipt_voucher: fetchReceiptVoucherRequest, payment_voucher: fetchPaymentVoucherRequest,
    purchase_order: fetchPurchaseOrderRequest, purchase_voucher: fetchPurchaseVoucherRequest,
  };
  const socket = io(config.serverUrl, {
    // Keep polling as a fallback when a proxy or customer network cannot
    // establish a WebSocket upgrade; Socket.IO will upgrade when available.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 15_000,
    timeout: 20_000,
  });
  registerTallyAvailabilityCheck(socket, config);
  const recordConnectionActivity = (status, message) => onActivity?.({ status, message, at: new Date().toISOString() });

  socket.on(EVENTS.companyList, (_payload = {}, acknowledge = () => {}) => {
    if (!ledgerSync?.listCompanies) {
      acknowledge({ success: false, code: "COMPANY_LIST_UNAVAILABLE", message: "Local company cache is unavailable." });
      return;
    }
    try {
      acknowledge({ success: true, companies: ledgerSync.listCompanies(config) });
    } catch (error) {
      acknowledge({ success: false, code: "COMPANY_LIST_FAILED", message: error.message });
    }
  });

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

  function resolvePartyDealerCode(voucher, company, transactionType) {
    const party = voucher.party || {};
    const dealerCode = party.dealer_code || voucher.dealer_code || voucher.party_dealer_code;
    if (!dealerCode) return voucher;
    if (!ledgerSync?.resolveLedger) throw new Error("Dealer code lookup is unavailable until the local ledger sync is ready.");
    const resolved = ledgerSync.resolveLedger(config, { company, dealer_code: dealerCode });
    const ledgerName = resolved.ledger_name;
    const next = {
      ...voucher,
      party: { ...party, dealer_code: dealerCode, ledger_name: ledgerName },
      party_ledger: ledgerName,
      party_ledger_entry: { ...(voucher.party_ledger_entry || {}), ledger: ledgerName },
    };
    if (Object.prototype.hasOwnProperty.call(voucher, "customer_ledger")) next.customer_ledger = ledgerName;
    if (Object.prototype.hasOwnProperty.call(voucher, "supplier_ledger")) next.supplier_ledger = ledgerName;
    recordConnectionActivity("info", `Dealer code '${dealerCode}' resolved to ledger '${ledgerName}' for ${transactionType}.`);
    return next;
  }

  function findMissingLedgers(errors = []) {
    return [...new Set(errors.flatMap((message) => [...String(message).matchAll(/ledger\s+['"](.+?)['"]\s+does not exist/gi)].map((match) => match[1].trim())))];
  }

  function summarizeTallyFailure(result) {
    if (result.summary?.exceptions > 0) return `Tally held ${result.summary.exceptions} voucher(s) in Import Exceptions. Created=${result.summary.created}, altered=${result.summary.altered}. ${result.summary.lineErrors?.join("; ") || "Open the affected Purchase/Sales Order in Tally Import Exceptions for its exact validation reason. Do not resend it until the held entry is reviewed."}`;
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
      if (!missingNames.length) throw Object.assign(new Error(summarizeTallyFailure(result)), { tallyResult: result.summary });
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
    const label = ({
      receipt_voucher: "Receipt Voucher",
      sales_voucher: "Sales Voucher",
      purchase_order: "Purchase Order",
      purchase_voucher: "Purchase Voucher",
      payment_voucher: "Payment Voucher"
    })[transactionType] || "Sales Order";

    recordConnectionActivity("info", `${label} push signal received${signal.request_id ? ` for ${signal.request_id}` : " without a request ID"}.`);
    if (signal.request_id) {
      transactionTypesByRequest.set(signal.request_id, transactionType);
      void processVoucherRequest(signal.request_id, transactionType);
    }
    socket.emit(EVENTS.ack, {
      event: ({ receipt_voucher: EVENTS.receiptVoucherPush, sales_voucher: EVENTS.salesVoucherPush, purchase_order: EVENTS.purchaseOrderPush, purchase_voucher: EVENTS.purchaseVoucherPush, payment_voucher: EVENTS.paymentVoucherPush })[transactionType] || EVENTS.salesOrderPush,
      request_id: signal.request_id,
      received: Boolean(signal.request_id),
      at: new Date().toISOString(),
    });
  }

  socket.on(EVENTS.salesOrderPush, (signal = {}) => acknowledgeTransactionSignal(signal, "sales_order"));
  socket.on(EVENTS.salesOrderFetch, (signal = {}) => {
    if (typeof signal.request_id === "string") void processSalesOrderLookup(signal.request_id);
  });
  socket.on(EVENTS.ledgerStatementFetch, (signal = {}) => {
    if (typeof signal.request_id === "string") {
      if (signal.transaction_type === "group_summary") void processGroupSummary(signal.request_id);
      else void processLedgerStatement(signal.request_id);
    }
  });
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

  async function processVoucherRequest(requestId, transactionType = "sales_order") {
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
      const fetchRequest = voucherRequestServices[transactionType];
      if (!fetchRequest) throw new Error(`Unsupported voucher transaction type: ${transactionType}`);
      const request = await fetchRequest({ config, requestId });
      let voucherData = isReceiptVoucher ? request.receipt
        : isPaymentVoucher ? request.payment
          : isPurchaseOrder ? request.purchase_order
            : isPurchaseVoucher ? request.purchase : request.sales || request.sales_order;
      if (!voucherData) throw new Error(`Server returned no voucher data for ${transactionLabel}.`);
      const companyName = ledgerSync?.resolveCompany
        ? ledgerSync.resolveCompany(config, request.destination?.company_id) || config.tallyCompany || request.destination?.company || request.destination?.company_name
        : config.tallyCompany || request.destination?.company || request.destination?.company_name;
      voucherData = resolvePartyDealerCode(voucherData, companyName, transactionType);
      update("building_xml", `${transactionLabel} fetched. Building Tally XML…`);
      const xml = isReceiptVoucher
        ? buildReceiptVoucherXml({ companyName, receipt: voucherData })
        : isPaymentVoucher ? buildPaymentVoucherXml({ companyName, payment: voucherData })
          : isPurchaseOrder ? buildPurchaseOrderXml({ companyName, order: voucherData })
            : isPurchaseVoucher ? buildPurchaseVoucherXml({ companyName, purchase: voucherData })
              : transactionType === "sales_order" ? buildSalesOrderXml({ companyName, order: voucherData, orderVoucher: true }) : buildSalesVoucherXml({ companyName, sales: voucherData });
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
      const failure = tallyFailureResult(error);
      update("failed", error.message, { error: error.message, ...(failure ? { tally_result: failure } : {}) });
    } finally {
      activeSalesOrders.delete(requestId);
    }
  }

  async function processLedgerStatement(requestId) {
    if (activeSalesOrders.has(requestId)) return;
    activeSalesOrders.add(requestId);
    const update = (status, extra = {}) => socket.emit(EVENTS.salesOrderUpdate, { request_id: requestId, transaction_type: "ledger_statement", status, ...extra });
    try {
      update("fetching");
      const statement = await fetchLedgerStatement({ config, requestId, ledgerSync });
      update("succeeded", { tally_result: { statement } });
      onActivity?.({ requestId, status: "succeeded", message: "Ledger statement read from local SQLite cache.", at: new Date().toISOString() });
    } catch (error) {
      update("failed", { error: error.message, tally_result: { lookup_status: error.httpStatus || 502, ...tallyFailureResult(error) } });
      onActivity?.({ requestId, status: "failed", message: error.message, at: new Date().toISOString() });
    } finally {
      activeSalesOrders.delete(requestId);
    }
  }

  async function processGroupSummary(requestId) {
    if (activeSalesOrders.has(requestId)) return;
    activeSalesOrders.add(requestId);
    const transactionType = "group_summary";
    const update = (status, extra = {}) => socket.emit(EVENTS.salesOrderUpdate, { request_id: requestId, transaction_type: transactionType, status, ...extra });
    try {
      update("fetching");
      const summary = await fetchGroupSummary({ config, requestId, ledgerSync });
      update("succeeded", { tally_result: { summary } });
      onActivity?.({ requestId, status: "succeeded", message: "Group summary read from local SQLite cache.", at: new Date().toISOString() });
    } catch (error) {
      update("failed", { error: error.message, tally_result: { lookup_status: error.httpStatus || 502, ...tallyFailureResult(error) } });
      onActivity?.({ requestId, status: "failed", message: error.message, at: new Date().toISOString() });
    } finally {
      activeSalesOrders.delete(requestId);
    }
  }

  async function processSalesOrderLookup(requestId) {
    if (activeSalesOrders.has(requestId)) return;
    activeSalesOrders.add(requestId);
    let transactionType = "sales_order_lookup";
    const update = (status, extra = {}) => socket.emit(EVENTS.salesOrderUpdate, { request_id: requestId, transaction_type: transactionType, status, ...extra });
    try {
      update("fetching");
      const request = await fetchSalesOrderRequest({ config, requestId });
      if (!["sales_order_lookup", "sales_voucher_lookup"].includes(request.transaction_type) || !request.lookup) throw new Error("Invalid voucher lookup job.");
      transactionType = request.transaction_type;
      const isSales = transactionType === "sales_voucher_lookup";
      const label = isSales ? "Sales Voucher" : "Sales Order";
      const transport = createTallyHttpTransport();
      const options = { timeoutMs: (Number(config.requestTimeoutSeconds) || 30) * 1000 };
      const tally = { url: config.tallyUrl };
      const search = await transport.postXml(tally, isSales ? buildSalesVoucherSearchRequest(request.lookup) : buildSalesOrderSearchRequest(request.lookup), options);
      if (search.status < 200 || search.status >= 300) throw new Error(`Tally lookup returned HTTP ${search.status}.`);
      const voucherId = parseSalesOrderSearchResponse(search.body, label);
      const response = await transport.postXml(tally, buildSalesOrderObjectRequest(request.lookup.company, voucherId), options);
      if (response.status < 200 || response.status >= 300) throw new Error(`Tally voucher export returned HTTP ${response.status}.`);
      update("succeeded", { tally_result: { voucher: parseSalesOrderObjectResponse(response.body, request.lookup, label) } });
      onActivity?.({ requestId, status: "succeeded", message: `${label} fetched directly from Tally.`, at: new Date().toISOString() });
    } catch (error) {
      update("failed", { error: error.message, tally_result: { lookup_status: error.httpStatus || 502, ...tallyFailureResult(error) } });
      onActivity?.({ requestId, status: "failed", message: error.message, at: new Date().toISOString() });
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
      const job = await fetchSalesPdfJob({ config, requestId });
      const request = job.lookup ? null : await fetchSalesVoucherRequest({ config, requestId });
      // Direct lookup always uses the caller's company, never the Connector default.
      const companyName = job.lookup?.company || config.tallyCompany || request?.destination?.company || request?.destination?.company_name;
      let voucherId = request?.tally_result?.lastVoucherId;
      if (job.lookup) {
        updateActivity("fetching", "Finding the Sales Voucher directly in Tally by ledger and voucher number…");
        const lookupTransport = createTallyHttpTransport();
        const lookupResponse = await lookupTransport.postXml({ url: config.tallyUrl }, buildSalesVoucherSearchRequest(job.lookup), { timeoutMs: Math.max((Number(config.requestTimeoutSeconds) || 30) * 1000, 60_000) });
        if (lookupResponse.status < 200 || lookupResponse.status >= 300) throw new Error(`Tally voucher lookup returned HTTP ${lookupResponse.status}.`);
        voucherId = parseSalesVoucherSearchResponse(lookupResponse.body);
      }
      if (!/^\d+$/.test(String(voucherId ?? "")) || Number(voucherId) < 1) {
        throw new Error("The saved Tally response has no voucher ID. This Sales Voucher must be pushed again with the updated Connector before its PDF can be exported.");
      }

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
      const voucher = request?.sales || request?.sales_order || {};
      const filename = `sales-${String(job.lookup?.voucher_no || voucher.voucher_number || requestId).replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
      await uploadSalesVoucherPdf({ config, requestId, pdf, filename });
      updateActivity("succeeded", "Tally Standard Sales invoice PDF uploaded. CRM can download it now.");
    } catch (error) {
      console.error("Sales Voucher PDF export failed:", error);
      updateActivity("failed", error.message);
      try {
        await updateSalesVoucherPdfStatus({ config, requestId, status: "failed", error: error.message, errorCode: tallyFailureResult(error)?.error_code });
      } catch (statusError) {
        recordConnectionActivity("failed", `Could not update PDF job failure on Server: ${statusError.message}`);
      }
    } finally {
      activeSalesPdfExports.delete(requestId);
      if (outputPath) await rm(outputPath, { force: true }).catch(() => { });
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
    void processVoucherRequest(requestId, transactionTypesByRequest.get(requestId) || "sales_order");
    return { success: true };
  };

  return socket;
}
