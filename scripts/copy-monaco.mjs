import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "node_modules", "monaco-editor", "min", "vs");
const dest = path.join(root, "src", "vendor", "monaco", "vs");

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

rmRecursive(dest);
fs.mkdirSync(path.dirname(dest), { recursive: true });
copyDir(src, dest);
console.log("Monaco vendored to src/vendor/monaco/vs");
