/*
 * build.js — Multi-project static builder.
 *
 * This repo hosts several small, self-contained web tools. Each one is bundled
 * into a single deployable index.html (inline CSS + JS + any vendored library,
 * zero external requests) so it works by simply opening the file, on any static
 * host, or via GitHub Pages "Deploy from a branch". The readable source lives
 * under src/<project>/; the generated index.html files are the artifacts.
 *
 *   src/home/       -> index.html                    (the landing hub)
 *   src/hospital/   -> projects/hospital/index.html  (Hospital dashboard)
 *   src/jb4/        -> projects/jb4/index.html        (JB4 dyno & log analyzer)
 *
 * Run: `node build.js`  (regenerates every index.html)
 */
const fs = require("fs");
const path = require("path");

const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");
const emojiFavicon = (e) =>
  `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${e}</text></svg>`;

// A project = some CSS files, some JS files (concatenated in order), a body
// HTML fragment, and page metadata. Everything is inlined into one file.
const PROJECTS = [
  {
    id: "home",
    out: "index.html",
    lang: "en",
    title: "Projects · demo-claude",
    description: "A small hub of self-contained, no-backend web tools.",
    favicon: "🧰",
    css: ["src/home/style.css"],
    js: [],
    body: "src/home/body.html",
  },
  {
    id: "hospital",
    out: "projects/hospital/index.html",
    lang: "en",
    title: "Hospital Performance Dashboard",
    description:
      "Department & clinician performance analytics for a hospital — demo with editable, locally-saved data. Single self-contained file.",
    favicon: "🏥",
    css: ["src/hospital/css/style.css"],
    js: [
      "src/hospital/js/chart.umd.min.js", // Chart.js first (defines window.Chart)
      "src/hospital/js/seed.js",
      "src/hospital/js/store.js",
      "src/hospital/js/metrics.js",
      "src/hospital/js/insights.js",
      "src/hospital/js/charts.js",
      "src/hospital/js/app.js",
    ],
    body: "src/hospital/body.html",
  },
  {
    id: "jb4",
    out: "projects/jb4/index.html",
    lang: "en",
    title: "JB4 Dyno & Log Analyzer",
    description:
      "Upload a raw JB4 datalog and see engine vs wheel horsepower & torque, boost/timing/AFR health, wheel-spin detection, JB4 map comparison, and plain-English tuning recommendations. Optional RaceBox GPS track. Fully client-side, single self-contained file.",
    favicon: "🏎️",
    css: ["src/jb4/css/style.css"],
    js: [
      "src/jb4/js/chart.umd.min.js", // Chart.js first (defines window.Chart)
      "src/jb4/js/carspecs.js",
      "src/jb4/js/sample.js",
      "src/jb4/js/parse.js",
      "src/jb4/js/dyno.js",
      "src/jb4/js/analyze.js",
      "src/jb4/js/charts.js",
      "src/jb4/js/app.js",
    ],
    body: "src/jb4/body.html",
  },
];

function buildProject(p) {
  const css = p.css.map(read).join("\n\n");
  const js = p.js.map((f) => `/* ===== ${f} ===== */\n${read(f)}`).join("\n\n");
  const body = read(p.body);

  const html = `<!DOCTYPE html>
<html lang="${p.lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${p.title}</title>
  <meta name="description" content="${p.description.replace(/"/g, "&quot;")}" />
  <link rel="icon" href="${emojiFavicon(p.favicon)}" />
  <style>
${css}
  </style>
</head>
<body>
${body}${js ? `
  <script>
${js}
  </script>` : ""}
</body>
</html>
`;

  const outAbs = path.join(__dirname, p.out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`  ${p.out.padEnd(30)} ${kb.padStart(5)} KB  (${p.js.length} scripts + ${p.css.length} css inlined)`);
}

console.log("Building self-contained projects:");
PROJECTS.forEach(buildProject);
console.log("Done.");
