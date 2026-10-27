import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import * as builders from "../src/main/utils/tally-connector-engine/xml.js";

// Captured from the old engine before removing fragments.
const samples = JSON.parse(readFileSync(new URL("./fixtures/voucher-xml-baseline.json", import.meta.url), "utf8"));
function structure(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  function visit(node) {
    if (node.nodeType === 1) return { tag: node.nodeName, attributes: Array.from(node.attributes).map(a => [a.name, a.value]).sort(), children: Array.from(node.childNodes).map(visit).filter(value => value !== null) };
    if (node.nodeType === 3 && node.data.trim()) return node.data.trim();
    return null;
  }
  return visit(doc.documentElement);
}
for (const [index, sample] of samples.entries()) {
  test(`${sample.folder} preserves old XML (${index % 2 ? "optional fields" : "minimal"})`, () => {
    const input = structuredClone(sample.input);
    assert.deepEqual(structure(builders[sample.fn](input)), structure(sample.xml));
    assert.deepEqual(input, sample.input);
  });
}
test("Missing order due dates and nested UDF values fail before posting", () => {
  for (const folder of ["sales-order", "purchase-order"]) {
    const sample = samples.find(row => row.folder === folder);
    const input = structuredClone(sample.input);
    delete input.order.order_due_date;
    assert.throws(() => builders[sample.fn](input), /order_due_date/);
  }
  for (const sample of samples.filter((_, index) => index % 2 === 0)) {
    const input = structuredClone(sample.input);
    const key = Object.keys(input).find(key => ["order", "sales", "purchase", "receipt", "payment"].includes(key));
    input[key].custom_fields = { Invalid: { nested: true } };
    assert.throws(() => builders[sample.fn](input), /Unsupported custom field/);
  }
});
test("Six voucher templates and one common envelope replace the fragments", () => {
  const root = new URL("../src/main/utils/tally-connector-engine/", import.meta.url);
  assert.deepEqual(readdirSync(new URL("shared/XML/", root)).filter(name => name.endsWith(".hbs")), ["import-envelope.xml.hbs"]);
  for (const folder of new Set(samples.map(row => row.folder))) {
    const directory = new URL(`modules/vouchers/${folder}/`, root);
    assert.deepEqual(readdirSync(directory).filter(name => name.endsWith(".hbs")), [`${folder}.xml.hbs`]);
    assert.ok(!readFileSync(new URL(`${folder}.mapper.js`, directory), "utf8").includes("renderXmlTemplate"));
  }
});
