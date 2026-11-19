// Frontend Build & Asset Integrity Verification Script
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;

const REQUIRED_FILES = [
  "index.html",
  "investigation/index.html",
  "solution/index.html",
  "resolved/index.html",
  "investigations/index.html",
  "knowledge-base/index.html",
  "assets/js/cluezy-api.js",
  "assets/js/cluezy-app.js",
  "serve.js",
  "vercel.json",
];

console.log("=== CLUEZY Frontend Build & Asset Verification ===");

let errors = 0;

for (const rel of REQUIRED_FILES) {
  const fullPath = path.join(ROOT, rel);
  if (!fs.existsSync(fullPath)) {
    console.error(`[FAIL] Missing required file: ${rel}`);
    errors++;
  } else {
    console.log(`[OK] Verified file: ${rel}`);
  }
}

// Verify JavaScript syntax of cluezy-api.js and cluezy-app.js
for (const jsRel of ["assets/js/cluezy-api.js", "assets/js/cluezy-app.js", "serve.js"]) {
  const fullPath = path.join(ROOT, jsRel);
  const code = fs.readFileSync(fullPath, "utf8");
  try {
    new vm.Script(code, { filename: jsRel });
    console.log(`[OK] Syntax check passed: ${jsRel}`);
  } catch (err) {
    console.error(`[FAIL] Syntax error in ${jsRel}:`, err.message);
    errors++;
  }
}

// Verify HTML pages include cluezy-api.js and cluezy-app.js and contain no secret strings
for (const htmlRel of REQUIRED_FILES.filter((f) => f.endsWith(".html"))) {
  const fullPath = path.join(ROOT, htmlRel);
  const html = fs.readFileSync(fullPath, "utf8");
  if (!html.includes("/assets/js/cluezy-api.js") || !html.includes("/assets/js/cluezy-app.js")) {
    console.error(`[FAIL] ${htmlRel} is missing cluezy script tags`);
    errors++;
  }
  if (/gsk_[A-Za-z0-9]{20,}/i.test(html) || /postgresql(\+asyncpg)?:\/\//i.test(html)) {
    console.error(`[FAIL] ${htmlRel} contains exposed secret pattern`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\nFrontend build verification FAILED with ${errors} error(s).`);
  process.exit(1);
}

console.log("\nFrontend build verification SUCCEEDED (0 errors).");

