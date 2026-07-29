/*
 * carspecs.js — Vehicle presets.
 *
 * Only the parameters needed to turn a datalog into horsepower/torque and to
 * reason about traction are stored here. A "virtual dyno" works out force from
 * how fast a known mass accelerates, plus the aero + rolling drag it overcomes,
 * so every field below feeds one of those terms. Everything is editable in the
 * UI — treat these as good starting points, then calibrate against a real dyno
 * pull if you have one.
 *
 * Units: SI internally (kg, metres, m/s). Weights shown to the user in lb.
 */
const CAR_SPECS = (() => {
  const G = 9.80665; // gravity, m/s^2
  const LB_TO_KG = 0.45359237;

  // Rolling circumference from a tyre size string like "225/45R18".
  // Rolling (loaded) circ is ~2.5% less than the free geometric value.
  function tireCirc(widthMm, aspect, rimIn, rollingFactor = 0.975) {
    const dia = rimIn * 25.4 + 2 * widthMm * (aspect / 100); // mm
    return (Math.PI * dia * rollingFactor) / 1000; // metres
  }

  // The BMW 330i (G20, B48 2.0T, ZF 8HP automatic). Two drive types because
  // the driven-wheel setup and drivetrain loss differ. Michelin Pilot Sport 4S
  // in the common square 225/45R18 fitment.
  const ps4s_225_45_18 = tireCirc(225, 45, 18); // ~2.02 m

  const zf8 = { gears: [5.25, 3.36, 2.172, 1.72, 1.316, 1.0, 0.822, 0.64] };

  const PRESETS = {
    "bmw-330i-rwd": {
      label: "BMW 330i 2023 (RWD / sDrive)",
      curbLb: 3582, // BMW G20 330i sDrive curb weight
      driverLb: 165, // default occupant + fuel allowance; user-editable
      drivetrainLoss: 0.15, // RWD ZF8 auto, ~15% crank→wheel
      rotatingFactor: 1.09, // rotating-mass allowance on the inertial term
      tireCircM: ps4s_225_45_18,
      gears: zf8.gears,
      finalDrive: 3.154, // G20 330i final drive (verify against your build)
      cd: 0.26,
      frontalAreaM2: 2.19,
      crr: 0.012, // rolling resistance coefficient
      airDensity: 1.2, // kg/m^3 (~20 °C, sea level)
      redline: 7000,
      ratedHp: 255, // factory crank rating, reference line only
      ratedTq: 295, // lb-ft
      driven: "rear",
    },
    "bmw-330i-xdrive": {
      label: "BMW 330i 2023 (xDrive / AWD)",
      curbLb: 3764,
      driverLb: 165,
      drivetrainLoss: 0.21, // AWD losses are higher
      rotatingFactor: 1.11,
      tireCircM: ps4s_225_45_18,
      gears: zf8.gears,
      finalDrive: 3.154,
      cd: 0.27,
      frontalAreaM2: 2.19,
      crr: 0.012,
      airDensity: 1.2,
      redline: 7000,
      ratedHp: 255,
      ratedTq: 295,
      driven: "all",
    },
    custom: {
      label: "Custom / generic RWD",
      curbLb: 3400,
      driverLb: 165,
      drivetrainLoss: 0.15,
      rotatingFactor: 1.09,
      tireCircM: tireCirc(245, 40, 18),
      gears: zf8.gears,
      finalDrive: 3.15,
      cd: 0.3,
      frontalAreaM2: 2.2,
      crr: 0.012,
      airDensity: 1.2,
      redline: 7000,
      ratedHp: null,
      ratedTq: null,
      driven: "rear",
    },
  };

  const DEFAULT = "bmw-330i-rwd";

  // Total mass the engine has to accelerate, in kg.
  function totalMassKg(spec) {
    return (spec.curbLb + spec.driverLb) * LB_TO_KG;
  }

  return { PRESETS, DEFAULT, G, LB_TO_KG, totalMassKg, tireCirc };
})();
