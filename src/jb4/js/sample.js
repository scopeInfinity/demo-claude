/*
 * sample.js — Generates a realistic-looking raw JB4 CSV so the app is useful
 * with zero setup. It builds two wide-open 4th-gear pulls separated by an idle
 * gap (to exercise segment/pull splitting), with boost/timing/AFR/IAT channels
 * and a deliberate patch of wheel spin in the second pull. Values are physically
 * plausible for a BMW 330i on a JB4, not a real capture.
 */
const Sample = (() => {
  function generate() {
    const HZ = 10;
    const rows = [];
    // JB4 files usually start with a title line, then the column header.
    const header = ["Timestamp", "RPM", "Boost", "Target", "Pedal", "Throttle", "IAT", "AVG_IGN", "CALC_TORQUE", "AFR", "Gear", "MPH"];

    // rpm→speed factor for 4th gear (ZF8 1.72 * final 3.154, tyre circ 2.02 m)
    const k = 2.02 / (60 * 1.72 * 3.154); // m/s per rpm
    const MS_TO_MPH = 2.23694;

    let tenths = 30; // start a little into the log

    function pull(startRpm, endRpm, secs, spin) {
      const n = Math.round(secs * HZ);
      for (let i = 0; i < n; i++) {
        const frac = i / (n - 1);
        const rpm = Math.round(startRpm + (endRpm - startRpm) * Math.pow(frac, 0.92));
        // boost: spools fast then tapers a touch up top
        const boost = +(Math.min(19, 4 + rpm / 260 - Math.max(0, (rpm - 5200) / 900)) ).toFixed(1);
        const target = +(Math.min(19.5, boost + 0.4 + (rpm > 5500 ? 0.6 : 0))).toFixed(1);
        // timing: builds then eases; a small dip mid-pull on the spin run
        let ign = 8 + frac * 6 - (rpm > 5000 ? (rpm - 5000) / 800 : 0);
        const afr = +(11.4 + (rpm > 6000 ? 0.5 : 0) + (Math.random() - 0.5) * 0.15).toFixed(1);
        const iat = Math.round(104 + frac * 10 + Math.random() * 2); // °F
        const tq = Math.round(300 - Math.max(0, (rpm - 5000) / 30));
        // measured speed from rpm; inject slip (car slower than wheels) in a band
        let vMph = rpm * k * MS_TO_MPH;
        if (spin && rpm > 3900 && rpm < 4900) vMph *= 0.82; // ~18% wheel spin
        rows.push([
          tenths, rpm, boost, target, 100, 100, iat, +ign.toFixed(1), tq, afr, 4, Math.round(vMph),
        ]);
        tenths += Math.round(10 / HZ);
      }
    }

    // idle/rolling filler (part throttle) between pulls, so it becomes a gap in
    // "on it" data even though time is continuous...
    function coast(secs, rpm) {
      const n = Math.round(secs * HZ);
      for (let i = 0; i < n; i++) {
        const vMph = rpm * k * MS_TO_MPH;
        rows.push([tenths, rpm, 0.5, 0.5, 8, 6, 100, 12, 40, 14.7, 4, Math.round(vMph)]);
        tenths += Math.round(10 / HZ);
      }
    }

    pull(2100, 6800, 10.5, false); // Pull 1 — clean
    coast(4, 3000);
    // a real "disconnected time zone": jump the clock forward (log paused)
    tenths += 220; // 22 s gap
    pull(2300, 6900, 10.5, true); // Pull 2 — has wheel spin

    const title = "JB4 Android A056 - sample (synthetic, not a real capture)";
    return [title, header.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }
  return { generate };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Sample;
