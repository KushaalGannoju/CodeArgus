export function flattenFindings(review) {
  return review.files.flatMap((file) => file.findings.map((finding) => ({ ...finding, path: file.path, language: file.language })));
}

export function compareReviews(baseline, current) {
  if (baseline.repository.url.toLowerCase() !== current.repository.url.toLowerCase()) throw new Error("Choose reviews of the same repository.");
  // Ignore line shifts, but retain duplicate occurrences using multiset matching.
  const key = (finding) => JSON.stringify([finding.path, finding.title, finding.category, finding.severity]);
  const before = flattenFindings(baseline);
  const remaining = [...flattenFindings(current)];
  const resolved = [];
  const unchanged = [];
  for (const finding of before) {
    const index = remaining.findIndex((candidate) => key(candidate) === key(finding));
    if (index < 0) resolved.push(finding);
    else unchanged.push(remaining.splice(index, 1)[0]);
  }
  return { resolved, unchanged, introduced: remaining, scoreDelta: current.summary.score - baseline.summary.score };
}

export function sourceLink(review, path, line = 1) {
  if (review.example || !/^[a-f0-9]{40}$/i.test(review.repository.commitSha || "")) return null;
  const url = new URL(review.repository.url);
  if (url.origin !== "https://github.com") return null;
  return `${url.href.replace(/\/$/, "")}/blob/${review.repository.commitSha}/${path.split("/").map(encodeURIComponent).join("/")}#L${Math.max(1, Number(line) || 1)}`;
}

export function createExampleReview() {
  const findings = [{ title: "Unsafe dynamic code execution", severity: "critical", category: "security", line: 8, message: "eval runs a submitted expression as code. An untrusted expression can access application data or execute commands.", recommendation: "Replace eval with a parser that accepts only the operations your calculator supports." },
    { title: "Broad exception handler", severity: "low", category: "maintainability", line: 12, message: "Catching every exception hides programming errors alongside invalid input.", recommendation: "Catch expected parsing errors and let unexpected failures reach your error handler." }];
  return {
    id: "codeargus-example", example: true, reviewedAt: "2026-11-01T12:00:00Z",
    repository: { owner: "example", name: "student-calculator", url: "https://github.com/example/student-calculator" },
    summary: { score: 84, filesReviewed: 1, findingsCount: 2, testsDetected: 0, languages: { Python: 1 }, severity: { critical: 1, high: 0, medium: 0, low: 1 } },
    files: [{ path: "calculator.py", language: "Python", loc: 18, findings, functions: [], summary: { purpose: "Evaluate arithmetic expressions" } }],
    narrative: { providerLabel: "Illustrative example", overview: "This example calculator has a small, readable structure, but its input handling needs attention before sharing it with others. The main risk is eval: a submitted expression is treated as executable Python rather than arithmetic data. Restricting the UI input alone would not address this because callers can bypass the browser. Replace the execution path with a restricted expression parser, then test allowed operations, malformed expressions, and attempts to access names or functions. The broad exception handler also makes debugging harder by returning the same result for unrelated failures. No test files appear in this example review, so the score should be treated as a limited static signal rather than evidence that the application is safe.", priorities: [{ ...findings[0], detail: "Remove dynamic execution before accepting untrusted expressions." }], nextSteps: ["Replace eval with restricted arithmetic parsing.", "Test invalid input and disallowed operations.", "Catch specific parsing exceptions."] },
    insights: { complexityHotspots: [] }, scope: { skipped: [{ path: "README.md", reason: "Unsupported file type" }] },
    testSuggestions: [{ title: "Test calculator input", description: "Cover division by zero, empty input, malformed expressions, and disallowed names." }],
    generatedTests: [{ title: "Parser test starter (adapt before running)", file: "calculator.py", framework: "pytest", code: "import pytest\n\n@pytest.mark.skip(reason='Import your restricted parser and implement assertions first')\ndef test_rejects_disallowed_names():\n    raise NotImplementedError\n" }],
    quiz: [{ question: "Why does restricting a text field fail to make eval safe?", answerHint: "A caller can send requests without using your interface. Validation must happen at the execution boundary." }],
    reportMarkdown: "# CodeArgus example review\n\nIllustrative fixture, not a live repository analysis.\n\nHeuristic score: 84/100\nFiles reviewed: 1\nFindings: 2\n\n## Priorities\n- CRITICAL: Replace eval in calculator.py:8.\n- LOW: Narrow the exception handler in calculator.py:12.\n\n## Testing\nCover invalid expressions and disallowed operations."
  };
}
