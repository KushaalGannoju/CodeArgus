import test from "node:test";
import assert from "node:assert/strict";
import { compareReviews, createExampleReview, sourceLink } from "../apps/web/reviewTools.js";

test("comparison ignores line shifts and counts duplicate occurrences", () => {
  const before = createExampleReview();
  before.files[0].findings.push({ ...before.files[0].findings[0], line: 15 });
  const after = createExampleReview();
  after.files[0].findings[0].line = 20;
  after.files[0].findings.push({ title: "New issue", category: "security", severity: "high", line: 22 });
  const result = compareReviews(before, after);
  assert.equal(result.resolved.length, 1);
  assert.equal(result.unchanged.length, 2);
  assert.equal(result.introduced.length, 1);
  after.repository.url += "-other";
  assert.throws(() => compareReviews(before, after), /same repository/);
});

test("different scoring versions do not create a misleading improvement", () => {
  const before = createExampleReview();
  const after = structuredClone(before);
  before.summary.scoring = { version: "1" };
  after.summary.scoring = { version: "2" };
  after.summary.score = 99;
  assert.equal(compareReviews(before, after).scoreDelta, null);
});

test("source links pin commits, encode paths, and exclude illustrative fixtures", () => {
  const review = createExampleReview();
  assert.equal(sourceLink(review, "app.py"), null);
  review.example = false;
  review.repository.commitSha = "a".repeat(40);
  assert.equal(sourceLink(review, "src/a b.py", 7), `https://github.com/example/student-calculator/blob/${"a".repeat(40)}/src/a%20b.py#L7`);
  review.repository.url = "https://other.example/repo";
  assert.equal(sourceLink(review, "app.py"), null);
});
