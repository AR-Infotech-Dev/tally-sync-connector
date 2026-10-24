# Server API client

Use makeRequest(url, options) from httpClient.js for Connector-to-Server calls. This layer is outside tally-connector-engine: the Engine does not depend on the Server API.

## Options

- config: runtime Connector settings (serverUrl, clientId, connectorKey, requestTimeoutSeconds).
- baseURL: optional Server URL override, useful for registration before activation.
- method: GET by default; also POST, PUT, PATCH, DELETE as required by the endpoint.
- params: query values; arrays become repeated query keys and null values are omitted.
- body: JSON object, text, Buffer or FormData. FormData supplies its own content-type boundary.
- headers: extra or overriding headers.
- timeout: milliseconds, defaulting to Connector settings or 30000.
- signal: caller cancellation.
- responseType: json, text, buffer, arraybuffer or blob.
- unwrapData: false by default; true returns the Server data field (or the original payload when no data field exists).
- authenticated: false for registration/activation; true adds Connector credentials from config.
- Extra Axios options, including onUploadProgress, onDownloadProgress and withCredentials, pass through.

JSON responses retain the Server envelope and add HTTP status. Binary/text responses retain status, headers and data unless unwrapData is true. Failures throw an Error with message, status/httpStatus, Server code/type and details. Network failure, timeout and cancellation have separate codes. This preserves Connector orchestration catch blocks; frontend loader and session-clearing logic do not belong in this process. The client does not retry writes automatically.

Voucher-specific endpoints live under modules/vouchers/<voucher>/services/. They reuse the shared client and return unwrapped job data. Ledger statement jobs have their own service under modules/ledgers/services/; they intentionally use the existing Server sales-orders connector job route. Sales PDF endpoints live under the sales module. Registration and activation stay in services/clientRegistration.api.js and also use makeRequest.
