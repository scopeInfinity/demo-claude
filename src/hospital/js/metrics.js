/*
 * metrics.js — The scoring engine. Transparent, tunable, no black box.
 *
 * Every derived metric and the composite Performance Score are computed here
 * so a hospital lead can see exactly why someone ranks where they do.
 *
 * Composite score (0–100) is a weighted blend of normalized sub-scores:
 *   Acceptance   25%  – did they take on the cases referred to them?
 *   Surgery      30%  – success rate of procedures performed
 *   Volume       20%  – throughput vs. the busiest peer (workload carried)
 *   Turnaround   10%  – report speed (radiology-relevant; skipped if N/A)
 *   Satisfaction 15%  – patient satisfaction
 * Weights auto-renormalize when a component doesn't apply (e.g. no surgeries).
 */
const Metrics = (() => {
  const WEIGHTS = {
    acceptance: 0.25,
    surgery: 0.30,
    volume: 0.20,
    turnaround: 0.10,
    satisfaction: 0.15,
  };

  function pct(numer, denom) {
    if (!denom) return null;
    return (numer / denom) * 100;
  }

  // Per-employee derived metrics (rates, totals). Volume/turnaround need
  // context (peers), so those normalized scores are added in scoreAll().
  function derive(emp) {
    const totalSurg = (emp.minorSurgeries || 0) + (emp.majorSurgeries || 0);
    const totalOutcomes = (emp.surgerySuccess || 0) + (emp.surgeryFailure || 0);
    return {
      ...emp,
      totalSurgeries: totalSurg,
      totalOutcomes,
      acceptanceRate: pct(emp.casesAccepted, emp.casesReferred), // %
      successRate: pct(emp.surgerySuccess, totalOutcomes),       // % (null if no ops)
      majorShare: pct(emp.majorSurgeries, totalSurg),            // % of ops that are major
    };
  }

  // Given all employees, compute normalized 0–100 sub-scores + composite.
  function scoreAll(employees) {
    const derived = employees.map(derive);
    const maxVolume = Math.max(1, ...derived.map((e) => e.casesAccepted || 0));
    const turnarounds = derived
      .map((e) => e.avgTurnaroundHrs)
      .filter((h) => typeof h === "number" && h > 0);
    const maxTurn = Math.max(1, ...turnarounds);

    return derived.map((e) => {
      const parts = {};
      const w = { ...WEIGHTS };

      parts.acceptance = e.acceptanceRate == null ? null : clamp(e.acceptanceRate);
      parts.surgery = e.successRate == null ? null : clamp(e.successRate);
      parts.volume = clamp(((e.casesAccepted || 0) / maxVolume) * 100);
      // Faster turnaround -> higher score. Only meaningful when reads happen.
      parts.turnaround =
        e.avgTurnaroundHrs && e.avgTurnaroundHrs > 0
          ? clamp(100 - ((e.avgTurnaroundHrs - 0) / maxTurn) * 100 + 0)
          : null;
      parts.satisfaction =
        typeof e.satisfaction === "number" ? clamp((e.satisfaction / 5) * 100) : null;

      // Renormalize weights over the components that actually apply.
      let totalW = 0;
      for (const k of Object.keys(w)) if (parts[k] != null) totalW += w[k];
      let score = 0;
      for (const k of Object.keys(w)) {
        if (parts[k] != null && totalW > 0) score += parts[k] * (w[k] / totalW);
      }

      return { ...e, subScores: parts, score: Math.round(score) };
    });
  }

  function clamp(v) {
    return Math.max(0, Math.min(100, v));
  }

  // Roll employee scores up to a department average + department totals.
  function byDepartment(scored, departments) {
    return departments.map((d) => {
      const members = scored.filter((e) => e.department === d.id);
      const avg = (sel) => {
        const vals = members.map(sel).filter((v) => typeof v === "number");
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };
      const sum = (sel) => members.reduce((a, e) => a + (sel(e) || 0), 0);
      return {
        ...d,
        count: members.length,
        avgScore: members.length ? Math.round(avg((e) => e.score) || 0) : 0,
        acceptanceRate: avg((e) => e.acceptanceRate),
        successRate: avg((e) => e.successRate),
        totalMinor: sum((e) => e.minorSurgeries),
        totalMajor: sum((e) => e.majorSurgeries),
        totalSuccess: sum((e) => e.surgerySuccess),
        totalFailure: sum((e) => e.surgeryFailure),
        totalScans: sum((e) => e.scansReported),
        members,
      };
    });
  }

  // Hospital-wide KPIs.
  function overall(scored) {
    const sum = (sel) => scored.reduce((a, e) => a + (sel(e) || 0), 0);
    const referred = sum((e) => e.casesReferred);
    const accepted = sum((e) => e.casesAccepted);
    const success = sum((e) => e.surgerySuccess);
    const failure = sum((e) => e.surgeryFailure);
    return {
      staff: scored.length,
      acceptanceRate: pct(accepted, referred),
      successRate: pct(success, success + failure),
      totalMinor: sum((e) => e.minorSurgeries),
      totalMajor: sum((e) => e.majorSurgeries),
      totalScans: sum((e) => e.scansReported),
      avgScore: scored.length
        ? Math.round(scored.reduce((a, e) => a + e.score, 0) / scored.length)
        : 0,
    };
  }

  return { derive, scoreAll, byDepartment, overall, WEIGHTS };
})();
