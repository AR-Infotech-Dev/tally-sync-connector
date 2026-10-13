import { createTallyHttpTransport } from "./tallyHttpTransport.js";
import { buildSalesInvoicePdfRequest } from "./salesInvoicePdf.js";
import { buildCollectionRequest, buildCompanyListRequest, buildImportEnvelope, buildLedgerMasterImport, buildPaymentVoucherXml, buildPurchaseOrderXml, buildPurchaseVoucherXml, buildReceiptVoucherXml, buildSalesOrderXml, buildVoucherLookupRequest, escapeXml, parseCompanyList, parseImportResponse, parseVoucherNumber } from "./xml.js";

export { createTallyHttpTransport } from "./tallyHttpTransport.js";
export { buildSalesInvoicePdfRequest } from "./salesInvoicePdf.js";
export { buildCollectionRequest, buildCompanyListRequest, buildImportEnvelope, buildLedgerMasterImport, buildPaymentVoucherXml, buildPurchaseOrderXml, buildPurchaseVoucherXml, buildReceiptVoucherXml, buildSalesOrderXml, buildVoucherLookupRequest, escapeXml, parseCompanyList, parseImportResponse, parseVoucherNumber } from "./xml.js";

/**
 * Creates an isolated Tally engine instance with its own plugin registry.
 *
 * A plugin maps application data to a Tally XML request. The engine handles
 * HTTP transport and parses the import summary returned by TallyPrime.
 *
 * @param {{ transport?: { postXml: Function }, plugins?: Array<object> }} options
 *   Optional custom transport and plugins to register during construction.
 * @returns {object} Engine API: plugin registration, connectivity, XML request,
 *   collection export, and plugin execution methods.
 */
export function createTallyConnectorEngine({ transport = createTallyHttpTransport(), plugins = [] } = {}) {
  const pluginRegistry = new Map();

  /**
   * Registers a plugin and returns an unregister callback.
   *
   * Plugin shape: `{ id, operations: { [name]: { buildRequest, parseResponse? } } }`.
   * `buildRequest` receives the operation context and shared XML helpers. It
   * returns either an XML string or `{ xml, transportOptions }`.
   *
   * @param {object} plugin Plugin definition with a unique id and operations.
   * @returns {Function} Removes this plugin from this engine instance.
   */
  function registerPlugin(plugin) {
    if (!plugin || typeof plugin.id !== "string" || !plugin.id.trim()) {
      throw new TypeError("A Tally plugin must have a non-empty string id.");
    }
    if (!plugin.operations || typeof plugin.operations !== "object") {
      throw new TypeError(`Plugin '${plugin.id}' must define an operations object.`);
    }
    if (pluginRegistry.has(plugin.id)) throw new Error(`Tally plugin '${plugin.id}' is already registered.`);
    pluginRegistry.set(plugin.id, Object.freeze({ ...plugin }));
    return () => pluginRegistry.delete(plugin.id);
  }

  for (const plugin of plugins) registerPlugin(plugin);

  /**
   * Sends an XML request to Tally and interprets the response as an import
   * summary. Use this for voucher/master imports; export operations should use
   * `exportCollection` or a plugin with a custom response parser.
   *
   * @param {object} tally Tally endpoint settings (`url` or `host` and `port`).
   * @param {string} xml Complete Tally XML request.
   * @param {object} [options] Transport options such as timeout and headers.
   * @returns {Promise<object>} HTTP details, raw response XML, and import totals.
   */
  async function sendXml(tally, xml, options) {
    const response = await transport.postXml(tally, xml, options);
    const parsed = parseImportResponse(response.body);
    return {
      ...parsed,
      ok: response.status >= 200 && response.status < 300 && parsed.ok,
      endpoint: response.endpoint,
      httpStatus: response.status,
      responseHeaders: response.headers,
    };
  }

  /**
   * Checks the configured Tally endpoint by requesting its company collection.
   *
   * @param {object} tally Tally endpoint settings (`url` or `host` and `port`).
   * @returns {Promise<{ok: boolean, endpoint: string, httpStatus: number, companies: Array<object>, response: string}>}
   *   Connection result, discovered companies, and the raw Tally response.
   */
  async function testConnection(tally) {
    const response = await transport.postXml(tally, buildCompanyListRequest());
    return {
      ok: response.status >= 200 && response.status < 300,
      endpoint: response.endpoint,
      httpStatus: response.status,
      companies: parseCompanyList(response.body),
      response: response.body,
    };
  }

  /**
   * Fetches a Tally collection using the requested object type and fields.
   * The response stays as raw XML so each plugin can parse its own collection.
   *
   * @param {object} tally Tally endpoint settings.
   * @param {{collectionName: string, objectType: string, fetchFields: string[], companyName?: string}} definition Collection request definition.
   * @param {object} [options] Transport options such as timeout and headers.
   * @returns {Promise<{ok: boolean, endpoint: string, httpStatus: number, raw: string}>} Raw collection result.
   */
  async function exportCollection(tally, definition, options) {
    const request = buildCollectionRequest(definition);
    const response = await transport.postXml(tally, request, options);
    return { ok: response.status >= 200 && response.status < 300, endpoint: response.endpoint, httpStatus: response.status, raw: response.body };
  }

  /** Reads the Tally-assigned voucher number by the LASTVCHID from an import response. */
  async function getVoucherById(tally, { companyName, voucherId } = {}, options) {
    const request = buildVoucherLookupRequest({ companyName, voucherId });
    const response = await transport.postXml(tally, request, options);
    return {
      ok: response.status >= 200 && response.status < 300,
      endpoint: response.endpoint,
      httpStatus: response.status,
      voucherNumber: parseVoucherNumber(response.body),
      raw: response.body,
    };
  }

  /**
   * Runs one registered plugin operation from XML construction through Tally
   * transport and response parsing.
   *
   * The operation context is passed to both plugin hooks. It normally contains
   * `tally`, `payload`, and plugin-specific `config` values.
   *
   * @param {string} pluginId Registered plugin id.
   * @param {string} operationName Operation key under `plugin.operations`.
   * @param {object} [context] Data and configuration supplied to plugin hooks.
   * @returns {Promise<object>} Parsed Tally result or the plugin's parsed result.
   */
  async function executePlugin(pluginId, operationName, context = {}) {
    const plugin = pluginRegistry.get(pluginId);
    if (!plugin) throw new Error(`Tally plugin '${pluginId}' is not registered.`);
    const operation = plugin.operations[operationName];
    if (!operation || typeof operation.buildRequest !== "function") {
      throw new Error(`Tally plugin '${pluginId}' does not implement '${operationName}'.`);
    }
    const built = await operation.buildRequest({ ...context, helpers: { buildImportEnvelope, escapeXml, parseImportResponse } });
    const xml = typeof built === "string" ? built : built?.xml;
    if (!xml) throw new Error(`Tally plugin '${pluginId}' returned no XML for '${operationName}'.`);
    const result = await sendXml(context.tally, xml, built?.transportOptions);
    return typeof operation.parseResponse === "function"
      ? operation.parseResponse({ ...context, response: result })
      : result;
  }

  /** Lists ids for plugins currently registered on this engine instance. */
  function listPlugins() {
    return [...pluginRegistry.keys()];
  }

  return Object.freeze({
    registerPlugin,
    listPlugins,
    testConnection,
    getCompanies: testConnection,
    exportCollection,
    getVoucherById,
    buildSalesInvoicePdfRequest,
    sendXml,
    importXml: sendXml,
    executePlugin,
  });
}
