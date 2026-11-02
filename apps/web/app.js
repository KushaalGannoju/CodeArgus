import { compareReviews, createExampleReview, flattenFindings, sourceLink } from "./reviewTools.js";

const reviewForm = document.querySelector("#reviewForm");
const reviewButton = document.querySelector("#reviewButton");
const statusText = document.querySelector("#statusText");
const severityFilter = document.querySelector("#severityFilter");

const scoreValue = document.querySelector("#scoreValue");
const scoreMeta = document.querySelector("#scoreMeta");
const filesMetric = document.querySelector("#filesMetric");
const findingsMetric = document.querySelector("#findingsMetric");
const highMetric = document.querySelector("#highMetric");
const testsMetric = document.querySelector("#testsMetric");
const reviewsLeft = document.querySelector("#reviewsLeft");
const aiLeft = document.querySelector("#aiLeft");
const tokensLeft = document.querySelector("#tokensLeft");
const providerBadge = document.querySelector("#providerBadge");
const reviewOverview = document.querySelector("#reviewOverview");
const priorityList = document.querySelector("#priorityList");
const nextStepsList = document.querySelector("#nextStepsList");

const findingsList = document.querySelector("#findingsList");
const languageList = document.querySelector("#languageList");
const testsList = document.querySelector("#testsList");
const hotspotsList = document.querySelector("#hotspotsList");
const generatedTestsList = document.querySelector("#generatedTestsList");
const quizList = document.querySelector("#quizList");
const reportMarkdown = document.querySelector("#reportMarkdown");
const tabButtons = document.querySelectorAll(".tab-button");
const reviewSections = document.querySelectorAll(".review-section");

const apiBaseUrl = normalizeApiBaseUrl(
  new URLSearchParams(window.location.search).get("api") ||
    window.CODE_REVIEW_CONFIG?.apiBaseUrl ||
    localStorage.getItem("codeReviewApiBaseUrl") ||
    ""
);

const sessionId = getOrCreateSessionId();
let latestReview = null;
let busy = false;
let connectionRequest = null;
let history = readHistory();
const $ = (selector) => document.querySelector(selector);

if (apiBaseUrl) {
  localStorage.setItem("codeReviewApiBaseUrl", apiBaseUrl);
}

loadLimits();
renderHistory();
$("#retryConnection").addEventListener("click", () => loadLimits());
$("#sampleButton").addEventListener("click", () => {
  if (busy) return;
  latestReview = createExampleReview();
  renderReview(latestReview);
  statusText.textContent = "Illustrative example. No repository was fetched and no AI budget was used.";
});
$("#findingSearch").addEventListener("input", () => latestReview && renderFindings(latestReview));
$("#historySelect").addEventListener("change", (event) => {
  const saved = history.find((item) => item.id === event.target.value);
  if (saved && !busy) { latestReview = saved; renderReview(saved); statusText.textContent = "Saved review restored from this browser."; }
});
$("#clearHistory").addEventListener("click", () => {
  history = [];
  try { localStorage.removeItem("codeargusHistory"); } catch { /* Storage may be unavailable. */ }
  renderHistory();
  if (latestReview) renderComparisonOptions();
});
$("#baselineSelect").addEventListener("change", renderComparison);
$("#downloadMarkdown").addEventListener("click", () => downloadReport("md"));
$("#downloadJson").addEventListener("click", () => downloadReport("json"));
$("#copyReport").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(exportMarkdown(latestReview)); statusText.textContent = "Summary copied."; }
  catch { statusText.textContent = "Clipboard unavailable. Download the Markdown report instead."; }
});

reviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(reviewForm);
  const repoUrl = String(formData.get("repoUrl") || "").trim();

  setLoading(true, "Connecting to the review service...");
  try {
    if (!await loadLimits()) throw new Error("The backend is unavailable. Retry the connection, then submit again.");
    const response = await fetch(`${apiBaseUrl}/api/reviews`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/x-ndjson",
        "X-Review-Session": sessionId
      },
      body: JSON.stringify({ repoUrl, useGemini: true }),
      signal: AbortSignal.timeout(180000)
    });

    const payload = response.headers.get("content-type")?.includes("application/x-ndjson")
      ? await readReviewStream(response) : await readJsonResponse(response);
    updateLimits(payload.limits);
    if (!response.ok || payload.error) {
      throw new Error(payload.error || "Review failed.");
    }

    latestReview = payload.review;
    const saved = saveReview(latestReview);
    renderReview(latestReview);
    statusText.textContent = reviewStatus(latestReview) + (saved ? "" : " Browser storage is unavailable or full; download the report to keep it.");
  } catch (error) {
    statusText.textContent = error.name === "TimeoutError" ? "The request timed out. The server may still finish this review; check your connection before trying again." : error.message;
  } finally {
    setLoading(false);
  }
});

severityFilter.addEventListener("change", () => {
  if (latestReview) {
    renderFindings(latestReview);
  }
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.target;
    tabButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    reviewSections.forEach((section) => section.classList.toggle("is-active", section.id === target));
  });
});

async function loadLimits() {
  if (connectionRequest) return connectionRequest;
  connectionRequest = checkConnection();
  try { return await connectionRequest; } finally { connectionRequest = null; }
}

async function checkConnection() {
  $("#connectionStatus").textContent = "Connecting";
  $("#retryConnection").disabled = true;
  const wakeTimer = setTimeout(() => {
    $("#connectionStatus").textContent = "Waking backend";
    statusText.textContent = "The free backend may be waking up. This can take about a minute.";
  }, 3000);
  try {
    const response = await fetch(`${apiBaseUrl}/api/limits`, {
      headers: { "X-Review-Session": sessionId }, signal: AbortSignal.timeout(90000)
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error("Backend unavailable");
    updateLimits(payload.limits);
    $("#connectionStatus").textContent = "Backend online";
    if (!busy) statusText.textContent = "Ready for a public repository.";
    return true;
  } catch {
    updateLimits();
    $("#connectionStatus").textContent = "Backend offline";
    if (!busy) statusText.textContent = "Could not connect. Retry the connection or open the example review.";
    return false;
  } finally {
    clearTimeout(wakeTimer);
    $("#retryConnection").disabled = false;
  }
}

function setLoading(isLoading, message = "") {
  busy = isLoading;
  reviewButton.disabled = isLoading;
  $("#sampleButton").disabled = isLoading;
  $("#historySelect").disabled = isLoading;
  reviewButton.querySelector("span:last-child").textContent = isLoading ? "Reviewing" : "Review";
  if (message) {
    statusText.textContent = message;
  }
}

function renderReview(review) {
  $("#results").hidden = false;
  $("#repositoryMeta").textContent = `${review.example ? "EXAMPLE / " : ""}${review.repository.owner}/${review.repository.name} / ${review.repository.commitSha?.slice(0, 12) || (review.example ? "illustrative fixture" : "commit not recorded")} / ${new Date(review.reviewedAt).toLocaleString()}`;
  scoreValue.textContent = review.files.length ? review.summary.score : "\u2014";
  scoreMeta.textContent = !review.files.length ? "No supported files" : review.summary.severity.critical ? "Critical findings" : review.summary.severity.high ? "High-risk findings" : qualityLabel(review.summary.score);
  filesMetric.textContent = review.summary.filesReviewed;
  findingsMetric.textContent = review.summary.findingsCount;
  highMetric.textContent = review.summary.severity.critical + review.summary.severity.high;
  testsMetric.textContent = review.summary.testsDetected;
  providerBadge.textContent = review.narrative.providerLabel;
  reviewOverview.textContent = review.narrative.overview;

  renderPriorities(review.narrative.priorities);
  renderNextSteps(review.narrative.nextSteps);
  renderFindings(review);
  renderLanguages(review.summary.languages);
  renderTests(review.testSuggestions);
  renderHotspots(review.insights?.complexityHotspots || []);
  renderGeneratedTests(review.generatedTests || []);
  renderQuiz(review.quiz);
  reportMarkdown.textContent = review.reportMarkdown || "No markdown report generated.";
  renderScope(review);
  renderComparisonOptions();
}

function renderNextSteps(steps = []) {
  nextStepsList.innerHTML = steps.length
    ? `<span class="next-label">Next steps</span><div class="next-step-list">${steps
        .slice(0, 4)
        .map((step) => `<strong>${escapeHtml(step)}</strong>`)
        .join("")}</div>`
    : "";
}

function renderPriorities(priorities = []) {
  priorityList.innerHTML = priorities
    .slice(0, 4)
    .map(
      (priority) => `
        <article class="priority-item">
          <span class="priority-dot ${priority.severity || "medium"}"></span>
          <div>
            <strong>${escapeHtml(priority.title)}</strong>
            <p>${escapeHtml(priority.detail)}</p>
          </div>
        </article>
      `
    )
    .join("");
}

function renderFindings(review) {
  const severity = severityFilter.value;
  const query = $("#findingSearch").value.toLowerCase().trim();
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const findings = flattenFindings(review)
    .filter((finding) => (severity === "all" || finding.severity === severity) &&
      `${finding.path} ${finding.title} ${finding.message} ${finding.category} ${finding.recommendation}`.toLowerCase().includes(query))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
  $("#severityCounts").innerHTML = Object.entries(review.summary.severity).map(([level, count]) => `<span class="badge ${level}">${escapeHtml(level)} ${count}</span>`).join("");

  if (findings.length === 0) {
    findingsList.className = "findings-list empty-state";
    findingsList.textContent = "No findings match the current filter.";
    return;
  }

  findingsList.className = "findings-list";
  findingsList.innerHTML = findings
    .map(
      (finding) => `
        <article class="finding">
          <div class="finding-header">
            <div>
              <p class="finding-title">${escapeHtml(finding.title)}</p>
              <div class="finding-path">${fileReference(review, finding.path, finding.line)}</div>
            </div>
            <span class="badge ${finding.severity}">${escapeHtml(finding.severity)}</span>
          </div>
          <div class="badge-row">
            <span class="badge">${escapeHtml(finding.category)}</span>
            <span class="badge">${escapeHtml(finding.language)}</span>
          </div>
          <p class="finding-copy">${escapeHtml(finding.message)}</p>
          <p class="finding-copy"><strong>Fix:</strong> ${escapeHtml(finding.recommendation)}</p>
        </article>
      `
    )
    .join("");
}

function renderLanguages(languages) {
  const entries = Object.entries(languages);
  if (entries.length === 0) {
    languageList.className = "compact-list empty-state";
    languageList.textContent = "No repository analyzed.";
    return;
  }

  languageList.className = "compact-list";
  languageList.innerHTML = entries
    .map(
      ([language, count]) => `
        <div class="compact-item">
          <strong>${escapeHtml(language)}</strong>
          <span>${count} supported file${count === 1 ? "" : "s"}</span>
        </div>
      `
    )
    .join("");
}

function renderTests(suggestions) {
  if (!suggestions.length) {
    testsList.className = "compact-list empty-state";
    testsList.textContent = "No missing-test signals found.";
    return;
  }

  testsList.className = "compact-list";
  testsList.innerHTML = suggestions
    .slice(0, 6)
    .map(
      (suggestion) => `
        <div class="compact-item">
          <strong>${escapeHtml(suggestion.title)}</strong>
          <p>${escapeHtml(suggestion.description)}</p>
        </div>
      `
    )
    .join("");
}

function renderHotspots(hotspots) {
  if (!hotspots.length) {
    hotspotsList.className = "compact-list empty-state";
    hotspotsList.textContent = "No complexity hotspots detected.";
    return;
  }
  hotspotsList.className = "compact-list";
  hotspotsList.innerHTML = hotspots
    .slice(0, 5)
    .map(
      (item) => `
        <div class="compact-item">
          <strong>${escapeHtml(item.name)} (${escapeHtml(item.label)})</strong>
          <p>${escapeHtml(item.file)}:${item.line} · complexity ${item.complexity}</p>
        </div>
      `
    )
    .join("");
}

function renderGeneratedTests(tests) {
  if (!tests.length) {
    generatedTestsList.className = "compact-list empty-state";
    generatedTestsList.textContent = "No generated test starters yet.";
    return;
  }
  generatedTestsList.className = "compact-list";
  generatedTestsList.innerHTML = tests
    .slice(0, 3)
    .map(
      (test) => `
        <div class="compact-item">
          <strong>${escapeHtml(test.title)}</strong>
          <p>${escapeHtml(test.framework)} · ${escapeHtml(test.file)}</p>
          <pre class="code-snippet">${escapeHtml(test.code)}</pre>
        </div>
      `
    )
    .join("");
}

function renderQuiz(questions) {
  if (!questions.length) {
    quizList.className = "compact-list empty-state";
    quizList.textContent = "No questions yet.";
    return;
  }

  quizList.className = "compact-list";
  quizList.innerHTML = questions
    .slice(0, 5)
    .map(
      (question) => `
        <div class="compact-item">
          <strong>${escapeHtml(question.question)}</strong>
          <span>${escapeHtml(question.answerHint)}</span>
        </div>
      `
    )
    .join("");
}

function updateLimits(limits = {}) {
  reviewsLeft.textContent = limits.reviewsRemaining ?? "\u2014";
  aiLeft.textContent = limits.geminiRemaining ?? "\u2014";
  tokensLeft.textContent = limits.tokensRemaining == null ? "\u2014" : compactNumber(limits.tokensRemaining);
}

function qualityLabel(score) {
  if (score >= 85) return "Strong";
  if (score >= 70) return "Healthy";
  if (score >= 50) return "Needs work";
  return "High risk";
}

function getOrCreateSessionId() {
  const existing = localStorage.getItem("codeReviewSessionId");
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem("codeReviewSessionId", next);
  return next;
}

function normalizeApiBaseUrl(value) {
  return String(value || "").replace(/\/$/, "");
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(
      response.ok
        ? "The server returned an empty response."
        : `The backend returned ${response.status}. Check the backend logs and frontend API URL.`
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `The backend is waking or unavailable (${response.status}). Retry the connection before submitting again.`
    );
  }
}

function reviewStatus(review) {
  const base = `Reviewed ${review.repository.name} in ${review.durationMs} ms.`;
  if (review.ai?.used) return `${base} Gemini wrote the reviewer notes.`;
  if (review.ai?.skippedReason) return `${base} Static mode: ${review.ai.skippedReason}`;
  return base;
}

function compactNumber(value) {
  const number = Number(value);
  if (number >= 1000) return `${Math.floor(number / 1000)}k`;
  return String(number);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function readReviewStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result;
  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "progress") statusText.textContent = `${event.stage}...`;
    if (event.type === "result" || event.type === "error") result = event;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      lines.forEach(consume);
      if (done) break;
    }
    consume(buffer);
    if (!result) throw new Error("The review connection ended early. The server may have restarted.");
    return result;
  } finally { reader.releaseLock(); }
}

function fileReference(review, path, line = 1) {
  const label = `${escapeHtml(path)}:${Number(line) || 1}`;
  const href = sourceLink(review, path, line);
  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
}

function renderScope(review) {
  const skipped = review.scope?.skipped || [];
  $("#scopeSummary").textContent = `${review.files.length} files reviewed; ${skipped.length} paths skipped. Excluded directory contents are not traversed. Python uses AST analysis; JavaScript and TypeScript use pattern-based checks. Tests are detected, not executed.`;
  $("#reviewedFiles").innerHTML = review.files.map((file) => `<div class="compact-item">${fileReference(review, file.path)}<p>${escapeHtml(file.language)} / ${file.loc} non-empty lines</p></div>`).join("") || "No supported files found.";
  $("#skippedFiles").innerHTML = skipped.map((item) => `<div class="compact-item"><strong>${escapeHtml(item.path)}</strong><p>${escapeHtml(item.reason)}</p></div>`).join("") || "No skipped paths recorded.";
}

function readHistory() {
  try {
    const items = JSON.parse(localStorage.getItem("codeargusHistory") || "[]");
    return Array.isArray(items) ? items.filter((item) => item.repository?.url && item.summary && Array.isArray(item.files)).slice(0, 8) : [];
  } catch { return []; }
}

function saveReview(review) {
  const snapshot = structuredClone(review);
  for (const file of snapshot.files) if (file.summary) delete file.summary.normalizedLines;
  history = [snapshot, ...history.filter((item) => item.id !== snapshot.id)].slice(0, 8);
  let persisted = true;
  try { localStorage.setItem("codeargusHistory", JSON.stringify(history)); }
  catch { persisted = false; }
  renderHistory();
  return persisted;
}

function renderHistory() {
  $("#historyArea").hidden = history.length === 0;
  $("#historySelect").innerHTML = '<option value="">Choose a saved review</option>' + history.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.repository.owner + "/" + item.repository.name)} / ${escapeHtml(item.repository.commitSha?.slice(0, 8) || "unknown commit")} / ${escapeHtml(new Date(item.reviewedAt).toLocaleString())}</option>`).join("");
}

function renderComparisonOptions() {
  const candidates = history.filter((item) => !latestReview.example && item.id !== latestReview.id && item.repository.url.toLowerCase() === latestReview.repository.url.toLowerCase() && new Date(item.reviewedAt) <= new Date(latestReview.reviewedAt));
  $("#baselineSelect").innerHTML = '<option value="">Select a baseline</option>' + candidates.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.repository.commitSha?.slice(0, 12) || "unknown commit")} / ${escapeHtml(new Date(item.reviewedAt).toLocaleString())}</option>`).join("");
  $("#baselineSelect").disabled = !candidates.length;
  $("#comparisonResult").textContent = candidates.length ? "Choose an earlier review to compare findings." : "Review the same repository again after pushing changes to create a comparison. History stays in this browser (up to 8 reviews).";
}

function renderComparison() {
  const baseline = history.find((item) => item.id === $("#baselineSelect").value);
  if (!baseline || !latestReview) return;
  const comparison = compareReviews(baseline, latestReview);
  const sha = (review) => review.repository.commitSha?.slice(0, 12) || "unknown";
  const scopeChanged = JSON.stringify(baseline.files.map((f) => f.path).sort()) !== JSON.stringify(latestReview.files.map((f) => f.path).sort());
  $("#comparisonResult").innerHTML = `<p>${escapeHtml(sha(baseline))} &rarr; ${escapeHtml(sha(latestReview))} / Score change: ${comparison.scoreDelta > 0 ? "+" : ""}${comparison.scoreDelta}</p>
    <p>${comparison.resolved.length} no longer detected / ${comparison.introduced.length} newly detected / ${comparison.unchanged.length} still detected</p>
    <p class="section-copy">Matches use file, rule title, category, and severity; line shifts are ignored. A missing finding does not prove a fix.${scopeChanged ? " The reviewed file set changed; missing files can affect these counts." : ""}${sha(baseline) === sha(latestReview) ? " Both reviews use the same commit." : ""}</p>` +
    [["No longer detected", comparison.resolved, baseline], ["Newly detected", comparison.introduced, latestReview], ["Still detected", comparison.unchanged, latestReview]].map(([title, findings, review]) => `<h3>${title}</h3>${findings.length ? findings.map((finding) => `<div class="compact-item"><strong>${escapeHtml(finding.title)}</strong>${fileReference(review, finding.path, finding.line)}</div>`).join("") : "<p>None.</p>"}`).join("");
}

function exportMarkdown(review) {
  const reviewed = review.files.map((file) => `- ${file.path} (${file.language})`).join("\n");
  const skipped = (review.scope?.skipped || []).map((item) => `- ${item.path}: ${item.reason}`).join("\n") || "- None recorded.";
  return `${review.reportMarkdown}\n\n## Reviewer notes\n${review.narrative.overview}\n\n## Review scope\n${review.files.length} files reviewed; ${review.scope?.skipped?.length || 0} paths skipped. Tests were not executed.\n\n### Reviewed files\n${reviewed || "- None."}\n\n### Skipped paths\n${skipped}\n\nHeuristic score is not a security guarantee or test coverage measurement.\n`;
}

function downloadReport(format) {
  if (!latestReview) return;
  const content = format === "json" ? JSON.stringify(latestReview, null, 2) : exportMarkdown(latestReview);
  const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `codeargus-${latestReview.repository.name}-${latestReview.repository.commitSha?.slice(0, 8) || "example"}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
