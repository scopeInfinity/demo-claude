/*
 * parse.js — Turn raw CSV text (JB4 datalog or RaceBox GPS export) into clean,
 * canonical arrays the rest of the app can use.
 *
 * Why this is defensive: JB4 firmware/app versions differ in exact column names
 * and order, files start with a title/notes line before the real header, and
 * the "Timestamp" column is in tenths of a second (a value of 10 = 1.0 s). So
 * instead of trusting a fixed layout we (1) find the header row, (2) map each
 * column to a canonical field by fuzzy-matching its name, and (3) infer the
 * time units from the actual spacing between rows.
 *
 * Canonical JB4 fields (any missing ones are simply absent):
 *   t (s), rpm, boost, boostTarget, ecuPsi, pedal, throttle, iat, avgIgn,
 *   ignMin, calcTorque, afr, afr2, gear, mph, load, e85, fuelPsi, waterC, oilC
 */
const JB4Parse = (() => {
  // ---- tiny CSV reader (handles quotes, commas, CR/LF) ----
  function splitCSVLine(line) {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  const num = (s) => {
    if (s == null) return NaN;
    const v = parseFloat(String(s).replace(/[^0-9eE.+-]/g, ""));
    return Number.isFinite(v) ? v : NaN;
  };

  // Column-name matchers, tried in order. First regex that hits a header wins
  // that canonical field (and a header is only used once).
  const FIELD_PATTERNS = [
    ["t", /^(time ?stamp|time|secs?|elapsed)$/i],
    ["rpm", /(^rpm$|engine ?rpm|revs)/i],
    ["boostTarget", /(boost ?target|target ?boost|^target$|targ)/i],
    ["ecuPsi", /(ecu[_ ]?psi|dme[_ ]?bt|dme ?boost|requested)/i],
    ["boost", /(^boost$|boost ?psi|^psi$|chargepipe|^cp$)/i],
    ["pedal", /(pedal|accel ?pos|app\b)/i],
    ["throttle", /(throttle|^tps$|tp\b)/i],
    ["iat", /(iat|intake ?air|charge ?temp|^cat$)/i],
    ["avgIgn", /(avg[_ ]?ign|average ?ign|^ign$|ignition ?avg|timing)/i],
    ["ignMin", /(min[_ ]?ign|ign ?min)/i],
    ["calcTorque", /(calc[_ ]?tq|calc[_ ]?torque|torque|^tq$)/i],
    ["afr2", /(afr ?2|afr_2|lambda ?2|afr ?b2)/i],
    ["afr", /(^afr$|afr ?1|air ?fuel|lambda)/i],
    ["gear", /(^gear$|gear ?pos)/i],
    ["mph", /(^mph$|^speed$|vehicle ?speed|veh ?spd)/i],
    ["kph", /(^kph|km ?\/?h|kmh)/i],
    ["load", /(^load$|engine ?load|air ?mass)/i],
    ["e85", /(e85|ethanol|eth ?%)/i],
    ["fuelPsi", /(fuel ?p|fp_|rail ?p|hpfp)/i],
    ["waterC", /(water|coolant|ect)/i],
    ["oilC", /(oil ?temp|^oil$)/i],
  ];

  // Score a row on how many known field-words it contains → find the header.
  function headerScore(cells) {
    let s = 0;
    const joined = cells.join(" ").toLowerCase();
    ["rpm", "boost", "throttle", "pedal", "afr", "ign", "timestamp", "gear", "iat", "load"].forEach((w) => {
      if (joined.includes(w)) s++;
    });
    // must have at least a couple of non-numeric cells to be a header
    const nonNum = cells.filter((c) => c && isNaN(num(c))).length;
    return nonNum >= 3 ? s : 0;
  }

  function findHeader(rows) {
    let best = -1, bestScore = 1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const sc = headerScore(rows[i]);
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    return best;
  }

  function mapColumns(header) {
    const used = new Set();
    const map = {}; // field -> column index
    FIELD_PATTERNS.forEach(([field, re]) => {
      if (map[field] != null) return;
      for (let i = 0; i < header.length; i++) {
        if (used.has(i)) continue;
        if (re.test(header[i])) { map[field] = i; used.add(i); break; }
      }
    });
    return map;
  }

  // Decide the time column's real unit and return seconds-from-start.
  // JB4 "Timestamp" is tenths of a second; other tools log seconds, ms, or
  // unix time. We look at the median step between rows and pick the scale that
  // makes each row land in a sane 5–50 Hz logging window.
  function normalizeTime(rawT) {
    const valid = rawT.filter((v) => Number.isFinite(v));
    if (valid.length < 2) return null;
    const steps = [];
    for (let i = 1; i < rawT.length; i++) {
      const d = rawT[i] - rawT[i - 1];
      if (Number.isFinite(d) && d > 0) steps.push(d);
    }
    if (!steps.length) return null;
    steps.sort((a, b) => a - b);
    const medStep = steps[Math.floor(steps.length / 2)] || 1;

    // Pick the unit scale that turns the typical row-to-row step into a
    // believable datalog rate. JB4 "Timestamp" is tenths of a second, so at
    // 10 Hz the step is exactly 1 — which would look like "1 second" if we
    // trusted the raw number. We instead try each unit (seconds, tenths,
    // hundredths, millis, micros) and take the smallest one whose resulting
    // sample rate lands in a sane 4–200 Hz window.
    const candidates = [1, 10, 100, 1000, 1e6]; // divisor -> seconds
    let scale = 1;
    for (const s of candidates) {
      const rate = s / medStep; // samples per second at this unit
      if (rate >= 4 && rate <= 200) { scale = s; break; }
    }
    const t0 = rawT.find((v) => Number.isFinite(v));
    return { seconds: rawT.map((v) => (Number.isFinite(v) ? (v - t0) / scale : NaN)), scale };
  }

  // ---- main JB4 parse ----
  function parseJB4(text) {
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
    const rows = lines.map(splitCSVLine);
    const hIdx = findHeader(rows);
    if (hIdx < 0) throw new Error("Could not find a JB4/CSV header row (no RPM/Boost/Throttle columns detected).");
    const header = rows[hIdx];
    const map = mapColumns(header);
    if (map.rpm == null) throw new Error("No RPM column found — this doesn't look like an engine datalog.");

    const dataRows = rows.slice(hIdx + 1).filter((r) => r.length >= 2 && Number.isFinite(num(r[map.rpm])));
    const col = (r, field) => (map[field] != null ? num(r[map[field]]) : NaN);

    const rec = {
      header,
      columnMap: map,
      n: dataRows.length,
      fields: {},
    };
    const FIELDS = ["rpm", "boost", "boostTarget", "ecuPsi", "pedal", "throttle", "iat",
      "avgIgn", "ignMin", "calcTorque", "afr", "afr2", "gear", "mph", "kph", "load", "e85", "fuelPsi", "waterC", "oilC"];
    FIELDS.forEach((f) => {
      if (map[f] != null) rec.fields[f] = dataRows.map((r) => col(r, f));
    });

    // time
    let t = null;
    if (map.t != null) {
      const norm = normalizeTime(dataRows.map((r) => col(r, "t")));
      if (norm) { t = norm.seconds; rec.timeScale = norm.scale; }
    }
    if (!t) {
      // no usable timestamp: synthesize at an assumed 10 Hz and flag it
      t = dataRows.map((_, i) => i / 10);
      rec.timeSynthetic = true;
    }
    rec.t = t;
    rec.hasTimestamp = map.t != null && !rec.timeSynthetic;

    // If speed only came as kph, derive mph.
    if (!rec.fields.mph && rec.fields.kph) rec.fields.mph = rec.fields.kph.map((v) => v * 0.621371);

    rec.duration = t[t.length - 1] - t[0];
    rec.sampleHz = rec.n > 1 && rec.duration > 0 ? rec.n / rec.duration : null;
    return rec;
  }

  // Split a parsed record into continuous segments ("disconnected time zones").
  // A break is a backwards jump in time (log restart) or a forward gap much
  // larger than the normal sample spacing.
  function segment(rec, gapSeconds = 2.0) {
    const t = rec.t;
    const dts = [];
    for (let i = 1; i < t.length; i++) dts.push(t[i] - t[i - 1]);
    dts.sort((a, b) => a - b);
    const med = dts.length ? dts[Math.floor(dts.length / 2)] : 0.1;
    const thresh = Math.max(gapSeconds, med * 8);

    const bounds = [];
    let start = 0;
    for (let i = 1; i < t.length; i++) {
      const d = t[i] - t[i - 1];
      if (d < 0 || d > thresh) { bounds.push([start, i]); start = i; }
    }
    bounds.push([start, t.length]);
    return bounds.filter(([a, b]) => b - a >= 3).map(([a, b], i) => ({ index: i, start: a, end: b }));
  }

  // Find wide-open-throttle pulls inside a [start,end) range: throttle/pedal
  // high and RPM climbing over a meaningful span. These are what a dyno cares
  // about; part-throttle cruising in the same segment is ignored.
  function findPulls(rec, seg) {
    const { start, end } = seg;
    const rpm = rec.fields.rpm;
    const wot = rec.fields.throttle || rec.fields.pedal;
    const t = rec.t;
    const pulls = [];
    const WOT = 80; // % considered "on it"
    const MIN_RPM_RISE = 1200;
    const MIN_SECS = 0.8;

    let i = start;
    while (i < end) {
      const onIt = wot ? wot[i] >= WOT : true;
      if (!onIt) { i++; continue; }
      let j = i;
      let lastRise = i;
      while (j + 1 < end) {
        const stillWot = wot ? wot[j + 1] >= WOT - 15 : true;
        const rising = rpm[j + 1] >= rpm[lastRise] - 250; // allow small dips
        if (!stillWot) break;
        if (rpm[j + 1] > rpm[lastRise]) lastRise = j + 1;
        if (!rising && rpm[j + 1] < rpm[lastRise] - 400) break; // clearly done climbing
        j++;
      }
      const rise = rpm[lastRise] - rpm[i];
      const secs = t[j] - t[i];
      if (rise >= MIN_RPM_RISE && secs >= MIN_SECS) {
        pulls.push({ start: i, end: Math.min(j + 1, end), rpmStart: rpm[i], rpmEnd: rpm[lastRise], secs });
        i = j + 1;
      } else {
        i = j > i ? j + 1 : i + 1;
      }
    }
    return pulls;
  }

  // ---- RaceBox GPS export ----
  // RaceBox Mini/Micro CSV columns vary but include latitude, longitude, a
  // speed (km/h) and a timestamp; g-force columns are optional.
  function parseRaceBox(text) {
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
    const rows = lines.map(splitCSVLine);
    // header = first row containing "lat"
    let hIdx = rows.findIndex((r) => r.join(" ").toLowerCase().match(/lat/));
    if (hIdx < 0) throw new Error("No latitude column found — not a RaceBox/GPS CSV.");
    const header = rows[hIdx].map((h) => h.toLowerCase());
    const find = (re) => header.findIndex((h) => re.test(h));
    const idx = {
      lat: find(/lat/),
      lon: find(/(^|[^a-z])(lon|lng|long)/),
      speed: find(/speed/),
      t: find(/(time|utc|timestamp|seconds)/),
      gx: find(/(g-?force ?x|gforcex|accx|long.*g)/),
      gy: find(/(g-?force ?y|gforcey|accy|lat.*g)/),
      alt: find(/(alt|elev|height)/),
    };
    if (idx.lat < 0 || idx.lon < 0) throw new Error("RaceBox CSV missing latitude/longitude.");
    const speedIsKmh = idx.speed >= 0 && /km/.test(header[idx.speed]);

    const data = rows.slice(hIdx + 1).filter((r) => Number.isFinite(num(r[idx.lat])) && Number.isFinite(num(r[idx.lon])));
    const out = { lat: [], lon: [], speedMps: [], t: [], gx: [], gy: [], alt: [] };
    data.forEach((r, i) => {
      out.lat.push(num(r[idx.lat]));
      out.lon.push(num(r[idx.lon]));
      const sp = idx.speed >= 0 ? num(r[idx.speed]) : NaN;
      out.speedMps.push(Number.isFinite(sp) ? (speedIsKmh ? sp / 3.6 : sp) : NaN);
      out.t.push(idx.t >= 0 ? num(r[idx.t]) : i);
      out.gx.push(idx.gx >= 0 ? num(r[idx.gx]) : NaN);
      out.gy.push(idx.gy >= 0 ? num(r[idx.gy]) : NaN);
      out.alt.push(idx.alt >= 0 ? num(r[idx.alt]) : NaN);
    });
    out.n = out.lat.length;
    out.hasSpeed = out.speedMps.some((v) => Number.isFinite(v) && v > 0);
    return out;
  }

  return { parseJB4, parseRaceBox, segment, findPulls, _splitCSVLine: splitCSVLine, _num: num };
})();

if (typeof module !== "undefined" && module.exports) module.exports = JB4Parse; // for node tests
