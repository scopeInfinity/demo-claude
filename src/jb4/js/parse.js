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
    // The JB4 map number the car was running. Matched exactly: in engine logs
    // "MAP" more often means Manifold Absolute Pressure, and a loose pattern
    // would also swallow MAF/TMAP columns and corrupt the boost charts.
    ["jb4Map", /^map$/i],
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
      "avgIgn", "ignMin", "calcTorque", "afr", "afr2", "gear", "jb4Map", "mph", "kph", "load", "e85", "fuelPsi", "waterC", "oilC"];
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

  // Find pulls inside a [start,end) range: throttle/pedal high and RPM climbing
  // over a meaningful span. A wide-open run is what the dyno really wants, but
  // plenty of real logs never reach 80% — part-throttle pump runs, short
  // shifts, a pedal channel scaled 0–1 instead of 0–100, or a firmware whose
  // throttle column we didn't recognise. Going blank in those cases is the
  // wrong answer, so we retry with progressively looser gates and tag what we
  // found; the UI caveats the numbers rather than showing nothing.
  const PULL_TIERS = [
    { kind: "wot", wot: 80, hyst: 15, minRise: 1200, minSecs: 0.8 },
    { kind: "partial", wot: 45, hyst: 15, minRise: 700, minSecs: 0.6 },
    { kind: "light", wot: 0, hyst: 0, minRise: 400, minSecs: 0.5 }, // wot:0 = ignore throttle
  ];

  function avgOver(arr, from, to) {
    let s = 0, c = 0;
    for (let i = from; i < to; i++) if (Number.isFinite(arr[i])) { s += arr[i]; c++; }
    return c ? s / c : NaN;
  }
  function maxOver(arr, from = 0, to = arr.length) {
    let m = -Infinity;
    for (let i = from; i < to; i++) if (Number.isFinite(arr[i]) && arr[i] > m) m = arr[i];
    return m === -Infinity ? NaN : m;
  }

  // Which channel means "the driver asked for everything"?
  //
  // Pedal position is the honest answer: on a boosted car the DME deliberately
  // holds the throttle *plate* part-open during a pull — the turbo is doing the
  // work, so the plate sits at 30-55% while the pedal is flat on the floor.
  // Reading plate angle makes a genuine wide-open pull look like part throttle
  // and it never gets detected. So prefer pedal, and fall back to plate angle
  // only when there's no pedal channel or it never rises enough to be usable.
  //
  // Also normalises a 0-1 scaled channel to 0-100 so the percentage gates and
  // the figures shown to the user mean the same thing on every firmware.
  function wotChannel(rec) {
    const pedal = rec.fields.pedal, throttle = rec.fields.throttle;
    const norm = (a, name) => {
      const mx = maxOver(a);
      if (!Number.isFinite(mx)) return null;
      // A channel topping out at ~1 is a fraction, not a percentage.
      return { series: mx <= 1.5 ? a.map((v) => v * 100) : a, name, max: mx <= 1.5 ? mx * 100 : mx };
    };
    const p = pedal ? norm(pedal, "pedal") : null;
    const th = throttle ? norm(throttle, "throttle") : null;
    if (p && (!th || p.max >= 50 || p.max >= th.max)) return p;
    if (th) return th;
    return { series: null, name: null, max: NaN };
  }

  // Contiguous runs of the same JB4 map, so a session that switched maps
  // mid-log can be split and compared without needing one file per map.
  function mapRuns(rec) {
    const m = rec.fields.jb4Map;
    if (!m) return [];
    const runs = [];
    let start = 0;
    for (let i = 1; i <= m.length; i++) {
      const ended = i === m.length || (Number.isFinite(m[i]) && m[i] !== m[start]);
      if (!ended) continue;
      if (i - start >= 3 && Number.isFinite(m[start])) {
        runs.push({ map: m[start], start, end: i, tStart: rec.t[start], tEnd: rec.t[i - 1] });
      }
      start = i;
    }
    return runs;
  }

  function scanPulls(rec, seg, tier) {
    const { start, end } = seg;
    const rpm = rec.fields.rpm;
    const wc = wotChannel(rec);
    const ch = wc.series;
    const t = rec.t;
    const jb4Map = rec.fields.jb4Map;
    // No throttle channel (or the tier ignores it) => every sample counts as
    // "on it" and RPM climb alone decides what's a pull.
    const gated = !!ch && tier.wot > 0;
    const pulls = [];

    // A dyno pull has to be a single gear. Across a shift the RPM drops while
    // the car keeps accelerating, so both the rpm→speed factor and dv/dt become
    // meaningless and the resulting "horsepower" is nonsense. Where the log has
    // a gear channel, end the pull at the shift and let the next gear start a
    // fresh one.
    const gear = rec.fields.gear;
    const gearAt = (k) => (gear && Number.isFinite(gear[k]) && gear[k] > 0 ? Math.round(gear[k]) : null);

    // Within one gear the car's speed rises in step with the revs. When it
    // doesn't, the revs are climbing for some reason other than the car
    // accelerating — a kickdown flares the engine 80% while road speed gains
    // 13%, and a converter/clutch slip does the same. The dyno reads speed from
    // RPM, so it would score that flare as enormous acceleration (we measured
    // 880 whp / 2083 lb-ft from one downshift). Require the measured speed to
    // roughly track the revs before treating a climb as a real pull.
    const mph = rec.fields.mph;
    function speedTracksRpm(from, to) {
      if (!mph) return true; // nothing to cross-check against
      const v0 = mph[from], v1 = mph[to];
      if (!Number.isFinite(v0) || !Number.isFinite(v1) || v0 < 5) return true; // standing start
      const rpmRatio = rpm[to] / rpm[from];
      if (!(rpmRatio > 1.05)) return true;
      return v1 / v0 >= 0.7 * rpmRatio; // allow for wheelspin, reject a flare
    }

    let i = start;
    while (i < end) {
      const onIt = gated ? ch[i] >= tier.wot : true;
      if (!onIt) { i++; continue; }
      let j = i;
      let lastRise = i;
      const g0 = gearAt(i);
      while (j + 1 < end) {
        const stillOn = gated ? ch[j + 1] >= tier.wot - tier.hyst : true;
        const rising = rpm[j + 1] >= rpm[lastRise] - 250; // allow small dips
        const g1 = gearAt(j + 1);
        if (g0 != null && g1 != null && g1 !== g0) break; // shifted — pull ends here
        if (!stillOn) break;
        if (rpm[j + 1] > rpm[lastRise]) lastRise = j + 1;
        if (!rising && rpm[j + 1] < rpm[lastRise] - 400) break; // clearly done climbing
        j++;
      }
      const rise = rpm[lastRise] - rpm[i];
      const secs = t[j] - t[i];
      if (rise >= tier.minRise && secs >= tier.minSecs && speedTracksRpm(i, lastRise)) {
        const stop = Math.min(j + 1, end);
        pulls.push({ start: i, end: stop, rpmStart: rpm[i], rpmEnd: rpm[lastRise], secs,
          kind: tier.kind, avgThrottle: ch ? avgOver(ch, i, stop) : NaN, wotChannel: wc.name,
          map: jb4Map ? Math.round(avgOver(jb4Map, i, stop)) : null, gear: g0,
          tStart: t[i], tEnd: t[stop - 1] });
        i = j + 1;
      } else {
        i = j > i ? j + 1 : i + 1;
      }
    }
    return pulls;
  }

  // Single segment, strictest tier that finds anything.
  function findPulls(rec, seg) {
    for (const tier of PULL_TIERS) {
      const found = scanPulls(rec, seg, tier);
      if (found.length) return found;
    }
    return [];
  }

  // Whole log: pick the tier by looking at every segment together, so one clean
  // WOT run doesn't get buried under "light" cruise sections from elsewhere in
  // the same file. Returns the flat [{seg, pull}] list the UI renders.
  function findPullsAcross(rec, segments) {
    for (const tier of PULL_TIERS) {
      const out = [];
      segments.forEach((seg) => scanPulls(rec, seg, tier).forEach((p) => out.push({ seg: seg.index, pull: p })));
      if (out.length) return { pulls: out, kind: tier.kind };
    }
    return { pulls: [], kind: null };
  }

  // When even the loosest tier finds nothing, report the numbers the gates
  // actually looked at so the UI can say *why* instead of just "no pulls".
  function pullDiagnostics(rec, segments) {
    const rpm = rec.fields.rpm;
    const wc = wotChannel(rec);
    const ch = wc.series;
    const channel = wc.name;
    let bestRise = 0, bestSecs = 0;
    segments.forEach((seg) => {
      let i = seg.start;
      while (i < seg.end) {
        let j = i, lastRise = i;
        while (j + 1 < seg.end && rpm[j + 1] >= rpm[lastRise] - 400) {
          if (rpm[j + 1] > rpm[lastRise]) lastRise = j + 1;
          j++;
        }
        const rise = rpm[lastRise] - rpm[i];
        if (rise > bestRise) { bestRise = rise; bestSecs = rec.t[lastRise] - rec.t[i]; }
        i = j > i ? j + 1 : i + 1;
      }
    });
    return {
      channel,
      maxThrottle: ch ? maxOver(ch) : NaN,
      maxRpm: maxOver(rpm),
      biggestRpmRise: bestRise,
      riseSecs: bestSecs,
    };
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

  return { parseJB4, parseRaceBox, segment, findPulls, findPullsAcross, pullDiagnostics,
    wotChannel, mapRuns, PULL_TIERS, _splitCSVLine: splitCSVLine, _num: num };
})();

if (typeof module !== "undefined" && module.exports) module.exports = JB4Parse; // for node tests
