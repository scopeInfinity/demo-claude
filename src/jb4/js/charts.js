/*
 * charts.js — Chart.js line wrappers plus a dependency-free GPS track renderer.
 * Every chart is x=engine RPM (or time) with {x,y} points so pulls with
 * different rpm ranges overlay cleanly. If Chart.js is somehow unavailable the
 * card shows a friendly note instead of throwing.
 */
const JB4Charts = (() => {
  const registry = {};
  const PALETTE = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

  function _fresh(id) {
    if (registry[id]) { registry[id].destroy(); delete registry[id]; }
    const c = document.getElementById(id);
    if (!c) return null;
    if (typeof window.Chart === "undefined") {
      const w = c.closest(".canvas-wrap");
      if (w) w.innerHTML = '<div class="chart-offline">📉 Chart library unavailable.</div>';
      return null;
    }
    return c.getContext("2d");
  }
  const css = (v, f) => getComputedStyle(document.body).getPropertyValue(v).trim() || f;
  const grid = () => css("--grid", "rgba(0,0,0,0.08)");
  const text = () => css("--fg-soft", "#64748b");

  // datasets: [{label, points:[{x,y}], color, dash:[], fill?}]
  function xyLine(id, datasets, opts = {}) {
    const ctx = _fresh(id);
    if (!ctx) return;
    registry[id] = new Chart(ctx, {
      type: "line",
      data: {
        datasets: datasets.map((d, i) => ({
          label: d.label,
          data: d.points,
          borderColor: d.color || PALETTE[i % PALETTE.length],
          backgroundColor: d.fill ? (d.color || PALETTE[i % PALETTE.length]) + "22" : "transparent",
          borderDash: d.dash || [],
          borderWidth: d.width || 2,
          pointRadius: 0,
          tension: 0.25,
          fill: !!d.fill,
          spanGaps: true,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          legend: { labels: { color: text(), boxWidth: 14, font: { size: 11 } } },
          tooltip: { callbacks: { title: (t) => (opts.xTitle || "x") + ": " + Math.round(t[0].parsed.x) } },
        },
        scales: {
          x: {
            type: "linear",
            title: { display: !!opts.xTitle, text: opts.xTitle, color: text() },
            ticks: { color: text() }, grid: { color: grid() },
            min: opts.xMin, max: opts.xMax,
          },
          y: {
            title: { display: !!opts.yTitle, text: opts.yTitle, color: text() },
            ticks: { color: text() }, grid: { color: grid() },
            beginAtZero: opts.beginAtZero !== false, suggestedMax: opts.yMax,
          },
        },
      },
    });
  }

  // Build {x:rpm, y:val} points from two aligned arrays, skipping NaN.
  function pts(xs, ys) {
    const out = [];
    for (let i = 0; i < xs.length; i++) if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) out.push({ x: xs[i], y: ys[i] });
    return out;
  }

  // ---- GPS track map: plot lat/lon as a path, coloured by a value (speed or
  // slip). No tiles, no network — an equirectangular projection scaled to the
  // route's bounding box. Shows *where* on your drive things happened.
  function trackMap(canvasId, gps, colorValues, label) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const W = (canvas.width = wrap.clientWidth || 600);
    const H = (canvas.height = 300);
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, W, H);

    const lat = gps.lat, lon = gps.lon;
    const n = lat.length;
    if (n < 2) return;
    let minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity;
    for (let i = 0; i < n; i++) {
      minLa = Math.min(minLa, lat[i]); maxLa = Math.max(maxLa, lat[i]);
      minLo = Math.min(minLo, lon[i]); maxLo = Math.max(maxLo, lon[i]);
    }
    const latMid = (minLa + maxLa) / 2;
    const mPerLon = Math.cos((latMid * Math.PI) / 180); // longitude compression
    const spanLo = Math.max((maxLo - minLo) * mPerLon, 1e-6);
    const spanLa = Math.max(maxLa - minLa, 1e-6);
    const pad = 24;
    const scale = Math.min((W - 2 * pad) / spanLo, (H - 2 * pad) / spanLa);
    const px = (i) => pad + ((lon[i] - minLo) * mPerLon) * scale + (W - 2 * pad - spanLo * scale) / 2;
    const py = (i) => H - pad - (lat[i] - minLa) * scale - (H - 2 * pad - spanLa * scale) / 2;

    // colour scale over the values
    const vals = (colorValues || []).filter(Number.isFinite);
    const vmin = vals.length ? Math.min(...vals) : 0;
    const vmax = vals.length ? Math.max(...vals) : 1;
    const heat = (v) => {
      if (!Number.isFinite(v) || vmax === vmin) return "#2563eb";
      const t = (v - vmin) / (vmax - vmin); // 0..1  blue->green->red
      const r = Math.round(255 * Math.min(1, t * 2));
      const b = Math.round(255 * Math.min(1, (1 - t) * 2));
      const gg = Math.round(180 * (1 - Math.abs(t - 0.5) * 2) + 40);
      return `rgb(${r},${gg},${b})`;
    };

    g.lineWidth = 3.5;
    g.lineCap = "round";
    for (let i = 1; i < n; i++) {
      g.beginPath();
      g.strokeStyle = colorValues ? heat(colorValues[i]) : "#2563eb";
      g.moveTo(px(i - 1), py(i - 1));
      g.lineTo(px(i), py(i));
      g.stroke();
    }
    // start (green) / end (red) markers
    const dot = (i, col) => { g.beginPath(); g.fillStyle = col; g.arc(px(i), py(i), 5, 0, 7); g.fill(); };
    dot(0, "#059669"); dot(n - 1, "#dc2626");

    // legend
    g.fillStyle = text();
    g.font = "11px system-ui, sans-serif";
    if (colorValues && vals.length) {
      g.fillText(`${label || "value"}: ${vmin.toFixed(0)} (blue) → ${vmax.toFixed(0)} (red)`, pad, 16);
    }
    g.fillText("● start", W - 96, 16); g.fillStyle = "#059669"; g.fillRect(W - 100, 8, 8, 8);
    g.fillStyle = text(); g.fillText("● end", W - 40, 16); g.fillStyle = "#dc2626"; g.fillRect(W - 44, 8, 8, 8);
  }

  function destroyAll() { Object.keys(registry).forEach((id) => { registry[id].destroy(); delete registry[id]; }); }

  return { xyLine, pts, trackMap, destroyAll, PALETTE };
})();
