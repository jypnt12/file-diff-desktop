import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const npmMonacoRoot = path.join(root, "node_modules", "monaco-editor");
const src = path.join(npmMonacoRoot, "min", "vs");
const dest = path.join(root, "src", "vendor", "monaco", "vs");
// Tauri/WebKit DevTools can try to fetch Monaco source maps with stricter
// access checks than the runtime loader. Strip the links from vendored files.
const vendorMinMapsRoot = path.join(root, "src", "vendor", "min-maps");
const nlsMapsDest = path.join(root, "src", "vendor", "monaco", "min-maps");

if (!fs.existsSync(src)) {
  console.warn("monaco-editor not installed; run npm install");
  process.exit(0);
}

function rmRecursive(p) {
  if (!fs.existsSync(p)) return;
  for (const name of fs.readdirSync(p)) {
    const cur = path.join(p, name);
    const st = fs.lstatSync(cur);
    if (st.isDirectory()) rmRecursive(cur);
    else fs.unlinkSync(cur);
  }
  fs.rmdirSync(p);
}

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function stripSourceMapLinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const cur = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      stripSourceMapLinks(cur);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;

    const original = fs.readFileSync(cur, "utf8");
    const stripped = original.replace(/\n\/\/# sourceMappingURL=.*$/gm, "");
    if (stripped !== original) fs.writeFileSync(cur, stripped);
  }
}

rmRecursive(dest);
rmRecursive(vendorMinMapsRoot);
rmRecursive(nlsMapsDest);

fs.mkdirSync(path.dirname(dest), { recursive: true });
copyDir(src, dest);
stripSourceMapLinks(dest);

console.log("Monaco vendored to src/vendor/monaco/vs");
console.log("Monaco source map references stripped");
