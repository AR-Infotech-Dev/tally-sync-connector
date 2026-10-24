# Voucher XML builders

Each supported voucher owns its build implementation in its own folder. No shared cash/bank or inventory builder dispatches between voucher types:

- sales-order/sales-order.xml.js: Sales Order (buildSalesOrderXml).
- sales/sales.xml.js: Sales invoice (buildSalesVoucherXml).
- purchase-order/purchase-order.xml.js: Purchase Order (buildPurchaseOrderXml).
- purchase/purchase.xml.js: Purchase invoice (buildPurchaseVoucherXml).
- receipt/receipt.xml.js: Receipt (buildReceiptVoucherXml).
- payment/payment.xml.js: Payment (buildPaymentVoucherXml).

shared/utils/xmlHelpers.js owns escaping, dates, due dates and import envelopes.
shared/mappers/udfXml.js validates and renders scalar custom fields for all voucher builders.

The existing xml.js and engine index.js exports remain compatible. Socket orchestration stays in socket/connectorSocket.js; it selects the voucher builder without embedding XML mapping. API fetching, validation and UI remain in their existing layers. This reorganization does not change voucher payloads or fix upstream Tally validation.

## Handlebars XML templates

Each voucher folder contains its .xml.hbs template next to its .xml.js builder. Builders retain validation, amounts and mapping; XML markup lives in the templates. Shared XML fragments (inventory allocations, due dates, bill allocations, UDFs and envelope) also use .xml.hbs files in shared/XML/.

shared/template/templateRenderer.js loads and compiles each template once per process. Values passed to templates are already escaped with escapeXml, or are trusted XML rendered from another internal template. Triple-brace placeholders avoid double escaping; never pass raw external data as an XML fragment. The existing API payloads and Tally HTTP posting flow are unchanged.

The protected packaging script copies all .hbs assets into the staged application and includes them in the installer. Restart the Connector after template edits because compiled templates are cached.
