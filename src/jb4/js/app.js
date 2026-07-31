/*
 * app.js — UI controller for the JB4 Dyno & Log Analyzer.
 * Wires file upload → parse → segment → per-pull dyno + analysis → charts and
 * recommendations. Car specs live in localStorage; logs stay in memory.
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
  // How hard the detected pulls were driven (see PULL_TIERS in parse.js).
  const KIND_LABEL = { wot: "wide-open", partial: "part-throttle", light: "light-throttle" };

  // "map 3 → 5" when the log itself recorded which JB4 map was running.
  function mapSummary(s) {
    const runs = JB4Parse.mapRuns(s.rec);
    if (!runs.length) return "";
    const maps = [...new Set(runs.map((m) => m.map))];
    return `<span class="mini-note">${maps.length > 1 ? `maps ${runs.map((m) => m.map).join(" → ")}` : `map ${maps[0]}`}</span>`;
  }

  // ---------- car specs (persisted) ----------
  const SPEC_KEY = "jb4.specs.v1";
  function loadSpecState() {
    try { const raw = localStorage.getItem(SPEC_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return { preset: CAR_SPECS.DEFAULT, overrides: {} };
  }
  function saveSpecState() { try { localStorage.setItem(SPEC_KEY, JSON.stringify(specState)); } catch (e) {} }
  let specState = loadSpecState();

  // Merge preset + user overrides into a live spec object.
  function spec() {
    const base = CAR_SPECS.PRESETS[specState.preset] || CAR_SPECS.PRESETS[CAR_SPECS.DEFAULT];
    return Object.assign({}, base, specState.overrides);
  }

  // ---------- session state ----------
  let sessions = []; // {id,name,rec,segments,pulls:[{seg,pull}],gps,mapLabel,sel}
  let selId = null;
  let nextId = 1;

  function selected() { return sessions.find((s) => s.id === selId); }

  // ---------- theme ----------
  function initTheme() {
    const saved = localStorage.getItem("jb4.theme");
    if (saved) document.body.dataset.theme = saved;
    $("#btnTheme").onclick = () => {
      const now = document.body.dataset.theme === "dark" ? "light" : "dark";
      document.body.dataset.theme = now; localStorage.setItem("jb4.theme", now);
      render();
    };
  }

  /* =========================================================
     FILE HANDLING
     ========================================================= */
  function addJB4Text(name, text) {
    let rec;
    try { rec = JB4Parse.parseJB4(text); }
    catch (e) { alert(`Couldn't read "${name}":\n${e.message}`); return; }
    const segments = JB4Parse.segment(rec);
    // Strict wide-open first; falls back to part/light-throttle climbs so a log
    // without a proper WOT run still produces something to look at.
    const { pulls, kind } = JB4Parse.findPullsAcross(rec, segments);
    // Default to the longest sustained pull. Widest rpm span sounds better but
    // picks launches out of first gear — short, wheelspin-heavy, and read low;
    // the longest pull is the one a tuner would actually quote.
    let sel = 0;
    if (pulls.length) {
      let best = -1;
      pulls.forEach((pp, i) => {
        const score = pp.pull.secs * 1e6 + (pp.pull.rpmEnd - pp.pull.rpmStart); // duration first, span only breaks ties
        if (score > best) { best = score; sel = i; }
      });
    }
    const s = { id: nextId++, name, rec, segments, pulls, pullKind: kind,
      diag: pulls.length ? null : JB4Parse.pullDiagnostics(rec, segments),
      gps: null, mapLabel: guessMap(name, sessions.length), sel };
    sessions.push(s);
    selId = s.id;
    render();
  }

  function guessMap(name, i) {
    const m = String(name).match(/map[ _-]?(\d+)/i);
    if (m) return "Map " + m[1];
    return "Map " + i;
  }

  function attachRaceBox(session, name, text) {
    try { session.gps = JB4Parse.parseRaceBox(text); session.gpsName = name; }
    catch (e) { alert(`Couldn't read RaceBox file "${name}":\n${e.message}`); return; }
    render();
  }

  function readFile(file, cb) { const r = new FileReader(); r.onload = () => cb(file.name, r.result); r.readAsText(file); }

  /* =========================================================
     COMPUTE (cached per pull)
     ========================================================= */
  function resultFor(session, pullIndex) {
    if (!session.pulls.length) return null;
    const pp = session.pulls[pullIndex];
    const key = `${pullIndex}|${specState.preset}|${JSON.stringify(specState.overrides)}`;
    session._cache = session._cache || {};
    if (session._cache[key]) return session._cache[key];
    const sp = spec();
    const dyno = Dyno.computePull(session.rec, pp.pull, sp);
    const analysis = Analyze.analyzePull(session.rec, pp.pull, dyno, sp);
    const res = { dyno, analysis };
    session._cache[key] = res;
    return res;
  }
  function clearCaches() { sessions.forEach((s) => (s._cache = {})); }

  /* =========================================================
     RENDER
     ========================================================= */
  function render() {
    renderCompare._items = null;
    const main = $("#main");
    main.innerHTML = "";
    main.appendChild(renderUploader());
    main.appendChild(renderSpecsBar());
    if (!sessions.length) { main.appendChild(renderEmpty()); return; }
    main.appendChild(renderSessionList());
    const s = selected();
    if (s) main.appendChild(renderResults(s));
    const cmp = renderCompare();
    if (cmp) main.appendChild(cmp);
    // draw charts after DOM is in place
    requestAnimationFrame(drawAll);
  }

  function renderUploader() {
    const wrap = el("section", "panel uploader");
    wrap.innerHTML = `
      <div class="up-main">
        <div class="up-title">Drop a JB4 datalog to start</div>
        <div class="up-sub">A raw <code>.csv</code> exported from the JB4 Mobile app. Add several (one per map) to compare. Everything stays on your device.</div>
      </div>
      <div class="up-actions">
        <label class="btn btn-primary">Add JB4 log<input id="fileJb4" type="file" accept=".csv,text/csv" multiple hidden></label>
        <button class="btn" id="btnSample">Load sample log</button>
      </div>`;
    wrap.addEventListener("dragover", (e) => { e.preventDefault(); wrap.classList.add("drag"); });
    wrap.addEventListener("dragleave", () => wrap.classList.remove("drag"));
    wrap.addEventListener("drop", (e) => {
      e.preventDefault(); wrap.classList.remove("drag");
      [...e.dataTransfer.files].forEach((f) => readFile(f, addJB4Text));
    });
    wrap.querySelector("#fileJb4").onchange = (e) => { [...e.target.files].forEach((f) => readFile(f, addJB4Text)); e.target.value = ""; };
    wrap.querySelector("#btnSample").onclick = () => addJB4Text("sample-map5.csv", Sample.generate());
    return wrap;
  }

  function renderEmpty() {
    const s = el("section", "panel empty");
    s.innerHTML = `
      <h3>What this does</h3>
      <ul class="empty-list">
        <li><strong>Engine vs wheel HP &amp; torque</strong> — a "virtual dyno" from how fast your car accelerates, so you can see real gains between JB4 maps.</li>
        <li><strong>Splits your log into pulls</strong> automatically — each wide-open run (even across gaps in the log) becomes its own clean graph.</li>
        <li><strong>Wheel-spin detection</strong> — compares how fast the wheels turn vs how fast you actually moved, and tells you when to back off boost.</li>
        <li><strong>Boost, timing &amp; AFR health</strong> — flags under/over boost, timing being pulled (knock), lean AFR and heat soak.</li>
        <li><strong>RaceBox GPS</strong> (optional) — attach a GPS log to see your run on a track map coloured by speed.</li>
      </ul>
      <p class="muted">Pick your car under <strong>Car specs</strong> (BMW 330i 2023 is set by default), then load a log or try the sample.</p>`;
    return s;
  }

  /* ---------- car specs bar + editor ---------- */
  function renderSpecsBar() {
    const bar = el("section", "specs-bar");
    const sp = spec();
    bar.innerHTML = `<div class="specs-summary">
        <span class="specs-icon">🚗</span>
        <div>
          <div class="specs-car">${sp.label}</div>
          <div class="specs-meta">${Math.round(sp.curbLb + sp.driverLb)} lb · ${Math.round(sp.drivetrainLoss * 100)}% drivetrain loss · Cd ${sp.cd} · ${sp.driven} drive</div>
        </div>
      </div>
      <button class="btn" id="btnSpecs">Edit car specs</button>`;
    bar.querySelector("#btnSpecs").onclick = openSpecsModal;
    return bar;
  }

  const SPEC_FIELDS = [
    ["curbLb", "Curb weight (lb)", 1],
    ["driverLb", "Driver + fuel (lb)", 1],
    ["drivetrainLoss", "Drivetrain loss (0–1)", 0.01],
    ["rotatingFactor", "Rotating-mass factor", 0.01],
    ["finalDrive", "Final drive ratio", 0.001],
    ["tireCircM", "Tyre rolling circ (m)", 0.001],
    ["cd", "Drag coefficient Cd", 0.01],
    ["frontalAreaM2", "Frontal area (m²)", 0.01],
    ["crr", "Rolling resistance Crr", 0.001],
    ["airDensity", "Air density (kg/m³)", 0.01],
  ];

  function openSpecsModal() {
    const sp = spec();
    const overlay = el("div", "modal-overlay");
    const presetOpts = Object.entries(CAR_SPECS.PRESETS).map(([k, v]) => `<option value="${k}" ${k === specState.preset ? "selected" : ""}>${v.label}</option>`).join("");
    // Show values at the precision the field actually steps in — the computed
    // tyre circumference is otherwise 2.020695956733857, which reads like a
    // number you're not allowed to touch.
    const dp = (step) => (String(step).includes(".") ? String(step).split(".")[1].length : 0);
    const fieldHtml = SPEC_FIELDS.map(([k, label, step]) =>
      `<div class="fld help-host"><label><span>${label}${Help.icon(k)}</span>` +
      `<input data-k="${k}" type="number" step="${step}" value="${Number(sp[k]).toFixed(dp(step))}"></label></div>`).join("");
    overlay.innerHTML = `<div class="modal">
      <div class="modal-head"><h3>Car specs</h3><button class="icon-btn" id="mClose">✕</button></div>
      <div class="modal-body">
        <label class="fld"><span>Preset</span><select id="mPreset">${presetOpts}</select></label>
        <p class="muted small">Only the numbers that affect a horsepower/traction estimate are here. The dyno prefers your <em>measured</em> speed channel when the log has one, so gear/final-drive mostly matter for the wheel-spin cross-check. Calibrate against a real dyno pull for best accuracy.</p>
        <div class="num-grid">${fieldHtml}</div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="mResetPreset">Reset to preset</button>
        <button class="btn btn-primary" id="mSave">Save</button>
      </div>
    </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector("#mClose").onclick = close;
    overlay.querySelector("#mPreset").onchange = (e) => {
      specState.preset = e.target.value; specState.overrides = {}; saveSpecState(); close(); clearCaches(); render(); openSpecsModal();
    };
    overlay.querySelector("#mResetPreset").onclick = () => { specState.overrides = {}; saveSpecState(); close(); clearCaches(); render(); };
    overlay.querySelector("#mSave").onclick = () => {
      overlay.querySelectorAll("input[data-k]").forEach((inp) => {
        const v = parseFloat(inp.value); if (Number.isFinite(v)) specState.overrides[inp.dataset.k] = v;
      });
      saveSpecState(); close(); clearCaches(); render();
    };
    document.body.appendChild(overlay);
  }

  /* ---------- session list ---------- */
  function renderSessionList() {
    const sec = el("section", "panel");
    sec.appendChild(el("div", "panel-title", "Logs"));
    const list = el("div", "session-list");
    sessions.forEach((s) => {
      const r = s.rec;
      const chans = Object.keys(r.fields).length;
      const active = s.id === selId;
      const card = el("div", "session-card" + (active ? " active" : ""));
      card.innerHTML = `
        <div class="sc-top">
          <button class="sc-name" title="Select">${s.name}</button>
          <button class="icon-btn sc-del" title="Remove">🗑</button>
        </div>
        <div class="sc-meta">
          ${r.hasTimestamp ? `⏱ timestamp OK` : `⚠ no timestamp (assumed 10 Hz)`}
          · ${fmt(r.duration, 1)}s · ${r.sampleHz ? fmt(r.sampleHz, 0) + " Hz" : "—"}
          · ${s.segments.length} segment${s.segments.length > 1 ? "s" : ""}
          · ${s.pulls.length ? `${s.pulls.length} ${KIND_LABEL[s.pullKind]} pull${s.pulls.length === 1 ? "" : "s"}` : "no pulls"} · ${chans} channels
        </div>
        <div class="sc-row">
          <label class="mini">Map/label
            <input class="mini-input sc-map" value="${s.mapLabel}">
          </label>
          ${s.pulls.length ? `<label class="mini">Pull
            <select class="mini-input sc-pull">${s.pulls.map((pp, i) => {
              const rs = Math.round(pp.pull.rpmStart), re = Math.round(pp.pull.rpmEnd);
              const mp = pp.pull.map != null ? `map ${pp.pull.map} · ` : "";
              return `<option value="${i}" ${i === s.sel ? "selected" : ""}>${mp}${Math.round(pp.pull.tStart)}s: ${rs}–${re} rpm (${fmt(pp.pull.secs, 1)}s)</option>`;
            }).join("")}</select></label>` : `<span class="muted small">no rpm climb found — see below</span>`}
          ${mapSummary(s)}
          <label class="mini gps-label">${s.gps ? `🛰 ${s.gpsName} (${s.gps.n} pts)` : "RaceBox GPS"}
            <label class="btn tiny">${s.gps ? "Replace" : "Attach"}<input type="file" accept=".csv" hidden class="sc-gps"></label>
          </label>
        </div>`;
      card.querySelector(".sc-name").onclick = () => { selId = s.id; render(); };
      card.querySelector(".sc-del").onclick = () => { sessions = sessions.filter((x) => x.id !== s.id); if (selId === s.id) selId = sessions[0] ? sessions[0].id : null; render(); };
      card.querySelector(".sc-map").onchange = (e) => { s.mapLabel = e.target.value; render(); };
      const pullSel = card.querySelector(".sc-pull");
      if (pullSel) pullSel.onchange = (e) => { s.sel = parseInt(e.target.value, 10); selId = s.id; render(); };
      card.querySelector(".sc-gps").onchange = (e) => { const f = e.target.files[0]; if (f) readFile(f, (n, t) => attachRaceBox(s, n, t)); e.target.value = ""; };
      list.appendChild(card);
    });
    sec.appendChild(list);
    return sec;
  }

  /* ---------- results for the selected session ---------- */
  function renderResults(s) {
    const sec = el("section", "results");
    if (!s.pulls.length) return renderOverview(s);
    const res = resultFor(s, s.sel);
    const d = res.dyno;
    const partial = s.pullKind !== "wot";
    const note = partial ? " · part-throttle, not a max-power run" : "";

    // KPI row
    // The row, not each tile, is the help host: a tile is only ~190px wide on a
    // phone, so the bubble is appended across the full row instead.
    const kpis = el("div", "kpi-row help-host");
    const kpi = (val, unit, label, sub, help) => `<div class="kpi"><div class="kpi-value">${val}<span class="u"> ${unit}</span></div><div class="kpi-label">${label}${Help.icon(help)}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ""}</div>`;
    kpis.innerHTML =
      kpi(fmt(d.peakWhp.value), "whp", partial ? "Wheel HP (best seen)" : "Peak wheel HP", `@ ${fmt(d.peakWhp.rpm)} rpm${note}`, "peakWhp") +
      kpi(fmt(d.peakEhp.value), "hp", partial ? "Crank HP (best seen)" : "Peak crank HP", `est. at engine`, "peakEhp") +
      kpi(fmt(d.peakTqEngine.value), "lb-ft", partial ? "Torque (best seen)" : "Peak torque", `@ ${fmt(d.peakTqEngine.rpm)} rpm`, "peakTq") +
      kpi(d.hasMeasuredSpeed ? fmt(d.maxSlip) : "—", "%", "Max wheel slip", d.hasMeasuredSpeed ? "vs measured speed" : "no speed channel", "maxSlip");
    sec.appendChild(kpis);

    if (partial) sec.appendChild(renderPartialBanner(s));

    const head = el("div", "results-head");
    head.innerHTML = `<h2>${s.name} · ${s.mapLabel}</h2><div class="muted small">Gear ${d.speed.gear} (${d.speed.source}) · ${d.hasMeasuredSpeed ? "slip check active" : "no slip check"}</div>`;
    sec.appendChild(head);

    // chart cards
    const grid = el("div", "chart-grid");
    grid.appendChild(chartCard("HP · engine vs wheel", "cHp", "Horsepower at the crank and at the wheels across the rev range.", "peakWhp"));
    grid.appendChild(chartCard("Torque · engine vs wheel", "cTq", "Torque (lb-ft). Torque × RPM ÷ 5252 = HP.", "peakTq"));
    if (s.rec.fields.boost) grid.appendChild(chartCard("Boost vs target", "cBoost", "Actual boost against the JB4's own target. Gaps mean a leak or boost control issue.", "boostVsTarget"));
    if (s.rec.fields.avgIgn) grid.appendChild(chartCard("Ignition timing", "cIgn", "Average advance. Sharp drops under boost can mean knock correction.", "timing"));
    if (s.rec.fields.afr) grid.appendChild(chartCard("Air/fuel ratio", "cAfr", "Lower = richer (safer under boost). Leaner than ~12.8 at WOT is worth watching.", "afr"));
    if (d.hasMeasuredSpeed) grid.appendChild(chartCard("Wheel slip", "cSlip", "How much faster the wheels spun than the car actually moved.", "maxSlip"));
    sec.appendChild(grid);

    // GPS track map
    if (s.gps) {
      const card = el("div", "card wide");
      card.innerHTML = `<div class="card-head"><h3>Where you drove (RaceBox GPS)</h3><span class="muted">coloured by speed</span></div><div class="canvas-wrap map-wrap"><canvas id="cTrack"></canvas></div>`;
      sec.appendChild(card);
    }

    sec.appendChild(renderTimeline(s));
    sec.appendChild(renderGuide());

    // recommendations
    const rec = el("div", "panel recs");
    rec.appendChild(el("div", "panel-title", "Recommendations & findings"));
    const ul = el("ul", "insight-list");
    res.analysis.findings.forEach((fnd) => {
      const li = el("li", "insight " + fndClass(fnd.level));
      li.innerHTML = `<div class="ins-title">${icon(fnd.level)} ${fnd.title}</div><div class="ins-detail">${fnd.detail}</div>`;
      ul.appendChild(li);
    });
    rec.appendChild(ul);
    sec.appendChild(rec);
    return sec;
  }

  // Shown when the log had no wide-open run and we fell back to a looser tier.
  // The curves, boost/timing/AFR health and slip are all still meaningful — it's
  // only the headline power number that shouldn't be read as the car's max.
  function renderPartialBanner(s) {
    const p = s.pulls[s.sel].pull;
    const thr = Number.isFinite(p.avgThrottle) ? `${Math.round(p.avgThrottle)}% average ${s.rec.fields.throttle ? "throttle" : "pedal"}` : "no throttle channel logged";
    const light = s.pullKind === "light";
    const b = el("div", "panel notice warn");
    b.innerHTML = `<div class="panel-title">⚠️ ${light ? "No real throttle application in this log" : "Part-throttle pull — power reads low"}</div>
      <p class="muted">Nothing in this log reached wide-open throttle, so the dyno used ${light ? "the strongest RPM climb it could find" : "the best part-throttle pull"} (${thr}, ${Math.round(p.rpmStart)}–${Math.round(p.rpmEnd)} rpm over ${fmt(p.secs, 1)}s).
      <strong>Treat the HP and torque figures as a floor, not your car's peak</strong> — at partial throttle the engine simply isn't making full power.
      The curve shapes, boost vs target, timing, AFR and wheel-slip checks below are still valid for what you drove.</p>
      <p class="muted small">For a proper number: from a roll in 3rd or 4th, floor it from about 2000 rpm to redline in one go, with no shifts or lifts.${s.rec.fields.throttle || s.rec.fields.pedal ? "" : " Also enable throttle/pedal logging in the JB4 app so pulls can be detected properly."}</p>`;
    return b;
  }

  // Last resort: not even a 400 rpm climb anywhere. Rather than a dead end,
  // show the raw log over time plus what the detector actually measured, so
  // it's obvious whether the log is the problem or the channel mapping is.
  function renderOverview(s) {
    const sec = el("section", "results");
    const d = s.diag || JB4Parse.pullDiagnostics(s.rec, s.segments);
    const r = s.rec;
    const thr = Number.isFinite(d.maxThrottle)
      ? `peak ${d.channel} was ${Math.round(d.maxThrottle)}${d.maxThrottle <= 1.5 ? " (0–1 scale?)" : "%"}`
      : "this log has no throttle or pedal channel";

    const p = el("div", "panel notice warn");
    p.innerHTML = `<div class="panel-title">⚠️ No pull to dyno in this log</div>
      <p class="muted">The dyno needs the RPM to climb under throttle. Here the biggest continuous RPM rise was
      <strong>${Math.round(d.biggestRpmRise)} rpm</strong> over ${fmt(d.riseSecs, 1)}s (max ${Math.round(d.maxRpm)} rpm), and ${thr}.
      That reads as cruising or idling rather than a run.</p>
      <p class="muted small">Log again with a wide-open pull — 3rd or 4th gear, floor it from ~2000 rpm to redline without lifting.
      ${d.maxThrottle <= 1.5 && d.channel ? "If your throttle channel really is 0–1 rather than 0–100, that's a scaling quirk worth reporting. " : ""}Everything the log <em>did</em> capture is plotted below.</p>`;
    sec.appendChild(p);

    const head = el("div", "results-head");
    head.innerHTML = `<h2>${s.name} · raw log</h2><div class="muted small">${r.n} rows · ${fmt(r.duration, 1)}s · ${s.segments.length} segment${s.segments.length > 1 ? "s" : ""} · ${Object.keys(r.fields).length} channels</div>`;
    sec.appendChild(head);

    const grid = el("div", "chart-grid");
    OVERVIEW_CHARTS.forEach((c) => { if (overviewSeries(r, c)) grid.appendChild(chartCard(c.title, c.id, c.sub, c.help)); });
    sec.appendChild(grid);

    if (s.gps) {
      const card = el("div", "card wide");
      card.innerHTML = `<div class="card-head"><h3>Where you drove (RaceBox GPS)</h3><span class="muted">coloured by speed</span></div><div class="canvas-wrap map-wrap"><canvas id="cTrack"></canvas></div>`;
      sec.appendChild(card);
    }
    return sec;
  }

  /* ---------- session timeline (whole log, time on x) ---------- */
  // The per-pull charts are all RPM-on-x, which hides anything that only shows
  // up *across* a session: intake temps climbing pull after pull, boost falling
  // off as things heat up, or where the map was switched. This plots the whole
  // log against time with the detected pulls picked out.
  function renderTimeline(s) {
    const r = s.rec;
    const runs = JB4Parse.mapRuns(r);
    const multiMap = runs.length > 1;
    const sec = el("section", "panel timeline");
    const bits = [`${s.pulls.length} pull${s.pulls.length === 1 ? "" : "s"}`];
    if (s.segments.length > 1) bits.push(`${s.segments.length} segments`);
    if (runs.length) bits.push(multiMap ? `maps ${runs.map((m) => m.map).join(" → ")}` : `map ${runs[0].map}`);
    sec.appendChild(el("div", "panel-title", `Session timeline · ${bits.join(" · ")}`));
    sec.appendChild(el("p", "muted small", multiMap
      ? "The whole log against time. Pulls are picked out in colour, and the map changes part-way through — each map's best pull is compared below."
      : "The whole log against time. Pulls are picked out in colour, so you can see how intake temps and boost held up across the session."));

    const grid = el("div", "chart-grid");
    TIMELINE_CHARTS.forEach((c) => {
      if (c.id === "tMap" && !multiMap) return; // only interesting when it changes
      if (overviewSeries(r, c)) grid.appendChild(chartCard(c.title, c.id, c.sub, c.help));
    });
    sec.appendChild(grid);
    return sec;
  }

  const TIMELINE_CHARTS = [
    { fields: ["rpm"], id: "tRpm", title: "RPM & pulls over time", sub: "Whole session; each detected pull highlighted.", color: "#94a3b8", pulls: true, help: "pullKinds" },
    { fields: ["iat"], id: "tIat", title: "Intake air temp over time", sub: "Heat soak — if this climbs pull after pull, later runs lose power.", color: "#dc2626", help: "iat" },
    { fields: ["boost"], id: "tBoost", title: "Boost over time", sub: "Boost consistency across the session.", color: "#2563eb", also: "boostTarget", help: "boostVsTarget" },
    { fields: ["pedal"], id: "tPedal", title: "Pedal vs throttle over time", sub: "Driver demand against throttle-plate angle. On a boosted car the plate stays part-closed at full pedal.", color: "#7c3aed", also: "throttle", help: "pullKinds" },
    { fields: ["afr"], id: "tAfr", title: "AFR over time", sub: "Lower = richer.", color: "#059669", help: "afr" },
    { fields: ["avgIgn"], id: "tIgn", title: "Ignition timing over time", sub: "Average advance across the session.", color: "#d97706", help: "timing" },
    { fields: ["jb4Map"], id: "tMap", title: "JB4 map over time", sub: "Which map was running when.", color: "#0891b2" },
  ];

  // Time-series charts for the no-pull overview (drawn in drawAll). Each entry
  // lists the channels it can use, in preference order.
  const OVERVIEW_CHARTS = [
    { fields: ["rpm"], id: "oRpm", title: "RPM over time", sub: "The whole log. A pull looks like a steep, uninterrupted climb.", color: "#2563eb" },
    { fields: ["throttle", "pedal"], id: "oThr", title: "Throttle over time", sub: "Wide open is ~80–100%. The dyno looks for sustained high throttle.", color: "#7c3aed", help: "pullKinds" },
    { fields: ["boost"], id: "oBoost", title: "Boost over time", sub: "Charge pressure across the log.", color: "#059669" },
    { fields: ["mph"], id: "oMph", title: "Speed over time", sub: "Measured speed channel.", color: "#d97706" },
    { fields: ["avgIgn"], id: "oIgn", title: "Ignition timing over time", sub: "Average advance.", color: "#dc2626", help: "timing" },
    { fields: ["afr"], id: "oAfr", title: "AFR over time", sub: "Lower = richer.", color: "#0891b2", help: "afr" },
  ];
  const overviewSeries = (rec, c) => { for (const f of c.fields) if (rec.fields[f]) return rec.fields[f]; return null; };

  // A collapsed cheat-sheet: is my car healthy, and how do I go faster. The
  // numbers here are the same ones analyze.js tests against, so the guide and
  // the findings above it can't drift apart.
  function renderGuide() {
    const d = el("details", "panel guide");
    d.innerHTML = `<summary><strong>What do these numbers mean?</strong> — health ranges and how to gain power</summary>
      <div class="guide-body">
        <h4>Is the car healthy?</h4>
        <table class="data-table guide-table"><thead><tr><th>What</th><th>Healthy</th><th>If it's not</th></tr></thead><tbody>
          <tr><td class="name">Boost vs target</td><td>within ~1.5 psi</td><td>Leak, loose charge pipe, tired wastegate, or fuelling limits. Smoke-test it.</td></tr>
          <tr><td class="name">Ignition timing</td><td>steady; drops under 3°</td><td>Knock correction — low octane, hot intake air, or too aggressive a map.</td></tr>
          <tr><td class="name">AFR at full throttle</td><td>richer than 12.8 (12.0 on E30+)</td><td>Lean under boost is the expensive one. Check fuel pressure and pump before another pull.</td></tr>
          <tr><td class="name">Intake air temp</td><td>below 50°C / 122°F</td><td>Heat soak. Let it cool between runs; back-to-back pulls always fade.</td></tr>
          <tr><td class="name">Wheel slip</td><td>under 8%</td><td>Power going to smoke. Higher gear, roll in above ~40 mph, or drop a map.</td></tr>
        </tbody></table>
        <h4>How to actually gain power</h4>
        <ol class="guide-list">
          <li><strong>A higher JB4 map</strong> — more boost, the biggest single step. Go up one at a time and log each one.</li>
          <li><strong>Better fuel</strong> — higher octane, or an ethanol blend if your setup supports it. Often worth more than the next map up.</li>
          <li><strong>Cooler intake air</strong> — free power you already own. Watch the intake-temp graph across a session.</li>
          <li><strong>Traction</strong> — if slip is high you're already past what the tyres will take; more boost won't make you faster.</li>
          <li><strong>Hardware</strong> — intake, intercooler, downpipe, turbo. Only after the above are clean.</li>
        </ol>
        <p class="muted small">A gain is real when boost holds steadily, timing stays put and AFR stays rich — all three at once. If more boost brings timing corrections, lean spots or just wheelspin, you've found the limit and the next map up will be slower in the real world.</p>
        <div class="muted small help-host">Every number here is an estimate from your log, not a certified dyno figure. They're at their most useful comparing your own runs against each other. ${Help.icon("virtualDyno")}</div>
      </div>`;
    return d;
  }

  function fndClass(l) { return l === "bad" ? "bad" : l === "warn" ? "warn" : l === "good" ? "good" : "info"; }
  function icon(l) { return l === "bad" ? "⛔" : l === "warn" ? "⚠️" : l === "good" ? "✅" : "ℹ️"; }

  function chartCard(title, id, sub, help) {
    const c = el("div", "card");
    c.innerHTML = `<div class="card-head help-host"><h3>${title}${help ? Help.icon(help) : ""}</h3></div><div class="canvas-wrap"><canvas id="${id}"></canvas></div>${sub ? `<div class="card-foot muted">${sub}</div>` : ""}`;
    return c;
  }

  /* ---------- compare across maps ---------- */
  // Build the comparison entries. A log that switched JB4 maps mid-session is
  // split into one entry per map using the log's own map channel, so a single
  // file can be compared against itself instead of needing one file per map.
  function compareItems() {
    const out = [];
    sessions.filter((s) => s.pulls.length).forEach((s) => {
      const maps = [...new Set(s.pulls.map((pp) => pp.pull.map).filter((m) => m != null))].sort((a, b) => a - b);
      const push = (idx, label) => {
        const r = resultFor(s, idx);
        out.push({ label: s.pullKind === "wot" ? label : `${label} (${KIND_LABEL[s.pullKind]})`,
          name: s.name, dyno: r.dyno, analysis: r.analysis });
      };
      if (maps.length >= 2) {
        maps.forEach((m) => {
          let best = -1, bestSpan = -1;
          s.pulls.forEach((pp, i) => {
            if (pp.pull.map !== m) return;
            const span = pp.pull.rpmEnd - pp.pull.rpmStart;
            if (span > bestSpan) { bestSpan = span; best = i; }
          });
          if (best >= 0) push(best, `Map ${m}`);
        });
      } else {
        // Single map (or none logged): keep the user's editable label.
        push(s.sel, s.mapLabel);
      }
    });
    return out;
  }

  function renderCompare() {
    const items = compareItems();
    if (items.length < 2) return null;
    const cmp = Analyze.compareSessions(items);
    if (!cmp) return null;

    const sec = el("section", "panel compare");
    sec.appendChild(el("div", "panel-title", "Map comparison"));
    const grid = el("div", "chart-grid");
    grid.appendChild(chartCard("Wheel HP by map", "cCmpHp", "Each map's selected pull overlaid — engine gains you can actually feel."));
    grid.appendChild(chartCard("Torque by map", "cCmpTq", "Crank torque across maps."));
    sec.appendChild(grid);

    // table
    const tbl = el("div", "table-wrap");
    tbl.innerHTML = `<table class="data-table"><thead><tr><th>Map</th><th>Peak whp</th><th>Peak crank hp</th><th>Peak tq</th><th>Δ whp</th><th>Slip events</th></tr></thead>
      <tbody>${cmp.rows.slice().reverse().map((r) => `<tr><td class="name">${r.label}</td><td>${fmt(r.whp)}</td><td>${fmt(r.ehp)}</td><td>${fmt(r.tq)}</td><td class="${r.dWhp >= 0 ? "ok" : "bad"}">${r.dWhp >= 0 ? "+" : ""}${fmt(r.dWhp)}</td><td>${r.slipEvents}${r.slipEvents ? ` (${fmt(r.maxSlip)}%)` : ""}</td></tr>`).join("")}</tbody></table>`;
    sec.appendChild(tbl);

    const ul = el("ul", "insight-list");
    cmp.findings.forEach((fnd) => { const li = el("li", "insight " + fndClass(fnd.level)); li.innerHTML = `<div class="ins-title">${icon(fnd.level)} ${fnd.title}</div><div class="ins-detail">${fnd.detail}</div>`; ul.appendChild(li); });
    sec.appendChild(ul);
    renderCompare._items = items;
    return sec;
  }

  // Timeline charts: the full channel against time, plus one extra dataset per
  // detected pull so the runs stand out from the cruising in between.
  function drawTimeline(s) {
    const C = JB4Charts, P = C.pts, r = s.rec, t = r.t;
    const multiMap = JB4Parse.mapRuns(r).length > 1;
    TIMELINE_CHARTS.forEach((c) => {
      if (c.id === "tMap" && !multiMap) return;
      const series = overviewSeries(r, c);
      if (!series) return;
      const ds = [{ label: c.title.replace(" over time", "").replace(" & pulls", ""), points: P(t, series), color: c.color, width: c.pulls ? 1.5 : 2 }];
      const extra = c.also && r.fields[c.also];
      if (extra) ds.push({ label: c.also === "boostTarget" ? "Target" : "Throttle plate", points: P(t, extra), color: "#94a3b8", dash: [6, 4], width: 1.5 });
      if (c.pulls) {
        s.pulls.forEach((pp, i) => {
          const a = pp.pull.start, b = pp.pull.end;
          ds.push({ label: `Pull ${i + 1}${pp.pull.map != null && multiMap ? ` (map ${pp.pull.map})` : ""}`,
            points: P(t.slice(a, b), series.slice(a, b)), color: C.PALETTE[i % C.PALETTE.length], width: 3 });
        });
      }
      C.xyLine(c.id, ds, { xTitle: "seconds", beginAtZero: false });
    });
  }

  /* ---------- draw all charts ---------- */
  function drawAll() {
    const s = selected();
    if (s && s.pulls.length) {
      const res = resultFor(s, s.sel);
      const d = res.dyno, C = JB4Charts, P = C.pts;
      const cv = d.curve;
      C.xyLine("cHp", [
        { label: "Crank HP", points: P(cv.rpm, cv.hpEngine), color: "#2563eb", width: 2.5 },
        { label: "Wheel HP", points: P(cv.rpm, cv.hpWheel), color: "#7c3aed" },
      ], { xTitle: "RPM", yTitle: "Horsepower" });
      C.xyLine("cTq", [
        { label: "Crank torque", points: P(cv.rpm, cv.tqEngine), color: "#059669", width: 2.5 },
        { label: "Wheel torque", points: P(cv.rpm, cv.tqWheel), color: "#d97706" },
      ], { xTitle: "RPM", yTitle: "Torque (lb-ft)" });

      const f = s.rec.fields, a = s.pulls[s.sel].pull.start, b = s.pulls[s.sel].pull.end;
      const rpmSlice = f.rpm.slice(a, b);
      const slc = (arr) => arr.slice(a, b);
      if (f.boost) {
        const ds = [{ label: "Boost", points: P(rpmSlice, slc(f.boost)), color: "#2563eb", width: 2.5 }];
        if (f.boostTarget) ds.push({ label: "Target", points: P(rpmSlice, slc(f.boostTarget)), color: "#94a3b8", dash: [6, 4] });
        C.xyLine("cBoost", ds, { xTitle: "RPM", yTitle: "psi" });
      }
      if (f.avgIgn) C.xyLine("cIgn", [{ label: "Avg timing", points: P(rpmSlice, slc(f.avgIgn)), color: "#d97706", width: 2.5 }], { xTitle: "RPM", yTitle: "° advance", beginAtZero: false });
      if (f.afr) {
        const ds = [{ label: "AFR", points: P(rpmSlice, slc(f.afr)), color: "#059669", width: 2.5 }];
        if (f.afr2) ds.push({ label: "AFR bank 2", points: P(rpmSlice, slc(f.afr2)), color: "#65a30d", dash: [5, 4] });
        C.xyLine("cAfr", ds, { xTitle: "RPM", yTitle: "AFR", beginAtZero: false });
      }
      if (d.hasMeasuredSpeed) C.xyLine("cSlip", [{ label: "Wheel slip %", points: P(rpmSlice, d.per.slip), color: "#dc2626", fill: true, width: 2 }], { xTitle: "RPM", yTitle: "slip %" });
      if (s.gps) C.trackMap("cTrack", s.gps, s.gps.speedMps.map((v) => (Number.isFinite(v) ? v * 2.23694 : NaN)), "mph");
      drawTimeline(s);
    } else if (s) {
      // no-pull overview: raw channels against time
      const C = JB4Charts, P = C.pts;
      OVERVIEW_CHARTS.forEach((c) => {
        const series = overviewSeries(s.rec, c);
        if (series) C.xyLine(c.id, [{ label: c.title.replace(" over time", ""), points: P(s.rec.t, series), color: c.color, width: 2 }],
          { xTitle: "seconds", beginAtZero: false });
      });
      if (s.gps) C.trackMap("cTrack", s.gps, s.gps.speedMps.map((v) => (Number.isFinite(v) ? v * 2.23694 : NaN)), "mph");
    }

    // compare charts
    const items = renderCompare._items;
    if (items && items.length >= 2) {
      const C = JB4Charts, P = C.pts;
      C.xyLine("cCmpHp", items.map((it, i) => ({ label: it.label, points: P(it.dyno.curve.rpm, it.dyno.curve.hpWheel), color: C.PALETTE[i % C.PALETTE.length], width: 2.5 })), { xTitle: "RPM", yTitle: "Wheel HP" });
      C.xyLine("cCmpTq", items.map((it, i) => ({ label: it.label, points: P(it.dyno.curve.rpm, it.dyno.curve.tqEngine), color: C.PALETTE[i % C.PALETTE.length], width: 2.5 })), { xTitle: "RPM", yTitle: "Torque (lb-ft)" });
    }
  }

  /* =========================================================
     INIT
     ========================================================= */
  initTheme();
  Help.install();
  render();
})();
