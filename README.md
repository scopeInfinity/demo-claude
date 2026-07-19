# 🏥 Hospital Performance Dashboard

A lightweight, **no-backend** web dashboard for tracking the performance of
departments and clinicians in a hospital. Built for a radiology-focused
institute, but the model is general enough for any specialty.

It ships with realistic **demo data** and is fully **editable in the browser** —
add, edit, and delete clinicians and departments, and everything is saved in
your browser's `localStorage`. No server, no accounts, no database.

## What it measures

Per clinician (over a rolling period, e.g. a quarter):

| Area | Metric |
|------|--------|
| **Case acceptance** | cases accepted ÷ cases referred |
| **Surgery volume** | minor vs. major procedures |
| **Surgery outcomes** | success vs. failure → success rate |
| **Radiology** | scans reported, avg report turnaround (hrs) |
| **Experience** | patient satisfaction (1–5) |

From these it computes a transparent **Performance Score (0–100)** — a weighted
blend of acceptance, surgical success, workload/volume, turnaround, and
satisfaction. Weights auto-adjust when a component doesn't apply (e.g. a pure
radiologist with few surgeries). The formula lives in
[`assets/js/metrics.js`](assets/js/metrics.js) and is meant to be tuned to your
hospital's standards.

## Automated insights (the "AI analyst")

The **Automated insights** panel reads the numbers and writes plain-English
findings — top performers, who needs attention, and department gaps — so a lead
doesn't have to evaluate everyone by hand. It's a **rules-based engine** that
runs entirely on-device (no data leaves the browser), which keeps it auditable
and privacy-safe. Thresholds live in
[`assets/js/insights.js`](assets/js/insights.js).

> Want a true LLM narrative instead? The same `scored` dataset can be handed to
> an API-backed summarizer later — the structure is already there.

## Editing & data

- **+ Clinician** / **Edit** / **Del** — manage staff and their metrics.
- **New department** — type a name in the editor to create one on the fly.
- **Export** — download your data as JSON (your backup).
- **Import** — load a previously exported JSON file.
- **Reset demo** — restore the original demo dataset.

All data is stored in `localStorage` under `hospitalDashboard.v1`. Clearing your
browser data clears it — use **Export** to keep a copy.

## Running it — just open the file

`index.html` is a **single, fully self-contained file** — all CSS, JavaScript,
and Chart.js are inlined, so it makes **zero external requests**. To use it:

- **Double-click `index.html`** — it opens in your browser and works offline. No
  server, no install, nothing to configure.
- Or serve the folder if you prefer: `python3 -m http.server 8000` →
  `http://localhost:8000`.

## Deployment

Because it's one static file, you can host it almost anywhere:

**GitHub Pages (simplest — "Deploy from a branch", no workflow):**

1. Go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: **`main`**, folder: **`/ (root)`** → **Save**.
4. Wait ~1 minute; the site goes live at
   `https://<your-username>.github.io/<repo>/`.

**Anywhere else:** drag `index.html` onto Netlify Drop, Cloudflare Pages,
Vercel, or any static host / intranet file share. It's one file.

## Editing the code (optional)

`index.html` is **generated** from the readable source in `assets/` by a small
bundler. If you change any logic or styling, edit the files under `assets/` and
rebuild:

```bash
node build.js   # regenerates the self-contained index.html
```

(Editing *data* — clinicians, departments, metrics — is done in the browser UI,
not in these files.)

## Tech

Vanilla HTML/CSS/JS + [Chart.js](https://www.chartjs.org/) (vendored locally, no
CDN). No framework, no runtime dependencies.

## Project layout

```
index.html              # generated, self-contained, deployable app (build.js output)
build.js                # bundles assets/ into index.html
assets/css/style.css    # theming (light/dark) and layout
assets/js/seed.js       # demo dataset
assets/js/store.js      # localStorage persistence
assets/js/metrics.js    # scoring engine
assets/js/insights.js   # automated findings
assets/js/charts.js     # Chart.js wrappers
assets/js/app.js        # UI controller / routing / editor
assets/js/chart.umd.min.js  # vendored Chart.js
```
