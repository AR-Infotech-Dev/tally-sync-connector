import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import prettier from "prettier";

const root = fileURLToPath(new URL("../", import.meta.url));
const write = process.argv.includes("--write");

async function templates(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? templates(filename) : filename;
    }),
  );
  return files.flat().filter((filename) => filename.endsWith(".xml.hbs"));
}

async function formatTemplate(source, filename) {
  // XML parsers cannot read Handlebars comments or dynamic UDF tag names.
  // Protect those tokens while the XML formatter preserves case and text values.
  const tokens = [];
  const protect = (value) => {
    const marker = `FLOWUPS_FORMAT_TOKEN_${tokens.length}`;
    tokens.push({ marker, value });
    return marker;
  };
  const protectedSource = source
    .replace(/{{!--[\s\S]*?--}}/g, (comment) => `<!--${protect(comment)}-->`)
    .replace(/(UDF:)({{[^{}]+}})/g, (_match, prefix, expression) => prefix + protect(expression));
  let output = await prettier.format(protectedSource, {
    ...(await prettier.resolveConfig(filename)),
    parser: "xml",
    plugins: ["@prettier/plugin-xml"],
    xmlWhitespaceSensitivity: "strict",
  });
  for (const { marker, value } of tokens) {
    output = value.startsWith("{{!--")
      ? output.replace(`<!--${marker}-->`, value)
      : output.replaceAll(marker, value);
  }
  return output;
}

let changed = 0;
for (const filename of await templates(path.join(root, "src"))) {
  const source = await readFile(filename, "utf8");
  const output = await formatTemplate(source, filename);
  if (source === output) continue;
  changed++;
  if (write) await writeFile(filename, output);
  else console.error(`XML template needs formatting: ${path.relative(root, filename)}`);
}
if (!write && changed) process.exitCode = 1;
console.info(write ? `Formatted ${changed} XML templates.` : "XML template format check finished.");
