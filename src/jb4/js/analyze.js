/*
 * analyze.js — Reads a pull the way a tuner would and writes plain-English
 * findings. Everything is rules-based and on-device: no data leaves the browser
 * and every threshold is visible here so you can argue with it.
 *
 * It looks for the things that actually matter on a JB4 car:
 *   • wheel spin (power thrown away, and a signal to back off boost)
 *   • ignition timing being pulled (possible knock)
 *   • boost vs the JB4's own target (leaks / overboost)
 *   • air/fuel ratio safety at wide-open throttle
 *   • intake-air heat soak (why the 4th pull feels down on power)
 */
const Analyze = (() => {
  const { median } = Dyno;

  // JB4 logs IAT in °F on most BMW setups; detect and keep both.
  function iatToC(v) { return v > 80 ? (v - 32) / 1.8 : v; } // >80 => must be °F
  const cToF = (c) => c * 1.8 + 32;

  function runsAbove(series, from, to, thresh, minLen) {
    const runs = [];
    let s = -1;
    for (let i = from; i < to; i++) {
      const on = Number.isFinite(series[i]) && series[i] >= thresh;
      if (on && s < 0) s = i;
      if ((!on || i === to - 1) && s >= 0) {
        const e = on ? i + 1 : i;
        if (e - s >= (minLen || 1)) runs.push([s, e]);
        s = -1;
      }
    }
    return runs;
  }

  function analyzePull(rec, pull, dyno, spec) {
    const f = rec.fields;
    const a = pull.start, b = pull.end;
    const findings = [];
    const add = (level, title, detail) => findings.push({ level, title, detail });
    const metrics = {};

    const rpmAt = (i) => Math.round(rec.fields.rpm[i]);

    // ---- power headline ----
    metrics.peakWhp = dyno.peakWhp;
    metrics.peakEhp = dyno.peakEhp;
    metrics.peakTq = dyno.peakTqEngine;
    metrics.pullKind = pull.kind || "wot";

    // A pull the detector had to relax its throttle gate for can't show peak
    // power — say so before the headline number, so it isn't read as the max.
    if (pull.kind && pull.kind !== "wot") {
      const thr = Number.isFinite(pull.avgThrottle) ? ` (about ${Math.round(pull.avgThrottle)}% average throttle)` : "";
      add("warn", "Part-throttle pull — power is a floor, not a peak",
        `This log had no wide-open run, so the numbers come from the best partial-throttle climb in it${thr}. ` +
        "Real peak power will be higher. Everything else below — boost vs target, timing, AFR and traction — still reflects what you actually drove. " +
        "For a comparable number, do one uninterrupted wide-open pull in 3rd or 4th from ~2000 rpm to redline.");
    }

    if (spec.ratedHp && Number.isFinite(dyno.peakEhp.value)) {
      const partial = pull.kind && pull.kind !== "wot";
      const delta = dyno.peakEhp.value - spec.ratedHp;
      const sign = delta >= 0 ? "+" : "";
      // Only frame it against the factory rating for a real WOT pull — a
      // part-throttle run is always "down on power" and the gap means nothing.
      add("info", `${partial ? "Best seen" : "Peak"} ≈ ${Math.round(dyno.peakWhp.value)} whp / ${Math.round(dyno.peakEhp.value)} crank hp`,
        (partial
          ? `Estimated ${Math.round(dyno.peakEhp.value)} hp at the crank at the throttle you used — not comparable to the ${spec.ratedHp} hp factory rating until you log a wide-open pull. `
          : `Estimated ${Math.round(dyno.peakEhp.value)} hp at the crank vs a factory rating of ${spec.ratedHp} hp (${sign}${Math.round(delta)}). `) +
        `Wheel figure uses a ${Math.round(spec.drivetrainLoss * 100)}% drivetrain loss. Calibrate the car specs against a known dyno pull to tighten this up.`);
    }

    // ---- wheel spin ----
    if (dyno.hasMeasuredSpeed) {
      const slip = dyno.per.slip;
      const SLIP = 8; // %
      const events = runsAbove(slip, 0, slip.length, SLIP, 2).map(([s, e]) => {
        let mx = 0, mxi = s;
        for (let i = s; i < e; i++) if (slip[i] > mx) { mx = slip[i]; mxi = i; }
        return { rpm: rpmAt(a + s), rpmEnd: rpmAt(a + e - 1), atRpm: rpmAt(a + mxi), max: mx,
          boost: f.boost ? f.boost[a + mxi] : null };
      });
      metrics.slipEvents = events;
      if (events.length) {
        const worst = events.reduce((m, e) => (e.max > m.max ? e : m), events[0]);
        add(worst.max > 20 ? "bad" : "warn", `Wheel spin detected (${events.length} event${events.length > 1 ? "s" : ""})`,
          `Wheels spun up to ${worst.max.toFixed(0)}% faster than the car was moving around ${worst.atRpm} rpm` +
          (worst.boost != null ? ` at ${worst.boost.toFixed(1)} psi` : "") +
          `. That power went to smoke, not speed — and the numbers in that rpm band are optimistic. ` +
          `Try a lower boost/JB4 map in this gear, or roll into throttle until you're past ~40 mph. Gear ${dyno.speed.gear} pull.`);
      } else {
        add("good", "Traction looks clean", `No meaningful wheel slip — RPM-derived speed tracked measured speed within ${SLIP}% the whole pull.`);
      }
    } else {
      add("info", "No speed channel for slip check",
        "This log has no MPH/GPS channel, so wheel-spin can't be measured directly. Add a RaceBox GPS log (or enable MPH logging in the JB4 app) to detect slip. Sudden RPM spikes with flat boost can still hint at it.");
    }

    // ---- boost vs target ----
    if (f.boost) {
      const boost = f.boost;
      const peak = Math.max(...boost.slice(a, b).filter(Number.isFinite));
      metrics.peakBoost = peak;
      const tgt = f.boostTarget;
      if (tgt) {
        // compare in the meat of the pull (top 60% of rpm range)
        const rpmLo = rec.fields.rpm[a], rpmHi = dyno.peakWhp.rpm || rec.fields.rpm[b - 1];
        let errSum = 0, c = 0, under = 0;
        for (let i = a; i < b; i++) {
          if (rec.fields.rpm[i] < rpmLo + (rpmHi - rpmLo) * 0.4) continue;
          if (!Number.isFinite(boost[i]) || !Number.isFinite(tgt[i])) continue;
          const err = boost[i] - tgt[i]; errSum += err; c++;
          if (err < -1.5) under++;
        }
        const avgErr = c ? errSum / c : 0;
        metrics.avgBoostErr = avgErr;
        if (under > c * 0.3 && c > 0) {
          add("warn", `Under target boost by ~${Math.abs(avgErr).toFixed(1)} psi`,
            "Actual boost is falling short of the JB4's own target through the pull. Common causes: a boost/vacuum leak, charge-pipe issue, a slipping/soft wastegate, or fuelling limits pulling boost. Worth a smoke test.");
        } else if (avgErr > 2) {
          add("warn", `Overshooting target by ~${avgErr.toFixed(1)} psi`,
            "Boost is running above target — spikes stress the setup and can trip safeties. Check wastegate/boost control and JB4 map choice.");
        } else {
          add("good", `Boost holds target (~${peak.toFixed(1)} psi peak)`, "Actual boost tracks the JB4 target closely through the pull.");
        }
      } else {
        add("info", `Peak boost ${peak.toFixed(1)} psi`, "No boost-target channel in this log to compare against.");
      }
    }

    // ---- ignition timing / knock ----
    if (f.avgIgn) {
      const ign = f.avgIgn, boost = f.boost;
      let worst = 0, worstRpm = null;
      const trail = 6;
      for (let i = a + trail; i < b; i++) {
        if (boost && boost[i] < 2) continue; // only care under boost
        let localMax = -Infinity;
        for (let j = i - trail; j < i; j++) localMax = Math.max(localMax, ign[j]);
        const drop = localMax - ign[i];
        if (drop > worst) { worst = drop; worstRpm = rpmAt(i); }
      }
      metrics.timingPull = worst;
      if (worst >= 3) {
        add(worst >= 6 ? "bad" : "warn", `Timing pulled ${worst.toFixed(1)}° near ${worstRpm} rpm`,
          "A sharp drop in ignition advance under boost usually means the DME is correcting for knock. Check for low octane / bad fuel, high intake temps, or too aggressive a map. If it repeats, drop a map level.");
      } else {
        add("good", "Ignition timing steady", "No significant timing corrections under boost — no obvious knock activity.");
      }
    }

    // ---- AFR at WOT ----
    if (f.afr) {
      const afr = f.afr;
      const e85 = f.e85 ? median(f.e85.slice(a, b)) : 0;
      const wotVals = [];
      for (let i = a; i < b; i++) if (Number.isFinite(afr[i]) && afr[i] > 8 && afr[i] < 20) wotVals.push(afr[i]);
      if (wotVals.length) {
        const leanest = Math.max(...wotVals);
        metrics.leanestAfr = leanest;
        const leanLimit = e85 > 30 ? 12.0 : 12.8; // richer target on ethanol blends
        if (leanest > leanLimit) {
          add("warn", `Lean spots at WOT (${leanest.toFixed(1)} AFR)`,
            `Wide-open AFR touched ${leanest.toFixed(1)} (leaner than ~${leanLimit} is worth watching on ${e85 > 30 ? "an E" + Math.round(e85) + " blend" : "pump gas"}). Lean + boost is where things get hurt — check fuel pressure/pump and octane.`);
        } else {
          add("good", `AFR safe at WOT (${leanest.toFixed(1)})`, "Air/fuel stays on the safe (rich) side through the pull.");
        }
      }
    }

    // ---- intake air temp / heat soak ----
    if (f.iat) {
      const maxIatRaw = Math.max(...f.iat.slice(a, b).filter(Number.isFinite));
      const c = iatToC(maxIatRaw);
      metrics.maxIatC = c;
      if (c >= 50) {
        add(c >= 65 ? "bad" : "warn", `High intake temps (${Math.round(cToF(c))}°F / ${Math.round(c)}°C)`,
          "Hot intake air pulls timing and power and is the usual reason back-to-back pulls fade. Let it cool between runs; on a hot day give it a few minutes.");
      } else {
        add("good", `Intake temps OK (${Math.round(cToF(c))}°F)`, "Charge temps are in a healthy range for consistent power.");
      }
    }

    // sort: bad, warn, good, info
    const order = { bad: 0, warn: 1, good: 2, info: 3 };
    findings.sort((x, y) => order[x.level] - order[y.level]);
    return { findings, metrics };
  }

  // Compare several pulls (typically one per JB4 map) and summarise the gains.
  function compareSessions(items) {
    // items: [{ label, dyno, analysis }]
    const valid = items.filter((it) => it.dyno && Number.isFinite(it.dyno.peakWhp.value));
    if (valid.length < 2) return null;
    const sorted = [...valid].sort((x, y) => x.dyno.peakWhp.value - y.dyno.peakWhp.value);
    const base = sorted[0];
    const rows = sorted.map((it) => ({
      label: it.label,
      whp: it.dyno.peakWhp.value,
      ehp: it.dyno.peakEhp.value,
      tq: it.dyno.peakTqEngine.value,
      dWhp: it.dyno.peakWhp.value - base.dyno.peakWhp.value,
      slipEvents: (it.analysis.metrics.slipEvents || []).length,
      maxSlip: it.dyno.maxSlip,
    }));
    const findings = [];
    const best = rows[rows.length - 1];
    findings.push({ level: "info", title: `${best.label} made the most power (${Math.round(best.whp)} whp)`,
      detail: `That's +${Math.round(best.dWhp)} whp over ${base.label}. Torque peak ${Math.round(best.tq)} lb-ft.` });
    // did more power actually come with more slip (i.e. not usable)?
    const slippy = rows.filter((r) => r.slipEvents > 0);
    if (slippy.length) {
      findings.push({ level: "warn", title: "More boost isn't all reaching the ground",
        detail: `${slippy.map((r) => `${r.label} (${r.slipEvents} slip event${r.slipEvents > 1 ? "s" : ""}, up to ${r.maxSlip.toFixed(0)}%)`).join("; ")}. ` +
          "Where you see slip, the higher-map power number is partly wheelspin, not traction. On these tyres/surface you may be past what you can put down — the next map up may not be faster in the real world until grip improves." });
    }
    return { rows, findings };
  }

  return { analyzePull, compareSessions, iatToC };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Analyze;
