const rules = {
  security: { cap: 60, weights: { critical: 12, high: 8, medium: 3, low: 1 } },
  correctness: { cap: 25, weights: { critical: 10, high: 6, medium: 2, low: 0.5 } },
  maintainability: { cap: 12, weights: { critical: 4, high: 2, medium: 1, low: 0.25 } }
};

export function calculateScore(files) {
  const groups = new Map();
  for (const file of files) {
    for (const finding of file.findings) {
      const category = rules[finding.category] ? finding.category : "correctness";
      const points = rules[category].weights[finding.severity] || 0;
      const key = JSON.stringify([file.path, finding.title, category]);
      const group = groups.get(key);
      if (group) { group.occurrences += 1; group.points = Math.max(group.points, points); }
      else groups.set(key, { path: file.path, title: finding.title, category, points, occurrences: 1 });
    }
  }
  const breakdown = Object.entries(rules).map(([category, rule]) => {
    const items = [...groups.values()].filter((item) => item.category === category);
    return { category, cap: rule.cap, rawPoints: sum(items), deduction: Math.min(rule.cap, sum(items)), items };
  });
  const missingTests = files.some((file) => !file.isTest) && !files.some((file) => file.isTest);
  breakdown.push({ category: "testing", cap: 3, rawPoints: missingTests ? 3 : 0, deduction: missingTests ? 3 : 0, items: [] });
  return {
    score: files.length ? Math.max(0, Math.round(100 - breakdown.reduce((total, item) => total + item.deduction, 0))) : 0,
    scoring: { version: "2", base: 100, breakdown, note: "Repeated occurrences of the same rule in a file are charged once at the highest severity. Category caps prevent style warnings overwhelming the score. Test-file absence costs 3 points total; presence does not measure coverage." }
  };
}

function sum(items) { return items.reduce((total, item) => total + item.points, 0); }
