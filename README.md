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

## Running locally

It's plain static files. Just open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deployment — GitHub Pages

This repo is deployed with **GitHub Pages** (chosen over Firebase because the
app is fully static — Pages is free and needs zero backend setup).

A workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
publishes the site automatically on every push to the default branch.

**One-time setup** (once this branch is merged to the default branch):

1. Go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to the default branch (or re-run the workflow). The site goes live at
   `https://<your-username>.github.io/<repo>/`.

## Tech

Vanilla HTML/CSS/JS + [Chart.js](https://www.chartjs.org/) (via CDN). No build
step, no framework, no dependencies to install.

## Project layout

```
index.html              # shell + script/style includes
assets/css/style.css    # theming (light/dark) and layout
assets/js/seed.js       # demo dataset
assets/js/store.js      # localStorage persistence
assets/js/metrics.js    # scoring engine
assets/js/insights.js   # automated findings
assets/js/charts.js     # Chart.js wrappers
assets/js/app.js        # UI controller / routing / editor
```
