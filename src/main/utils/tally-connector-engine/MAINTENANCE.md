# Engine स्वतः समजून घेण्यासाठी

सुरुवात `modules/vouchers/sales-order/examples/input.json` पासून करा. त्याच folder मधील `expected.xml` सोबत तुलना करा. हे सर्व dummy data आहे. उदाहरणातील ledgers/items तुमच्या Tally company मध्ये अस्तित्वात आहेत असे गृहीत धरू नका.

## Sales Order कुठून कुठे जाते?

खालील paths `Connector/` पासून आहेत.

1. `src/main/index.js` — Electron main process सुरू होतो.
2. `src/main/socket/connectorSocket.js` — `createConnectorSocket` Server चे signal ऐकतो. `acknowledgeTransactionSignal` request स्वीकारतो; `processVoucherRequest` voucher processing चालवतो. हे function सर्व voucher types साठी आहे.
3. `src/main/modules/vouchers/sales-order/services/sales-order.api.js` — `fetchSalesOrderRequest` Server कडून payload घेतो. HTTP/auth/error plumbing `src/main/api/httpClient.js` मध्ये आहे.
4. `src/main/utils/tally-connector-engine/modules/vouchers/sales-order/sales-order.xml.js` — `buildSalesOrderXml` हा सार्वजनिक builder आहे. Socket हाच वापरतो.
5. `sales-order.mapper.js` — `mapSalesOrderToTemplate` aliases/defaults resolve करतो, आवश्यक टप्प्यांवर `sales-order.validator.js` मधील checks चालवतो आणि template context बनवतो. Dates चे checks shared date helpers मध्ये होतात.
6. `sales-order.xml.hbs` — मुख्य voucher XML render होते. Batch, party, GST, bill आणि due-date sections याच file मध्ये conditions/loops सह आहेत. शेवटी `buildImportEnvelope` company व import envelope जोडतो.
7. Socket मधील `pushVoucherWithLedgerRecovery` → engine `sendXml` → `transport/httpTransport.js` → स्थानिक Tally HTTP endpoint. Master recovery आणि result handling socket layer मध्येच आहेत.
8. `shared/parsers/importResult.parser.js` मधील parser import counters/errors तपासतो. HTTP 200 म्हणजे voucher तयार झाला असे नाही. Socket result/status Server ला emit करतो आणि Server client request पूर्ण करतो.

Engine म्हणजे टप्पे 4–8 मधील XML, transport आणि parser utilities. Server credentials, socket connection, request queue आणि UI हे engine च्या बाहेर आहेत. या refactor मध्ये पूर्ण socket workflow नव्याने प्रत्येक voucher मध्ये duplicate केलेला नाही.

## प्रत्येक voucher folder मध्ये काय आहे?

| File | काय बदलायचे? |
|---|---|
| `index.js` | सार्वजनिक exports |
| `<voucher>.xml.js` | validate/map → template render → envelope हा छोटा entry flow |
| `<voucher>.validator.js` | items, party, amount सारख्या business checks व error messages |
| `<voucher>.mapper.js` | input fields, defaults, signs आणि XML template साठी values |
| `<voucher>.xml.hbs` | मुख्य Tally tags व त्यांचा क्रम |
| `examples/input.json` | builder ला दिलेला dummy input; हा थेट Server API body नाही |
| `examples/expected.xml` | त्या input ची वाचण्यासाठी ठेवलेली XML; बदलानंतर preview सोबत तुलना करा |
| `examples/success-response.xml` | import success counters चे नमुना उत्तर |
| `examples/error-response.xml` | import failure चे नमुना उत्तर |

## स्वतः बदल करण्याची पद्धत

उदा. Sales Order च्या नवीन field साठी:

1. Server validator/schema मध्ये field स्वीकारले जाते का तपासा. नवीन field असल्यास Server contractही बदलावा लागतो.
2. `sales-order.mapper.js` मध्ये field resolve करून context मध्ये अर्थपूर्ण नावाने द्या.
3. आवश्यक field असल्यास validator मध्ये check व स्पष्ट message जोडा.
4. योग्य Tally tag `sales-order.xml.hbs` मध्ये जोडा. Item/batch field असेल तर याच template मधील #each entries आणि batch section तपासा.
5. `examples/input.json` मध्ये dummy value द्या; offline preview काढा.
6. संबंधित test मध्ये अपेक्षित Tally field, escaping आणि balance तपासा.
7. मग स्वतंत्र test company मध्ये तपासा. Production मध्ये repeated imports करू नका.

`Connector` directory मधून:

```powershell
npm run engine:preview -- sales-order
npm run engine:check
```

Preview `Connector/tmp/engine-preview/sales-order.xml` मध्ये येतो. Preview command network request किंवा Tally push करत नाही. इतर पर्याय: `sales`, `purchase-order`, `purchase`, `receipt`, `payment`.

## महत्त्वाचे Tally नियम

- Sales Order मध्ये `is_invoice` invoice म्हणून पाठवू नका. Builder order role साठी ते false ठेवतो.
- Order number आणि due date प्रत्येक item च्या batch allocation मध्ये लागतात. फक्त header मध्ये date टाकून उपयोग नाही.
- Receipt: customer credit, Cash/Bank debit. Payment: supplier debit, Cash/Bank credit. Tally XML signs आणि accounting Dr/Cr समजूनच बदला.
- Scalar text `escapeXml` मधून जाते. Mapper मध्ये XML string तयार करू नका; template मध्ये escaped scalar fields वापरा.
- Bill reference असल्यास त्याचा exact reference व bill type आवश्यक. `Agst Ref` साठी Tally मधील योग्य outstanding reference द्या.
- 57 shared fragment files काढल्या आहेत. प्रत्येक voucher ची एक संपूर्ण XML आहे; fields ना अर्थपूर्ण नावे आहेत.
- Ledger cached statement साठी `modules/ledgers/`, SQLite साठी `src/main/models/ledgerCache.model.js`, sync scheduling साठी `src/main/services/ledgerSync.service.js` पाहा. ही voucher import calculation पासून वेगळी जबाबदारी आहे.

## Error कुठे शोधायचा?

| लक्षण | प्रथम पाहायची जागा |
|---|---|
| Server payload मिळत नाही | voucher API service → `src/main/api/httpClient.js` |
| XML बनण्यापूर्वी TypeError | voucher validator / shared date helper |
| XML मध्ये field चुकीचा | mapper → त्या voucher ची HBS |
| Tally port/refused/timeout | `transport/httpTransport.js` व Connector settings |
| Import exceptions / created 0 | generated XML → import parser → Tally exception |
| UI मध्ये status चुकीचा | socket activity/status handling; XML template नाही |

Existing export names आणि caller signatures कायम आहेत. API services जिथे आहेत तिथेच ठेवल्या आहेत; engine मध्ये Server dependency जोडलेली नाही.
