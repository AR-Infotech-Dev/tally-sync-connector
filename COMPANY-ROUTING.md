# Client company sequence IDs

Company IDs are assigned by Server separately for each client: "01", "02", ... "99", "100". They are strings; preserve leading zeros. A second client starts its own list at "01".

The API company_id is not a Tally GUID and is never a position in a live company list. Server stores its mapping to a private company_key in MongoDB client_companies, with an atomic per-client counter in client_company_counters. The v2 identity uses the native Tally GUID plus company number and data path when both locator fields are available. If either locator is unavailable it uses GUID plus the normalized company name; this safely separates differently named restored branches that share a GUID. The Connector discovery field guid and private job field company_guid carry this opaque identity key; tally_guid retains the actual native GUID. No private identity fields are required in public API payloads.

Sequence IDs survive list reordering, close/reopen and Connector reinstall with the same client and identity metadata. Locator-backed identities also survive company rename. A name-based identity cannot automatically recognize a rename, and moving/renumbering data folders changes a locator-backed identity: these require deliberate relinking to preserve the old logical mapping. Never infer a relink from GUID alone. Preserve the Server registry/counters in backups.

GET /api/v1/companies returns this authenticated client's companies, including previously discovered closed companies. Each company must be discovered open at least once. Active means confirmed open, closed means absent from current discovery, unknown means availability could not be checked. Local accounting sync need not finish before company discovery and ID assignment.

Push requests use destination.company_id; reports use top-level company_id; voucher/PDF lookups use the company_id query parameter. Example:

```json
{ "destination": { "company_id": "01" } }
```

Server first resolves "01" within the authenticated client's registry. It attaches the private company_guid identity key and native tally_guid internally to the Connector job. Caller-supplied names or GUIDs cannot override that mapping. Connector verifies the complete mapped identity is currently open before party/item lookup and execution. It never treats "01" as the first open company. Cached reports still require the target company to be open and its local snapshot ready.

Existing registry rows with GUID-based IDs are migrated once to sequence IDs. Read /companies again and update integrations to the new IDs. Public requests no longer accept GUID or COMP_... values as company_id. Previously queued jobs without the Server GUID mapping stop with COMPANY_MAPPING_REQUIRED instead of guessing a company.

IDs are never reused or compressed. Concurrent reservations or failed inserts may leave gaps. At least two digits are used; 100 remains "100". The unique client_id/company_id and partial unique client_id/company_key indexes prevent duplicate assignments. Initialization creates the new identity index before removing only the obsolete unique client_id/tally_guid index; no company rows are deleted. Shared native GUIDs are allowed when company keys differ. Duplicate complete identities still fail closed. Two companies with the same name can have separate IDs if locator metadata distinguishes them; if both are open simultaneously, COMPANY_AMBIGUOUS blocks the name-addressed Tally XML transport.

Legacy registry records retain their existing IDs and their currently stored company names. A legacy name-based record may be upgraded to locator metadata only on an exact, unambiguous client/GUID/name match. If the old GUID-only implementation already replaced MH with RJ under ID 01, migration keeps that currently stored RJ record as 01 and assigns a new ID to MH; it cannot reconstruct the lost historical ownership. Refresh /companies after discovery rather than assuming particular new sequence numbers.

SQLite schema 8 partitions company snapshots and resumable sessions by the new company key and stores native GUID separately. Existing GUID-only datasets are retained but marked identity_upgrade_required/inactive, because their branch provenance cannot be proved. They are not silently relabeled or reused for another branch. Start a new company sync after upgrading; old checkpoint Resume is disabled with an explanation. Newly created v2 checkpoints resume normally. Dealer Code, Item Code, voucher, report and metadata lookups use the same private company key.

Missing ID returns 400 COMPANY_ID_REQUIRED, unknown ID for this client returns 404 COMPANY_NOT_FOUND, and a known closed company returns 409 COMPANY_NOT_OPEN. Connection failures prevent execution. The Connector has no selected-company fallback and syncs all open companies sequentially.

Update Server and Connector together. Test Tally displays Server-assigned IDs when connected; before connection it shows that assignment is pending. Keep the company registry and counter collections in Server backups.
