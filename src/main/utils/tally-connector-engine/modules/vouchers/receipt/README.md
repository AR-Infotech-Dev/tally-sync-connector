# Receipt maintenance guide

Read in this order:
1. `receipt.xml.js` — public XML builder; map → render → envelope.
2. `receipt.validator.js` — voucher validation rules and existing error messages.
3. `receipt.mapper.js` — input aliases, defaults, signs, optional fields and template context.
4. `receipt.xml.hbs` — voucher XML structure.
5. `../../../shared/XML/import-envelope.xml.hbs` — only the common import wrapper.

Server calls belong to `src/main/modules/vouchers/receipt/services/receipt.api.js`, outside this reusable engine.
Socket orchestration lives in `src/main/socket/connectorSocket.js`; it also handles master recovery, retries and status updates.
The mapper validates values as they are resolved, preserving validation order and legacy aliases.
Do not add network calls to validators, mappers or templates.
For a new field: verify the Server contract, update mapping, add XML and test its escaped output.
Mappers supply escaped scalar data and arrays. Optional tags use #if/#unless and repeating items use #each inside this voucher template.

## या voucher साठी प्रत्यक्ष flow

`buildReceiptVoucherXml({companyName, receipt})`
→ `mapReceiptToTemplate`
→ `receipt.validator.js` मधील आवश्यक checks
→ `receipt.xml.hbs`
→ import envelope.

`examples/input.json` मध्ये builder input आहे; Server चा पूर्ण request body नाही.
Connector folder मधून offline XML तयार करा:

```powershell
npm run engine:preview -- receipt
npm run engine:check
```

Output: `tmp/engine-preview/receipt.xml`.
XML बदल: template; defaults/signs: mapper; नियम: validator; Server endpoint: voucher API service.
सविस्तर मार्गदर्शन: [मराठी maintenance guide](../../../MAINTENANCE.md).
