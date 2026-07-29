/*
 * app.js — Application controller. Wires the store, metrics, insights and
 * charts to the DOM. Handles routing between views, the edit/add/delete
 * modal, and import/export/reset.
 */
(() => {
  let data = Store.load();
  let scored = [];
  let deptRollup = [];
  let overall = {};
  let currentView = { name: "overview", id: null };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const deptName = (id) => (data.departments.find((d) => d.id === id) || { name: id }).name;
  const fmt = (v, s = "") => (v == null ? "—" : Math.round(v) + s);

  function recompute() {
    scored = Metrics.scoreAll(data.employees);
    deptRollup = Metrics.byDepartment(scored, data.departments);
    overall = Metrics.overall(scored);
  }

  function scoredById(id) {
    return scored.find((e) => e.id === id);
  }

  /* ---------------- Rendering ---------------- */

  function renderHeader() {
    $("#hospitalName").textContent = data.hospitalName;
    $("#period").textContent = data.period;
  }

  function renderNav() {
    const nav = $("#deptNav");
    nav.innerHTML = "";
    const mk = (label, view) => {
      const b = el("button", "nav-item", label);
      if (currentView.name === view.name && currentView.id === view.id) b.classList.add("active");
      b.onclick = () => {
        currentView = view;
        render();
      };
      return b;
    };
    nav.appendChild(mk("Overview", { name: "overview", id: null }));
    data.departments.forEach((d) => {
      const count = data.employees.filter((e) => e.department === d.id).length;
      nav.appendChild(mk(`${d.name} (${count})`, { name: "department", id: d.id }));
    });
  }

  function kpiCard(label, value, sub) {
    return `<div class="kpi"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ""}</div>`;
  }

  function scoreBadge(score) {
    const cls = score >= 85 ? "b-good" : score >= 60 ? "b-mid" : "b-bad";
    return `<span class="badge ${cls}">${score}</span>`;
  }

  function renderOverview() {
    const main = $("#main");
    main.innerHTML = "";

    main.appendChild(el("div", "kpi-row", [
      kpiCard("Clinicians", overall.staff),
      kpiCard("Avg score", overall.avgScore + "<span class='u'>/100</span>"),
      kpiCard("Case acceptance", fmt(overall.acceptanceRate, "%")),
      kpiCard("Surgical success", fmt(overall.successRate, "%")),
      kpiCard("Procedures", overall.totalMinor + overall.totalMajor, `${overall.totalMinor} minor · ${overall.totalMajor} major`),
      kpiCard("Scans reported", overall.totalScans.toLocaleString()),
    ].join("")));

    // Chart grid
    const grid = el("div", "chart-grid");
    grid.innerHTML = `
      ${chartCard("Department performance", "chartDeptScores")}
      ${chartCard("Surgery outcomes by department", "chartOutcomes")}
      ${chartCard("Minor vs major procedures", "chartMix")}
      ${chartCard("Case acceptance by clinician", "chartAcceptance")}
    `;
    main.appendChild(grid);

    // Insights
    main.appendChild(renderInsights());

    // Full staff table
    main.appendChild(sectionTitle("All clinicians", true));
    main.appendChild(renderTable(scored));

    // Draw charts after DOM insert
    Charts.departmentScores("chartDeptScores", deptRollup);
    Charts.surgeryOutcomes("chartOutcomes", deptRollup);
    Charts.surgeryMix("chartMix", deptRollup);
    Charts.acceptanceByEmployee("chartAcceptance", scored);
  }

  function renderDepartment(id) {
    const main = $("#main");
    main.innerHTML = "";
    const dept = deptRollup.find((d) => d.id === id);
    const members = scored.filter((e) => e.department === id);

    main.appendChild(el("div", "kpi-row", [
      kpiCard("Clinicians", dept.count),
      kpiCard("Avg score", dept.avgScore + "<span class='u'>/100</span>"),
      kpiCard("Case acceptance", fmt(dept.acceptanceRate, "%")),
      kpiCard("Surgical success", fmt(dept.successRate, "%")),
      kpiCard("Procedures", dept.totalMinor + dept.totalMajor, `${dept.totalMinor} minor · ${dept.totalMajor} major`),
      kpiCard("Scans reported", dept.totalScans.toLocaleString()),
    ].join("")));

    const grid = el("div", "chart-grid");
    grid.innerHTML = `
      ${chartCard("Case acceptance by clinician", "chartDeptAcceptance")}
      ${chartCard(members.length ? members[0].name + " — profile" : "Profile", "chartRadar", "radarSelect")}
    `;
    main.appendChild(grid);

    main.appendChild(sectionTitle(deptName(id) + " team"));
    main.appendChild(renderTable(members));

    Charts.acceptanceByEmployee("chartDeptAcceptance", members);
    if (members.length) {
      // Populate radar selector
      const sel = grid.querySelector("#radarSelect");
      members.forEach((m) => {
        const o = el("option");
        o.value = m.id;
        o.textContent = m.name;
        sel.appendChild(o);
      });
      sel.onchange = () => {
        const m = scoredById(sel.value);
        sel.closest(".card").querySelector("h3").textContent = m.name + " — profile";
        Charts.employeeRadar("chartRadar", m);
      };
      Charts.employeeRadar("chartRadar", members[0]);
    }
  }

  function chartCard(title, canvasId, selectId) {
    const selector = selectId
      ? `<select id="${selectId}" class="mini-select"></select>`
      : "";
    return `<div class="card"><div class="card-head"><h3>${title}</h3>${selector}</div><div class="canvas-wrap"><canvas id="${canvasId}"></canvas></div></div>`;
  }

  function sectionTitle(text, withAdd) {
    const wrap = el("div", "section-head");
    wrap.appendChild(el("h2", null, text));
    if (withAdd) {
      const b = el("button", "btn btn-primary", "+ Add clinician");
      b.onclick = () => openEditor(null);
      wrap.appendChild(b);
    }
    return wrap;
  }

  function renderTable(rows) {
    const wrap = el("div", "table-wrap");
    const table = el("table", "data-table");
    table.innerHTML = `
      <thead><tr>
        <th>Clinician</th><th>Dept</th><th>Score</th>
        <th>Accept.</th><th>Minor</th><th>Major</th>
        <th>Success</th><th>Fail</th><th>Success %</th>
        <th>Scans</th><th>TAT (h)</th><th>Sat.</th><th></th>
      </tr></thead>`;
    const tbody = el("tbody");
    [...rows]
      .sort((a, b) => b.score - a.score)
      .forEach((e) => {
        const tr = el("tr");
        tr.innerHTML = `
          <td class="name"><span class="role-name">${e.name}</span><span class="role-sub">${e.role || ""}</span></td>
          <td>${deptName(e.department)}</td>
          <td>${scoreBadge(e.score)}</td>
          <td>${fmt(e.acceptanceRate, "%")}</td>
          <td>${e.minorSurgeries || 0}</td>
          <td>${e.majorSurgeries || 0}</td>
          <td class="ok">${e.surgerySuccess || 0}</td>
          <td class="bad">${e.surgeryFailure || 0}</td>
          <td>${fmt(e.successRate, "%")}</td>
          <td>${(e.scansReported || 0).toLocaleString()}</td>
          <td>${e.avgTurnaroundHrs || "—"}</td>
          <td>${typeof e.satisfaction === "number" ? e.satisfaction.toFixed(1) : "—"}</td>
          <td class="row-actions">
            <button class="link-btn" data-edit="${e.id}">Edit</button>
            <button class="link-btn danger" data-del="${e.id}">Del</button>
          </td>`;
        tbody.appendChild(tr);
      });
    table.appendChild(tbody);
    wrap.appendChild(table);
    wrap.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openEditor(b.dataset.edit)));
    wrap.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => removeEmployee(b.dataset.del)));
    return wrap;
  }

  function renderInsights() {
    const findings = Insights.generate(scored, deptRollup, overall);
    const card = el("div", "card insights");
    card.appendChild(el("div", "card-head", "<h3>🤖 Automated insights</h3><span class='muted'>rules-based, runs on-device</span>"));
    const list = el("ul", "insight-list");
    findings.forEach((f) => {
      const li = el("li", "insight " + f.level);
      li.innerHTML = f.text;
      list.appendChild(li);
    });
    card.appendChild(list);
    return card;
  }

  /* ---------------- Editor modal ---------------- */

  const NUM_FIELDS = [
    ["casesReferred", "Cases referred"],
    ["casesAccepted", "Cases accepted"],
    ["minorSurgeries", "Minor surgeries"],
    ["majorSurgeries", "Major surgeries"],
    ["surgerySuccess", "Surgery success"],
    ["surgeryFailure", "Surgery failure"],
    ["scansReported", "Scans reported"],
    ["avgTurnaroundHrs", "Avg turnaround (hrs)"],
    ["satisfaction", "Satisfaction (1–5)"],
  ];

  function openEditor(id) {
    const emp = id ? data.employees.find((e) => e.id === id) : null;
    const isNew = !emp;
    const model = emp
      ? { ...emp }
      : {
          id: Store.newId(),
          name: "",
          department: currentView.name === "department" ? currentView.id : data.departments[0].id,
          role: "",
          casesReferred: 0, casesAccepted: 0, minorSurgeries: 0, majorSurgeries: 0,
          surgerySuccess: 0, surgeryFailure: 0, scansReported: 0, avgTurnaroundHrs: 0, satisfaction: 4.0,
        };

    const overlay = el("div", "modal-overlay");
    const deptOptions = data.departments
      .map((d) => `<option value="${d.id}" ${d.id === model.department ? "selected" : ""}>${d.name}</option>`)
      .join("");

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-head"><h3>${isNew ? "Add clinician" : "Edit " + model.name}</h3><button class="icon-btn" id="mClose">✕</button></div>
        <div class="modal-body">
          <label class="fld"><span>Name</span><input id="f_name" value="${escapeAttr(model.name)}" placeholder="Dr. Jane Doe"></label>
          <label class="fld"><span>Role / title</span><input id="f_role" value="${escapeAttr(model.role || "")}" placeholder="Consultant Radiologist"></label>
          <label class="fld"><span>Department</span>
            <select id="f_dept">${deptOptions}</select>
          </label>
          <label class="fld"><span>New department (optional)</span><input id="f_newdept" placeholder="Type to create a new one"></label>
          <div class="num-grid">
            ${NUM_FIELDS.map(
              ([k, lbl]) =>
                `<label class="fld"><span>${lbl}</span><input type="number" step="${k === "satisfaction" ? "0.1" : "1"}" id="f_${k}" value="${model[k] != null ? model[k] : 0}"></label>`
            ).join("")}
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn" id="mCancel">Cancel</button>
          <button class="btn btn-primary" id="mSave">${isNew ? "Add" : "Save"}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector("#mClose").onclick = close;
    overlay.querySelector("#mCancel").onclick = close;
    overlay.onclick = (ev) => { if (ev.target === overlay) close(); };

    overlay.querySelector("#mSave").onclick = () => {
      const name = overlay.querySelector("#f_name").value.trim();
      if (!name) {
        overlay.querySelector("#f_name").focus();
        overlay.querySelector("#f_name").classList.add("err");
        return;
      }
      const newDept = overlay.querySelector("#f_newdept").value.trim();
      let deptId = overlay.querySelector("#f_dept").value;
      if (newDept) deptId = Store.addDepartment(data, newDept);

      const out = { ...model, name, role: overlay.querySelector("#f_role").value.trim(), department: deptId };
      NUM_FIELDS.forEach(([k]) => {
        const v = parseFloat(overlay.querySelector("#f_" + k).value);
        out[k] = isNaN(v) ? 0 : v;
      });
      // Guardrails: accepted can't exceed referred; outcomes are informational.
      if (out.casesAccepted > out.casesReferred) out.casesReferred = out.casesAccepted;

      Store.upsertEmployee(data, out);
      close();
      recompute();
      render();
    };
  }

  function removeEmployee(id) {
    const emp = data.employees.find((e) => e.id === id);
    if (!emp) return;
    if (!confirm(`Remove ${emp.name}? This only affects your local data.`)) return;
    Store.deleteEmployee(data, id);
    recompute();
    render();
  }

  /* ---------------- Data tools ---------------- */

  function exportJSON() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = "hospital-performance-data.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.employees || !parsed.departments) throw new Error("Missing employees/departments");
        data = parsed;
        Store.save(data);
        currentView = { name: "overview", id: null };
        recompute();
        render();
      } catch (e) {
        alert("Could not import: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  function resetDemo() {
    if (!confirm("Reset to the demo dataset? Your local edits will be lost.")) return;
    data = Store.reset();
    currentView = { name: "overview", id: null };
    recompute();
    render();
  }

  function toggleTheme() {
    const cur = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.body.setAttribute("data-theme", cur);
    try { localStorage.setItem("hospitalDashboard.theme", cur); } catch (e) {}
    render(); // re-draw charts with new colors
  }

  /* ---------------- Boot ---------------- */

  function render() {
    Charts.destroyAll();
    renderHeader();
    renderNav();
    if (currentView.name === "department") renderDepartment(currentView.id);
    else renderOverview();
  }

  function escapeAttr(s) {
    return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function bindGlobalControls() {
    $("#btnAdd").onclick = () => openEditor(null);
    $("#btnExport").onclick = exportJSON;
    $("#btnReset").onclick = resetDemo;
    $("#btnTheme").onclick = toggleTheme;
    const fileInput = $("#importFile");
    $("#btnImport").onclick = () => fileInput.click();
    fileInput.onchange = () => {
      if (fileInput.files[0]) importJSON(fileInput.files[0]);
      fileInput.value = "";
    };
  }

  // Restore theme
  let savedTheme = null;
  try { savedTheme = localStorage.getItem("hospitalDashboard.theme"); } catch (e) {}
  if (savedTheme) document.body.setAttribute("data-theme", savedTheme);

  bindGlobalControls();
  recompute();
  render();
})();
