import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

// Protected builds bundle main into src/main/index.cjs and copy templates beside it.
const templateRoot =
  typeof __dirname === "string"
    ? path.join(__dirname, "utils/tally-connector-engine")
    : fileURLToPath(new URL("../../", import.meta.url));
const compiledTemplates = new Map();
const handlebars = Handlebars.create();

/** Internal contexts contain escaped XML scalars and trusted rendered fragments. */
export function renderXmlTemplate(template, context) {
  const filename = path.resolve(templateRoot, template);
  if (!filename.startsWith(path.resolve(templateRoot) + path.sep) || !filename.endsWith(".hbs")) {
    throw new TypeError("Invalid voucher template path.");
  }
  let render = compiledTemplates.get(filename);
  if (!render) {
    render = handlebars.compile(fs.readFileSync(filename, "utf8"), { strict: true });
    compiledTemplates.set(filename, render);
  }
  return render(context);
}
