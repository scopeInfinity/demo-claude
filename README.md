# demo-claude — little tools, no backend

A hub of small, **self-contained** web apps. Each one is a single static
`index.html` (all CSS, JS, and any library inlined — zero external requests)
that runs entirely in your browser and keeps your data on your device.

### 🌐 Live site

**→ https://scopeinfinity.github.io/demo-claude/**

| Project | Live link | What it is |
|---------|-----------|------------|
| 🏎️ JB4 Dyno & Log Analyzer | [Open](https://scopeinfinity.github.io/demo-claude/projects/jb4/) · [source](projects/jb4/) | Turn a raw JB4 datalog into engine-vs-wheel HP & torque, traction analysis, and plain-English tuning tips. |
| 🏥 Hospital Performance Dashboard | [Open](https://scopeinfinity.github.io/demo-claude/projects/hospital/) · [source](projects/hospital/) | Department & clinician performance analytics with a transparent scoring model and automated insights. |

> The site is published by GitHub Pages from the `main` branch (see
> `.github/workflows/static.yml`). If the links 404, enable Pages under
> **Settings → Pages → Build and deployment → Source: GitHub Actions**.

---

## 🏎️ JB4 Dyno & Log Analyzer

The JB4 Mobile app's own graphs are hard to read. This takes the **raw CSV**
you export from it and answers the questions that matter: *am I actually making
more power on a higher map, and am I just spinning the tyres?*

### What it does

- **Engine vs wheel horsepower & torque** — a "virtual dyno" (see the method
  below). Wheel figure from physics; crank figure by adding back drivetrain loss.
- **Splits a log into pulls automatically.** JB4 logs are one long file; a
  session can hold several wide-open runs with idle/rolling gaps between them.
  The tool finds the breaks in the timeline ("disconnected time zones") and each
  wide-open-throttle pull gets its own clean set of graphs.
- **Reads pedal, not just throttle plate.** On a boosted car the DME holds the
  throttle *plate* part-open (30–55%) while your foot is flat on the floor, so
  plate angle makes a real wide-open pull look like part throttle. Pedal
  position — driver demand — is used when the log has it.
- **Only dynos things that are actually pulls.** Each pull is cut at gear
  changes (a shift drops the revs while the car keeps accelerating), and climbs
  where the revs flare without the car speeding up — kickdowns, converter or
  clutch slip — are rejected rather than scored as enormous power.
- **Explains itself.** Every headline number, chart and car-spec field has a
  "?" that says what it is, what a healthy car looks like, and what to do about
  it — plus a guide covering health ranges and how to actually gain power.
  Thresholds in the help are the same ones the analysis tests against, so
  advice and findings can't disagree.
- **Session timeline.** The whole log against time with each pull picked out,
  so you can see intake temps, boost and timing across the session rather than
  only within one pull. Splits by JB4 map when the log records one.
- **Works on part-throttle logs too.** Not every log has a proper wide-open run.
  If there's no WOT pull, the detector relaxes its gates (part-throttle, then
  any sustained RPM climb) and analyses the best pull it can find, clearly
  flagged so the HP figure is read as a floor rather than your car's peak. If
  there's no climb at all, you still get the raw log plotted against time plus
  the numbers that explain *why* nothing was detected.
- **Wheel-spin detection.** It compares how fast the wheels *should* be turning
  (from RPM + gear) against how fast you *actually* moved (speed channel / GPS).
  The gap is slip — power going to smoke, not speed — and it tells you where to
  back off boost or modulate throttle.
- **Health checks + recommendations:** boost vs the JB4's own target (leaks /
  overboost), ignition timing being pulled (possible knock), lean AFR at WOT,
  and intake-air heat soak. All rules-based and on-device.
- **Map-vs-map comparison.** Load one log per JB4 map, label each, and it
  overlays the curves and tables the gains — flagging where extra "power" is
  really just wheelspin.
- **RaceBox GPS (optional).** Attach a RaceBox CSV to see your run drawn on a
  track map coloured by speed. The tool works fully **without** RaceBox; GPS just
  adds the map (and a second speed source).

Pick your car from the **Car specs** presets (BMW 330i 2023, RWD or xDrive, on
Michelin Pilot Sport 4S, is built in) — no need to enter your own car. Only the
parameters that actually affect a horsepower/traction estimate are exposed, and
all are editable so you can calibrate against a real dyno pull.

Click **Load sample log** to see it work immediately with a realistic synthetic
JB4 file (two pulls, one with a deliberate patch of wheel spin).

### Understanding the raw JB4 data format

JB4 datalogs are plain **CSV**. Real-world quirks the parser handles:

- The file usually starts with a **title/notes line** (e.g. `JB4 Android A056…`)
  before the actual column-header row — so the header is detected, not assumed.
- **Column names and order vary** by firmware/app version and platform. Columns
  are mapped to canonical fields by fuzzy-matching their names (case-insensitive),
  so a missing or renamed channel degrades gracefully instead of breaking.
- The **`Timestamp` column is in tenths of a second** (a value of `10` = 1.0 s).
  The tool infers the real unit from the spacing between rows so a 10 Hz log
  (timestamp stepping by 1) isn't mistaken for one-second samples.

Common JB4 channels it reads: `Timestamp, RPM, ECU_PSI, Target, Boost, Pedal,
Throttle, IAT, AVG_IGN, CALC_TORQUE, AFR/AFR2, Gear, Map, MPH, Load, E85, fuel
pressure, coolant/oil temp`. Yes — JB4 logs **do** have a timestamp, which is
what makes pull-splitting reliable.

> `Map` is matched **exactly**, because in engine logs "MAP" usually means
> Manifold Absolute Pressure — a loose pattern would swallow `MAF`/`TMAP`
> columns and corrupt the boost charts.

> Sources for the format & method: [BMW N54 data-logging guide](https://bmwtuning.co/bmw-n54-data-logging-with-jb4/),
> JB4 logging-parameter references, and the "Log Dyno / Virtual Dyno"
> [approach to HP from a datalog](https://www.jb4tech.com/forum/general/market-place-for-sale-trade-wanted/25324-).

### How the horsepower number is worked out (the method)

A chassis dyno measures torque at a roller. From a datalog you instead use
physics: the engine accelerates a **known mass** and overcomes **aero + rolling
drag**. For each moment in a pull:

```
speed v   = RPM · (tyre rolling circ) / (gear · final drive)   [smooth, from RPM]
accel a   = dv/dt
F_total   = m_eff·a  +  ½·ρ·Cd·A·v²  +  Crr·m·g
P_wheel   = F_total · v
P_engine  = P_wheel / (1 − drivetrain_loss)
Torque    = HP · 5252 / RPM
```

Points are binned by RPM and smoothed into the dyno curve. When the log has a
measured speed channel, the tool auto-calibrates the RPM→speed factor from it
(removing tyre/gear guesswork) **and** uses the RPM-vs-measured gap for slip.

**These are estimates** — a virtual dyno typically reads a few percent off a
chassis dyno. Calibrate the car specs (weight, drivetrain loss) against a known
pull to tighten it up.

### Which car-spec numbers matter, and why

| Field | Feeds |
|-------|-------|
| Curb weight + driver/fuel | the `m·a` inertial force (the dominant term) |
| Drivetrain loss | converting wheel HP ↔ crank HP |
| Rotating-mass factor | wheels/drivetrain inertia on the inertial term |
| Tyre rolling circumference | RPM ↔ road speed, and the slip cross-check |
| Gear ratios + final drive | RPM ↔ road speed when there's no speed channel |
| Cd, frontal area, air density | the aerodynamic drag term |
| Rolling resistance (Crr) | the rolling-drag term |

---

## 🏥 Hospital Performance Dashboard

Department & clinician performance analytics for a hospital, with a transparent
**Performance Score (0–100)** blended from case acceptance, surgical success,
workload/volume, report turnaround, and patient satisfaction. An **automated,
rules-based insights** panel writes plain-English findings (top performers, who
needs attention, department gaps). Ships with editable demo data saved in your
browser's `localStorage` — add/edit/delete clinicians and departments, and
export/import JSON backups. Nothing leaves the browser.

Scoring weights live in `src/hospital/js/metrics.js`; insight thresholds in
`src/hospital/js/insights.js`.

---

## Project layout & building

Each project's readable source lives under `src/<project>/`; the deployable
`index.html` files are **generated** from it.

```
index.html                     # generated landing hub  (from src/home/)
projects/hospital/index.html   # generated              (from src/hospital/)
projects/jb4/index.html        # generated              (from src/jb4/)
build.js                       # bundles src/ -> the index.html files
src/
  home/       body.html, style.css
  hospital/   body.html, css/, js/          (scoring, insights, charts, store, app)
  jb4/        body.html, css/, js/          (carspecs, help, parse, dyno, analyze, charts, app, sample)
```

Edit the files under `src/`, then rebuild:

```bash
node build.js      # regenerates every self-contained index.html
```

## Running & deploying

Open any generated `index.html` directly (double-click), or serve the folder:

```bash
python3 -m http.server 8000     # then visit http://localhost:8000
```

Because everything is static, host it anywhere — **GitHub Pages** ("Deploy from
a branch", root folder), Netlify, Cloudflare Pages, Vercel, or an intranet share.

## Tech

Vanilla HTML/CSS/JS + [Chart.js](https://www.chartjs.org/) (vendored locally, no
CDN). No framework, no runtime dependencies, no server.
