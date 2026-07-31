/*
 * help.js — Plain-English explanations for every number the tool shows.
 *
 * The app throws a lot of jargon at you: rotating-mass factor, Crr, whp vs
 * crank hp, "timing pulled 4°". Each entry below answers the same three
 * questions — what is this, what does a healthy car look like, and what do I do
 * about it — so nothing on screen is a mystery number.
 *
 * Health thresholds here are deliberately the same ones analyze.js actually
 * tests against, so the advice and the findings can never disagree. If you
 * change a threshold there, change it here too.
 *
 * Rendering: every help entry is reached by a "?" button. Buttons work by tap
 * as well as hover — a lot of this gets read on a phone in a car park, where a
 * `title=` tooltip would be invisible.
 */
const Help = (() => {
  // key -> { title, what, healthy?, tip? }
  const HELP = {
    /* ---------------- headline numbers ---------------- */
    peakWhp: {
      title: "Wheel horsepower",
      what: "Power actually reaching the road, worked out from how hard your car accelerated a known mass against aero and rolling drag. This is the honest number — it's what a rolling-road dyno measures.",
      healthy: "Whatever your car makes on a good pull. What matters is consistency: the same car on the same map should repeat within a few percent, run to run.",
      tip: "It reads low if the car specs are wrong (weight especially), if you weren't at full throttle, or if the wheels were spinning. Fix those before chasing the number.",
    },
    peakEhp: {
      title: "Crank horsepower",
      what: "Wheel horsepower with drivetrain losses added back on, so you can compare against a manufacturer's quoted figure — those are always measured at the engine, before the gearbox and diff take their cut.",
      healthy: "Compare it to your car's factory rating. A healthy stock car lands near it; a tuned one should be clearly above.",
      tip: "This number is only as good as the 'Drivetrain loss' setting — it's a straight division. It does not change what the car actually does; it's wheel horsepower wearing a suit.",
    },
    peakTq: {
      title: "Peak torque",
      what: "The hardest twist the engine produced, in lb-ft. Torque is the shove you feel; horsepower is torque combined with how fast the engine is spinning (hp = torque × rpm ÷ 5252).",
      healthy: "On a turbo car torque should rise quickly and then hold roughly flat across the middle of the rev range. A sharp peak that collapses usually means boost isn't holding.",
      tip: "Torque low down comes from boost arriving early — spool. Up top it's about airflow and fuelling.",
    },
    maxSlip: {
      title: "Wheel slip",
      what: "How much faster the wheels turned than the car actually travelled, comparing engine-RPM-derived speed against your measured speed channel. The gap is rubber going up in smoke instead of into forward motion.",
      healthy: "Under 8% is treated as clean. Above that the power figures in that rev range are optimistic, because some of the acceleration never happened.",
      tip: "Use a higher gear (3rd or 4th), roll into the throttle above about 40 mph, or drop a map level. On a cold or damp surface expect more of it.",
    },

    /* ---------------- health checks ---------------- */
    boostVsTarget: {
      title: "Boost vs target",
      what: "Your actual charge pressure against the boost the JB4 was asking for. The gap between the two is the single most useful health signal on a tuned turbo car.",
      healthy: "Actual should track target within about 1.5 psi through the pull. Consistently more than that under target, or more than 2 psi over, gets flagged.",
      tip: "Falling short usually means a boost leak, a loose charge pipe, a tired wastegate, or fuelling limits pulling it back — a smoke test finds most of it. Overshooting stresses the setup and can trip safeties.",
    },
    timing: {
      title: "Ignition timing",
      what: "How far before top-dead-centre the spark fires, averaged across cylinders. The DME pulls timing back the instant it hears knock, so a sudden drop under boost is the engine protecting itself.",
      healthy: "Steady, or drifting gently. A drop of 3° or more under boost is flagged as a warning; 6° or more is serious.",
      tip: "Usual causes are low octane or stale fuel, hot intake temperatures, or simply too aggressive a map. Try better fuel, let it cool, and drop a map level if it repeats.",
    },
    afr: {
      title: "Air/fuel ratio",
      what: "How much air the engine burned per unit of fuel. Lower numbers are richer — more fuel. Under boost, extra fuel carries heat away and is what keeps pistons intact.",
      healthy: "Richer than about 12.8:1 at full throttle on pump fuel, or 12.0:1 on an E30-plus ethanol blend.",
      tip: "Lean spots under boost are the most expensive fault on this page. Check fuel pressure, pump health and injector condition before another full-throttle run.",
    },
    iat: {
      title: "Intake air temperature",
      what: "How hot the air is by the time it reaches the engine. Hot air is thin air, and the DME also pulls timing to stay safe as it climbs — this is why the fourth pull of the day always feels flat.",
      healthy: "Below 50°C (122°F). Above that it's flagged, and past 65°C (149°F) you're leaving real power on the table.",
      tip: "Let the car cool between runs — a few minutes with the bonnet up on a hot day. Back-to-back pulls will always be slower than the first.",
    },

    /* ---------------- car spec fields ---------------- */
    curbLb: {
      title: "Curb weight",
      what: "What the car weighs empty, with fluids. This feeds the mass × acceleration term, which is the biggest single ingredient in the horsepower estimate.",
      healthy: "Look up the figure for your exact model and drivetrain. A BMW G20 330i sDrive is around 3580 lb.",
      tip: "Get this wrong and everything is wrong by the same proportion — 5% heavy here means roughly 5% too much horsepower reported.",
    },
    driverLb: {
      title: "Driver + fuel",
      what: "You, your passengers, fuel and anything in the boot. Added to curb weight to get the mass the engine actually had to shift.",
      healthy: "Your weight plus roughly 60-90 lb for a half to full tank.",
      tip: "Worth setting honestly — 150 lb on a 3600 lb car is about 4% of the total, and it moves the horsepower figure by about the same.",
    },
    drivetrainLoss: {
      title: "Drivetrain loss",
      what: "The fraction of engine power eaten by the gearbox, driveshaft and diff before it reaches the tyres. Used only to convert wheel horsepower into a crank figure.",
      healthy: "About 0.15 for a rear-drive automatic, around 0.21 for all-wheel drive. Manuals are usually a little lower.",
      tip: "Changing this moves the crank number and nothing else — wheel horsepower, the honest measurement, is untouched. Don't tune it to make the total look nicer.",
    },
    rotatingFactor: {
      title: "Rotating-mass factor",
      what: "An allowance for the fact that the engine also has to spin up wheels, tyres, brake discs and driveshafts — not just push the car forward. Applied as a multiplier on the inertial term.",
      healthy: "Typically 1.05 to 1.15. The 330i preset uses 1.09.",
      tip: "Heavy wheels and tyres push it up. It's a small effect next to weight — leave it alone unless you're chasing the last couple of percent.",
    },
    finalDrive: {
      title: "Final drive ratio",
      what: "The differential's gear ratio, used with the gearbox ratio to turn engine RPM into road speed.",
      healthy: "Stamped on the diff or in the spec sheet — 3.154 on a G20 330i.",
      tip: "Only matters when the log has no speed channel. If yours logs speed, the tool calibrates itself from that and mostly ignores this.",
    },
    tireCircM: {
      title: "Tyre rolling circumference",
      what: "How far the car travels in one wheel rotation, in metres. Converts RPM to road speed, and underpins the wheel-slip cross-check.",
      healthy: "About 2.02 m for a 225/45R18. It's roughly 2.5% less than the tyre's geometric size, because a loaded tyre squashes.",
      tip: "Update it if you change wheel or tyre size — otherwise the speed and slip figures drift.",
    },
    cd: {
      title: "Drag coefficient (Cd)",
      what: "How cleanly the car slips through air. Feeds the aerodynamic drag the engine has to overcome, which grows with the square of speed.",
      healthy: "0.26 for a G20 3-series. Most modern saloons sit between 0.25 and 0.32.",
      tip: "Barely matters below about 60 mph, and matters a lot above 100. Roof boxes and open windows make it worse.",
    },
    frontalAreaM2: {
      title: "Frontal area",
      what: "The size of the hole the car punches through the air, in square metres. Multiplied by Cd for the drag term.",
      healthy: "Around 2.19 m² for a 3-series. Roughly the car's width times its height, times about 0.85.",
      tip: "Same story as Cd — only a high-speed effect. Leave it at the preset unless the car is lifted or lowered a lot.",
    },
    crr: {
      title: "Rolling resistance (Crr)",
      what: "How much the tyres resist rolling, as a fraction of the car's weight. A small, roughly constant drag that's always present.",
      healthy: "About 0.012 for a performance road tyre on tarmac. Softer or underinflated tyres are higher.",
      tip: "The smallest term in the calculation. Correct tyre pressures matter more for grip than they do for this number.",
    },
    airDensity: {
      title: "Air density",
      what: "How thick the air is, in kg per cubic metre. Scales aerodynamic drag, and it's also why the same car makes different power on different days.",
      healthy: "1.2 kg/m³ at about 20°C at sea level. Hot days and altitude both reduce it.",
      tip: "Set it lower if you're logging somewhere high or very hot. It's a small correction for the drag term here — the bigger real-world effect is on the engine itself.",
    },

    /* ---------------- concepts ---------------- */
    virtualDyno: {
      title: "How this works",
      what: "There's no rolling road involved. The tool uses physics: your engine had to accelerate a known mass and overcome aerodynamic and rolling drag, and it knows how quickly the car sped up. Force times speed is power.",
      healthy: "Expect to land within a few percent of a chassis dyno once the car specs are right.",
      tip: "Treat these as estimates with consistent units, not certified figures. They're at their best comparing your own runs against each other.",
    },
    pullKinds: {
      title: "What counts as a pull",
      what: "A dyno pull is one uninterrupted wide-open run in a single gear. The tool finds these automatically, cuts them at gear changes, and rejects rev flares where the car didn't actually speed up — a kickdown, or a slipping converter.",
      healthy: "Third or fourth gear, flat throttle from about 2000 rpm to redline, no shifts and no lifts.",
      tip: "If no wide-open run exists, the tool falls back to the best part-throttle climb and says so — those figures are a floor, not your car's peak.",
    },
    makingPower: {
      title: "How to actually gain power",
      what: "In rough order of how much they matter on a JB4 car: a higher map (more boost), better fuel or a higher ethanol blend, cooler intake air, and then hardware — intake, intercooler, downpipe, turbo.",
      healthy: "A healthy gain shows up as more boost held steadily, timing that stays put, and AFR that stays rich. All three at once means the car is happy with it.",
      tip: "Go up one map at a time and log each. If more boost brings timing corrections, lean spots or just more wheelspin, you've found the limit — the next map up will be slower in the real world, not faster.",
    },
  };

  const icon = (key) =>
    HELP[key] ? `<button type="button" class="help-btn" data-help="${key}" aria-expanded="false" aria-label="Explain: ${HELP[key].title}">?</button>` : "";

  function bubbleFor(key) {
    const h = HELP[key];
    const bub = document.createElement("div");
    bub.className = "help-bubble";
    bub.dataset.key = key;
    bub.innerHTML =
      `<strong>${h.title}</strong><p>${h.what}</p>` +
      (h.healthy ? `<p><span class="help-tag good">Healthy</span>${h.healthy}</p>` : "") +
      (h.tip ? `<p><span class="help-tag">What to do</span>${h.tip}</p>` : "");
    return bub;
  }

  // One delegated listener for the whole page: help buttons come and go with
  // every re-render, so binding them individually would leak handlers.
  function install() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".help-btn");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const host = btn.closest(".help-host") || btn.parentElement;
      const key = btn.dataset.help;
      if (!HELP[key]) return;
      // A host can serve several buttons (the KPI row shares one), so an open
      // bubble for a different field switches rather than just closing.
      const open = host.querySelector(":scope > .help-bubble");
      if (open) {
        const sameField = open.dataset.key === key;
        open.remove();
        host.querySelectorAll(".help-btn[aria-expanded='true']").forEach((b) => b.setAttribute("aria-expanded", "false"));
        if (sameField) return;
      }
      host.appendChild(bubbleFor(key));
      btn.setAttribute("aria-expanded", "true");
    });
  }

  return { HELP, icon, install };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Help;
