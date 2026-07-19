/*
 * build.js — Bundles the modular source in assets/ into a single, fully
 * self-contained index.html (inline CSS + JS + Chart.js, zero external
 * requests). Run: `node build.js`
 *
 * Why: the app then works by simply opening index.html (double-click, any
 * static host, or GitHub Pages "Deploy from a branch") with no build server
 * and no CDN. assets/ stays the readable source of truth; index.html is the
 * generated, deployable artifact — edit assets/, then re-run this script.
 */
const fs = require("fs");
const path = require("path");

const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");

const css = read("assets/css/style.css");
const jsFiles = [
  "assets/js/chart.umd.min.js", // Chart.js first (defines window.Chart)
  "assets/js/seed.js",
  "assets/js/store.js",
  "assets/js/metrics.js",
  "assets/js/insights.js",
  "assets/js/charts.js",
  "assets/js/app.js",
];
const js = jsFiles.map((f) => `/* ===== ${f} ===== */\n${read(f)}`).join("\n\n");

const favicon =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏥</text></svg>";

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hospital Performance Dashboard</title>
  <meta name="description" content="Department & clinician performance analytics for a hospital — demo with editable, locally-saved data. Single self-contained file." />
  <link rel="icon" href="${favicon}" />
  <style>
${css}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span class="logo">🏥</span>
      <div>
        <h1 id="hospitalName">Hospital</h1>
        <div class="sub">Performance dashboard · <span id="period">—</span></div>
      </div>
    </div>
    <div class="toolbar">
      <button class="btn" id="btnAdd">+ Clinician</button>
      <button class="btn" id="btnImport">Import</button>
      <button class="btn" id="btnExport">Export</button>
      <button class="btn" id="btnReset">Reset demo</button>
      <button class="btn icon-only" id="btnTheme" title="Toggle theme">◐</button>
      <input type="file" id="importFile" accept="application/json" hidden />
    </div>
  </header>

  <div class="layout">
    <aside class="sidebar">
      <div class="side-label">Views</div>
      <nav id="deptNav"></nav>
      <div class="side-note">
        Data is fake demo data, saved only in <strong>this browser</strong>
        (localStorage). Edit freely — use Export to keep a copy, Import to load one.
      </div>
    </aside>

    <main id="main" class="content"><!-- rendered by app.js --></main>
  </div>

  <script>
${js}
  </script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, "index.html"), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Built index.html (${kb} KB, self-contained, ${jsFiles.length} scripts + css inlined).`);
