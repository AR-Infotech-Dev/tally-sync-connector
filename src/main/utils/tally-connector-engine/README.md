# Tally Connector Engine

Reusable Electron main-process utilities for posting XML to a local TallyPrime instance, checking Tally connectivity, exporting collections, parsing import summaries, and running voucher/master plugins.

## Basic use

```js
import { createTallyConnectorEngine } from "./tally-connector-engine/index.js";

const tallyEngine = createTallyConnectorEngine();
const result = await tallyEngine.getCompanies({ host: "127.0.0.1", port: 9000 });
```

The engine defaults to HTTP, `127.0.0.1:9000`, and a 30 second timeout. Pass `url`, `timeoutMs`, or a custom `transport` when needed. It also exposes `testConnection`, `exportCollection`, `importXml`, `sendXml`, XML escaping, request-envelope builders, and import-result parsing.

## Add a plugin

Plugins provide the operation-specific mapping from app data to Tally XML. Each operation implements `buildRequest`; it may also implement `parseResponse`.

- `buildRequest({ tally, payload, config, helpers })` returns XML or `{ xml, transportOptions }`.
- `parseResponse({ tally, payload, config, response })` can turn the raw Tally response into a plugin-specific result.
- The engine provides shared `buildImportEnvelope`, `escapeXml`, and `parseImportResponse` helpers to each plugin.
- Plugins are registered per engine instance. `registerPlugin` returns a function that unregisters that plugin.

```js
const salesVoucherPlugin = {
  id: "sales-voucher",
  operations: {
    push: {
      buildRequest: ({ payload, config, helpers }) => ({
        xml: helpers.buildImportEnvelope({
          companyName: config.companyName,
          messages: [buildSalesVoucherMessage(payload, config)],
        }),
      }),
    },
  },
};

const engine = createTallyConnectorEngine({ plugins: [salesVoucherPlugin] });
const result = await engine.executePlugin("sales-voucher", "push", {
  tally: { host: "127.0.0.1", port: 9000 },
  payload: crmSalesOrder,
  config: connectorConfig,
});
```

XML mapping stays in the plugin; the engine owns local HTTP transport and import-response parsing. The provided CRM sales-order mapping should be implemented as a separate plugin once its field and ledger rules are finalized.
