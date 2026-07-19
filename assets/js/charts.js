/*
 * charts.js — Thin wrappers around Chart.js. Each function creates/replaces
 * a chart on a given canvas and returns the instance so it can be destroyed
 * before re-render (avoids the classic "canvas already in use" error).
 */
const Charts = (() => {
  const registry = {};

  const PALETTE = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#db2777", "#65a30d"];

  // Returns a 2d context, or null if Chart.js isn't available (e.g. the CDN
  // is blocked/offline). In that case we drop a friendly note in the card so
  // the rest of the dashboard keeps working instead of throwing.
  function _fresh(id) {
    if (registry[id]) {
      registry[id].destroy();
      delete registry[id];
    }
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    if (typeof window.Chart === "undefined") {
      const wrap = canvas.closest(".canvas-wrap");
      if (wrap) wrap.innerHTML = '<div class="chart-offline">📉 Chart library unavailable (offline). Data tables below still work.</div>';
      return null;
    }
    return canvas.getContext("2d");
  }

  function _gridColor() {
    return getComputedStyle(document.body).getPropertyValue("--grid").trim() || "rgba(0,0,0,0.08)";
  }
  function _textColor() {
    return getComputedStyle(document.body).getPropertyValue("--fg-soft").trim() || "#64748b";
  }

  function _baseOpts(extra = {}) {
    return Object.assign(
      {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: _textColor() } },
        },
        scales: {
          x: { ticks: { color: _textColor() }, grid: { color: _gridColor() } },
          y: { ticks: { color: _textColor() }, grid: { color: _gridColor() }, beginAtZero: true },
        },
      },
      extra
    );
  }

  // Horizontal bar: department average performance score.
  function departmentScores(id, depts) {
    const rows = depts.filter((d) => d.count > 0);
    const ctx = _fresh(id);
    if (!ctx) return;
    registry[id] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((d) => d.name),
        datasets: [
          {
            label: "Avg performance score",
            data: rows.map((d) => d.avgScore),
            backgroundColor: rows.map((_, i) => PALETTE[i % PALETTE.length]),
            borderRadius: 6,
          },
        ],
      },
      options: _baseOpts({
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: _textColor() }, grid: { color: _gridColor() }, beginAtZero: true, max: 100 },
          y: { ticks: { color: _textColor() }, grid: { display: false } },
        },
      }),
    });
  }

  // Stacked bar: surgery outcomes (success vs failure) per department.
  function surgeryOutcomes(id, depts) {
    const rows = depts.filter((d) => d.totalSuccess + d.totalFailure > 0);
    const ctx = _fresh(id);
    if (!ctx) return;
    registry[id] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((d) => d.name),
        datasets: [
          { label: "Success", data: rows.map((d) => d.totalSuccess), backgroundColor: "#059669", borderRadius: 4 },
          { label: "Failure", data: rows.map((d) => d.totalFailure), backgroundColor: "#dc2626", borderRadius: 4 },
        ],
      },
      options: _baseOpts({
        scales: {
          x: { stacked: true, ticks: { color: _textColor() }, grid: { display: false } },
          y: { stacked: true, ticks: { color: _textColor() }, grid: { color: _gridColor() }, beginAtZero: true },
        },
      }),
    });
  }

  // Grouped bar: minor vs major surgeries per department.
  function surgeryMix(id, depts) {
    const rows = depts.filter((d) => d.totalMinor + d.totalMajor > 0);
    const ctx = _fresh(id);
    if (!ctx) return;
    registry[id] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((d) => d.name),
        datasets: [
          { label: "Minor", data: rows.map((d) => d.totalMinor), backgroundColor: "#2563eb", borderRadius: 4 },
          { label: "Major", data: rows.map((d) => d.totalMajor), backgroundColor: "#7c3aed", borderRadius: 4 },
        ],
      },
      options: _baseOpts(),
    });
  }

  // Bar: case acceptance rate per clinician (whole hospital or one dept).
  function acceptanceByEmployee(id, employees) {
    const rows = [...employees].sort((a, b) => (b.acceptanceRate || 0) - (a.acceptanceRate || 0));
    const ctx = _fresh(id);
    if (!ctx) return;
    registry[id] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((e) => e.name.replace("Dr. ", "")),
        datasets: [
          {
            label: "Acceptance rate %",
            data: rows.map((e) => (e.acceptanceRate == null ? 0 : Math.round(e.acceptanceRate))),
            backgroundColor: rows.map((e) =>
              (e.acceptanceRate || 0) >= 90 ? "#059669" : (e.acceptanceRate || 0) >= 75 ? "#d97706" : "#dc2626"
            ),
            borderRadius: 4,
          },
        ],
      },
      options: _baseOpts({
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: _textColor(), maxRotation: 60, minRotation: 45 }, grid: { display: false } },
          y: { ticks: { color: _textColor() }, grid: { color: _gridColor() }, beginAtZero: true, max: 100 },
        },
      }),
    });
  }

  // Radar: one clinician across the five scoring dimensions.
  function employeeRadar(id, emp) {
    const s = emp.subScores || {};
    const ctx = _fresh(id);
    if (!ctx) return;
    registry[id] = new Chart(ctx, {
      type: "radar",
      data: {
        labels: ["Acceptance", "Surgery", "Volume", "Turnaround", "Satisfaction"],
        datasets: [
          {
            label: emp.name,
            data: [s.acceptance, s.surgery, s.volume, s.turnaround, s.satisfaction].map((v) => (v == null ? 0 : Math.round(v))),
            backgroundColor: "rgba(37,99,235,0.2)",
            borderColor: "#2563eb",
            pointBackgroundColor: "#2563eb",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: { color: _textColor(), backdropColor: "transparent", stepSize: 25 },
            grid: { color: _gridColor() },
            angleLines: { color: _gridColor() },
            pointLabels: { color: _textColor(), font: { size: 12 } },
          },
        },
      },
    });
  }

  function destroyAll() {
    Object.keys(registry).forEach((id) => {
      registry[id].destroy();
      delete registry[id];
    });
  }

  return { departmentScores, surgeryOutcomes, surgeryMix, acceptanceByEmployee, employeeRadar, destroyAll };
})();
