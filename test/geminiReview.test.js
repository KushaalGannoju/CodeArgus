import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, buildStaticNarrative, enrichReviewWithGemini, estimateTokens } from "../packages/ai/geminiReview.js";

const review = {
  repository: { owner: "student", name: "demo", url: "https://github.com/student/demo" },
  summary: {
    score: 61,
    filesReviewed: 2,
    findingsCount: 2,
    severity: { critical: 0, high: 1, medium: 1, low: 0 },
    languages: { Python: 1, JavaScript: 1 },
    testsDetected: 0
  },
  files: [
    {
      path: "src/app.py",
      language: "Python",
      findings: [
        {
          title: "Possible SQL injection",
          severity: "high",
          category: "security",
          line: 8,
          message: "SQL appears dynamic.",
          recommendation: "Use parameterized queries."
        }
      ]
    }
  ],
  testSuggestions: []
};

test("builds a static narrative when Gemini is unavailable", async () => {
  const enriched = await enrichReviewWithGemini(structuredClone(review), { apiKey: "" });

  assert.equal(enriched.ai.used, false);
  assert.equal(enriched.narrative.provider, "static");
  assert.match(enriched.narrative.overview, /2 supported files/);
  assert.equal(enriched.narrative.priorities[0].severity, "high");
});

test("detailed Gemini sections survive normalization and real token usage is retained", async (t) => {
  let request;
  const longText = "Explain the flagged operation and validate its input boundary. ".repeat(40);
  t.mock.method(globalThis, "fetch", async (_, options) => {
    request = JSON.parse(options.body);
    return Response.json({ usageMetadata: { totalTokenCount: 6200 }, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ overview: longText, sections: Array.from({length:4}, () => ({body: longText})), actionPlan: [{title:"Fix query",detail:"Parameterize input",validation:"Test malformed IDs",files:["src/app.py", "invented.py"]}], priorities:[null], nextSteps: ["Run tests"] }) }] } }] });
  });
  const result = await enrichReviewWithGemini(structuredClone(review), { apiKey: "test-key", enabled: true });
  assert.equal(result.ai.used, true);
  assert.equal(result.ai.tokensUsed, 6200);
  assert.ok(result.narrative.overview.length > 1400);
  assert.equal(result.narrative.sections.length, 4);
  assert.deepEqual(result.narrative.actionPlan[0].files, ["src/app.py"]);
  assert.equal(request.generationConfig.maxOutputTokens, 4500);
  assert.match(request.contents[0].parts[0].text, /450-650 word/);
});

test("quota failures do not trigger multiple model calls", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("Quota exceeded", {status:429}); });
  const result = await enrichReviewWithGemini(structuredClone(review), {apiKey:"test-key"});
  assert.equal(calls, 1);
  assert.equal(result.ai.used, false);
  assert.equal(result.ai.attempted, true);
  assert.equal(result.narrative.sections.length, 4);
});

test("truncated output falls back without losing the consumed token count", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({usageMetadata:{totalTokenCount:5000},candidates:[{finishReason:"MAX_TOKENS",content:{parts:[{text:'{"overview":'}]}}]}));
  const result = await enrichReviewWithGemini(structuredClone(review), {apiKey:"test-key"});
  assert.equal(result.ai.used, false);
  assert.equal(result.ai.tokensUsed, 5000);
  assert.match(result.ai.skippedReason, /output limit/);
});

test("large prompts compact lower-priority file metadata to fit the input budget", () => {
  const large = structuredClone(review);
  large.files = Array.from({length:120}, (_, i) => ({...structuredClone(review.files[0]),path:`src/${i}.py`,summary:{purpose:"x".repeat(200)},functions:[]}));
  assert.ok(estimateTokens(buildPrompt(large)) <= 8000);
});

test("estimates prompt tokens and builds fallback priorities", () => {
  const narrative = buildStaticNarrative(structuredClone(review));

  assert.ok(estimateTokens("abcd") >= 1);
  assert.equal(narrative.priorities[0].title, "Possible SQL injection");
});
