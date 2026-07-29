/*
 * insights.js — Automated "analyst" that reads the numbers and writes
 * plain-English findings, so the hospital lead doesn't have to evaluate
 * everyone by hand. This is a transparent, rules-based engine (not a remote
 * AI call) so it works offline and its reasoning is auditable. The thresholds
 * below are the "policy" — tune them to your hospital's standards.
 */
const Insights = (() => {
  const T = {
    lowAcceptance: 75,   // % — below this, flag under-utilization / triage issues
    lowSuccess: 88,      // % — below this, flag surgical outcome concern
    highSuccess: 95,     // % — at/above this, praise
    slowTurnaround: 18,  // hrs — above this, flag reporting backlog (radiology)
    lowSatisfaction: 3.8,
    highSatisfaction: 4.5,
    topScore: 85,
    bottomScore: 60,
  };

  function fmt(v, suffix = "") {
    return v == null ? "n/a" : Math.round(v) + suffix;
  }

  // Returns an array of {level, text} findings for the whole hospital.
  function generate(scored, deptRollup, overall) {
    const findings = [];
    const push = (level, text) => findings.push({ level, text });

    // --- Hospital headline ---
    push(
      "info",
      `Across ${overall.staff} clinicians the hospital averages a performance score of ${overall.avgScore}/100, with a ${fmt(overall.acceptanceRate, "%")} case-acceptance rate and a ${fmt(overall.successRate, "%")} surgical success rate (${overall.totalMinor} minor + ${overall.totalMajor} major procedures).`
    );

    // --- Top & bottom performers ---
    const ranked = [...scored].sort((a, b) => b.score - a.score);
    const top = ranked.slice(0, 3);
    const bottom = ranked.slice(-3).reverse();
    if (top.length) {
      push(
        "good",
        `Top performers: ${top.map((e) => `${e.name} (${e.score})`).join(", ")}. Consider them for mentoring, complex caseloads, or recognition.`
      );
    }
    const flagged = bottom.filter((e) => e.score < T.bottomScore);
    if (flagged.length) {
      push(
        "warn",
        `Needs attention: ${flagged.map((e) => `${e.name} (${e.score})`).join(", ")}. See per-clinician flags below before drawing conclusions — a low score can reflect workload mix, not just skill.`
      );
    }

    // --- Per-clinician specific flags ---
    for (const e of scored) {
      const notes = [];
      if (e.acceptanceRate != null && e.acceptanceRate < T.lowAcceptance)
        notes.push(`accepts only ${fmt(e.acceptanceRate, "%")} of referred cases`);
      if (e.successRate != null && e.totalOutcomes >= 10 && e.successRate < T.lowSuccess)
        notes.push(`surgical success ${fmt(e.successRate, "%")} across ${e.totalOutcomes} outcomes`);
      if (e.avgTurnaroundHrs > T.slowTurnaround)
        notes.push(`report turnaround ${e.avgTurnaroundHrs}h`);
      if (typeof e.satisfaction === "number" && e.satisfaction < T.lowSatisfaction)
        notes.push(`patient satisfaction ${e.satisfaction.toFixed(1)}/5`);
      if (notes.length)
        push("warn", `${e.name} (${departmentName(e, deptRollup)}): ${notes.join("; ")}.`);

      const wins = [];
      if (e.successRate != null && e.totalOutcomes >= 10 && e.successRate >= T.highSuccess)
        wins.push(`${fmt(e.successRate, "%")} surgical success`);
      if (typeof e.satisfaction === "number" && e.satisfaction >= T.highSatisfaction)
        wins.push(`${e.satisfaction.toFixed(1)}/5 satisfaction`);
      if (wins.length && e.score >= T.topScore)
        push("good", `${e.name}: ${wins.join(" and ")}.`);
    }

    // --- Department comparison ---
    const deptsWithStaff = deptRollup.filter((d) => d.count > 0);
    if (deptsWithStaff.length) {
      const bestDept = [...deptsWithStaff].sort((a, b) => b.avgScore - a.avgScore)[0];
      const worstDept = [...deptsWithStaff].sort((a, b) => a.avgScore - b.avgScore)[0];
      if (bestDept && worstDept && bestDept.id !== worstDept.id) {
        push(
          "info",
          `Department spread: ${bestDept.name} leads (avg ${bestDept.avgScore}) while ${worstDept.name} trails (avg ${worstDept.avgScore}) — a ${bestDept.avgScore - worstDept.avgScore}-point gap worth a closer look at staffing or case mix.`
        );
      }
    }

    return findings;
  }

  function departmentName(emp, deptRollup) {
    const d = deptRollup.find((x) => x.id === emp.department);
    return d ? d.name : emp.department;
  }

  return { generate, T };
})();
