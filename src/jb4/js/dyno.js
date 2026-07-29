/*
 * dyno.js — The "virtual dyno". Works out horsepower and torque from a pull by
 * the same physics a chassis dyno can't cheat: the engine has to accelerate a
 * known mass and push it through aerodynamic + rolling drag.
 *
 *   F_total = m_eff·a  +  ½·ρ·Cd·A·v²  +  Crr·m·g
 *   P_wheel = F_total · v            (watts)
 *   P_engine = P_wheel / (1 − drivetrain_loss)
 *   Torque(lb-ft) = HP · 5252 / rpm
 *
 * Speed (v) comes from engine RPM scaled by the gear — smooth and dense, which
 * is exactly why log-based dynos use it instead of a coarse speed channel. When
 * a real speed channel (JB4 MPH or RaceBox GPS) exists we ALSO keep it, and the
 * gap between "RPM says this fast" and "GPS says this fast" is wheel slip.
 */
const Dyno = (() => {
  const HP_W = 745.699872; // watts per hp
  const { G, totalMassKg } = CAR_SPECS;

  function movingAvg(a, win) {
    const n = a.length, out = new Array(n);
    const h = Math.max(1, Math.floor(win / 2));
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = i - h; j <= i + h; j++) {
        if (j >= 0 && j < n && Number.isFinite(a[j])) { s += a[j]; c++; }
      }
      out[i] = c ? s / c : a[i];
    }
    return out;
  }

  function median(arr) {
    const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return NaN;
    return v[Math.floor(v.length / 2)];
  }

  // Determine the rpm→wheel-speed factor k, where v(m/s) = rpm·k, plus the
  // gear label. Prefer fitting k from a measured speed channel (auto-calibrates
  // away tyre/gear guesswork); otherwise compute it from the gear + specs.
  function speedFactor(rec, pull, spec, gearOverride) {
    const rpm = rec.fields.rpm;
    const mph = rec.fields.mph;

    // 1) measured-speed fit
    if (mph) {
      const ratios = [];
      for (let i = pull.start; i < pull.end; i++) {
        const v = mph[i] * 0.44704; // m/s
        if (rpm[i] > 1500 && v > 5 && Number.isFinite(v)) ratios.push(v / rpm[i]);
      }
      if (ratios.length >= 5) {
        const k = median(ratios);
        const overall = spec.tireCircM / (60 * k);
        const gearRatio = overall / spec.finalDrive;
        return { k, source: "measured speed", gear: nearestGear(gearRatio, spec), gearRatio };
      }
    }
    // 2) from gear + specs
    let gearIdx = gearOverride;
    if (gearIdx == null && rec.fields.gear) gearIdx = Math.round(median(rec.fields.gear.slice(pull.start, pull.end)));
    if (gearIdx == null || gearIdx < 1 || gearIdx > spec.gears.length) gearIdx = defaultGearGuess(rec, pull, spec);
    const gearRatio = spec.gears[gearIdx - 1];
    const k = spec.tireCircM / (60 * gearRatio * spec.finalDrive);
    return { k, source: "gear + specs", gear: gearIdx, gearRatio };
  }

  function nearestGear(gearRatio, spec) {
    let best = 1, bd = Infinity;
    spec.gears.forEach((g, i) => { const d = Math.abs(g - gearRatio); if (d < bd) { bd = d; best = i + 1; } });
    return best;
  }
  // With no gear info, most WOT pump pulls are done in 3rd or 4th; pick the
  // gear whose top speed comfortably covers the pull's rpm span.
  function defaultGearGuess() { return 4; }

  // Central-difference derivative of a series y over time t.
  function derivative(y, t) {
    const n = y.length, d = new Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - 1), hi = Math.min(n - 1, i + 1);
      const dt = t[hi] - t[lo];
      d[i] = dt > 0 ? (y[hi] - y[lo]) / dt : 0;
    }
    return d;
  }

  // Core: compute the dyno for one pull. Returns per-sample series + a binned,
  // smoothed power/torque curve keyed by rpm.
  function computePull(rec, pull, spec, opts = {}) {
    const mass = totalMassKg(spec);
    const rho = spec.airDensity, cd = spec.cd, A = spec.frontalAreaM2, crr = spec.crr;
    const loss = spec.drivetrainLoss, rotF = spec.rotatingFactor;

    const t = rec.t.slice(pull.start, pull.end);
    let rpm = rec.fields.rpm.slice(pull.start, pull.end);
    rpm = movingAvg(rpm, 5);

    const sf = speedFactor(rec, pull, spec, opts.gear);
    const vWheel = movingAvg(rpm.map((r) => r * sf.k), 5); // m/s, from rpm (no-slip)
    const a = movingAvg(derivative(vWheel, t), 5); // m/s^2

    const mEff = mass * rotF;
    const per = { t, rpm, v: vWheel, a, hpWheel: [], hpEngine: [], tqEngine: [], tqWheel: [], slip: [] };

    // measured speed (for slip) — mph channel; RaceBox handled at session level
    const vMeas = rec.fields.mph ? rec.fields.mph.slice(pull.start, pull.end).map((m) => m * 0.44704) : null;
    const vMeasS = vMeas ? movingAvg(vMeas, 5) : null;

    for (let i = 0; i < rpm.length; i++) {
      const v = vWheel[i];
      const Fi = mEff * a[i];
      const Faero = 0.5 * rho * cd * A * v * v;
      const Froll = crr * mass * G;
      const Ftot = Fi + Faero + Froll;
      const pW = Ftot * v; // watts at the wheels
      const hpW = pW / HP_W;
      const hpE = hpW / (1 - loss);
      per.hpWheel.push(hpW);
      per.hpEngine.push(hpE);
      per.tqEngine.push(rpm[i] > 0 ? (hpE * 5252) / rpm[i] : 0);
      per.tqWheel.push(rpm[i] > 0 ? (hpW * 5252) / rpm[i] : 0);
      if (vMeasS && Number.isFinite(vMeasS[i]) && v > 3) {
        per.slip.push(Math.max(0, (v - vMeasS[i]) / v) * 100); // % faster the wheels spin than the car moves
      } else per.slip.push(NaN);
    }

    // Bin into a clean rpm→curve. Only use accelerating samples (a>0) so engine
    // braking / shift dips don't drag the curve down.
    const bin = 250;
    const bins = {};
    for (let i = 0; i < rpm.length; i++) {
      if (a[i] <= 0.05) continue;
      const b = Math.round(rpm[i] / bin) * bin;
      (bins[b] || (bins[b] = { hpW: [], hpE: [], tqE: [], tqW: [] }));
      bins[b].hpW.push(per.hpWheel[i]);
      bins[b].hpE.push(per.hpEngine[i]);
      bins[b].tqE.push(per.tqEngine[i]);
      bins[b].tqW.push(per.tqWheel[i]);
    }
    const rpmBins = Object.keys(bins).map(Number).sort((x, y) => x - y);
    const curve = {
      rpm: rpmBins,
      hpWheel: rpmBins.map((r) => median(bins[r].hpW)),
      hpEngine: rpmBins.map((r) => median(bins[r].hpE)),
      tqEngine: rpmBins.map((r) => median(bins[r].tqE)),
      tqWheel: rpmBins.map((r) => median(bins[r].tqW)),
    };
    // light smoothing of the curve
    ["hpWheel", "hpEngine", "tqEngine", "tqWheel"].forEach((k) => (curve[k] = movingAvg(curve[k], 3)));

    const peakAt = (ys, xs) => {
      let bi = 0; for (let i = 1; i < ys.length; i++) if (ys[i] > ys[bi]) bi = i;
      return ys.length ? { value: ys[bi], rpm: xs[bi] } : { value: NaN, rpm: NaN };
    };

    return {
      pull, per, curve, speed: sf,
      peakWhp: peakAt(curve.hpWheel, curve.rpm),
      peakEhp: peakAt(curve.hpEngine, curve.rpm),
      peakTqEngine: peakAt(curve.tqEngine, curve.rpm),
      maxSlip: Math.max(0, ...per.slip.filter(Number.isFinite)),
      hasMeasuredSpeed: !!vMeasS,
    };
  }

  return { computePull, movingAvg, median };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Dyno;
