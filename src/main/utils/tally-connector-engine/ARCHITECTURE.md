# Engine folder architecture

This stage moves existing implementations and updates imports. It does not introduce new request queues, error contracts, schemas or normalization behavior.

- index.js: stable public entry point.
- client.js: exports engine construction.
- core/engine.js: current engine orchestration and plugin lifecycle.
- transport/httpTransport.js: Tally HTTP requests, timeout, response limits and cancellation.
- modules/companies/: company discovery request and response parser.
- modules/ledgers/: statement and ledger-cache query implementations.
- modules/vouchers/<voucher>/: public module index, existing XML builder, XML template, and related lookup/PDF requests where supported.
- shared/mappers/: generic UDF validation/rendering only. Voucher-specific validation, amounts and XML building live in the respective voucher folder.
- shared/XML/: shared Handlebars XML assets.
- shared/template/templateRenderer.js: cached template compilation and rendering.
- shared/parsers/: voucher JSON, XML text helpers, voucher-number and import-result parsers.
- shared/requests/xml.js: common collection, voucher-ID and ledger-master requests.
- shared/utils/xmlHelpers.js: existing escaping, date conversion, due date and envelope helpers.

Root files such as xml.js, tallyHttpTransport.js and ledgerStatement.js retain exports for compatibility. They contain no duplicate implementations. Connector consumers now reference the new implementation locations or the stable entry point.

Templates are resolved relative to the engine root; protected packaging copies .hbs files from both modules/ and shared/. Tests remain in Connector/test so the existing test runner continues discovering them.

Next phase: separate each voucher into schema, normalizer and mapper using a completed Payment module as the reference. Avoid empty placeholder files until their responsibilities are implemented.
