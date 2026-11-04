import test from "node:test";
import assert from "node:assert/strict";
import { calculateScore } from "../packages/analyzer/scoring.js";

const file = (path, findings = [], isTest = false) => ({ path, findings, isTest });
const finding = (title, severity, category) => ({ title, severity, category });

test("clean projects can reach 100 and lack of tests has a fixed small deduction", () => {
  assert.equal(calculateScore([file("app.js"), file("app.test.js", [], true)]).score, 100);
  assert.equal(calculateScore(Array.from({ length: 100 }, (_, i) => file(`${i}.js`))).score, 97);
  assert.equal(calculateScore([]).score, 0);
});

test("a few minor issues stay above 90 while critical security still costs points", () => {
  const minor = [finding("Complex function", "medium", "maintainability"), finding("Broad catch", "low", "maintainability")];
  const review = calculateScore([file("app.py", minor)]);
  assert.equal(review.score, 96);
  const risky = calculateScore([file("app.py", [...minor, finding("eval", "critical", "security")])]);
  assert.equal(risky.score, 84);
  assert.equal(risky.scoring.breakdown[0].deduction, 12);
});

test("repeated rules are charged once per file at the highest severity", () => {
  const repeated = Array.from({ length: 40 }, () => finding("Complex function", "medium", "maintainability"));
  repeated.push(finding("Complex function", "high", "maintainability"));
  const review = calculateScore([file("app.py", repeated)]);
  assert.equal(review.score, 95);
  assert.equal(review.scoring.breakdown[2].items[0].occurrences, 41);
  assert.equal(review.scoring.breakdown[2].deduction, 2);
});

test("category caps bound deductions and the final score reconciles", () => {
  const files = Array.from({ length: 100 }, (_, i) => file(`${i}.py`, [finding("complex", "high", "maintainability")]));
  const result = calculateScore(files);
  assert.equal(result.score, 85);
  assert.equal(result.scoring.breakdown[2].deduction, 12);
  assert.equal(result.score, Math.round(100 - result.scoring.breakdown.reduce((sum, item) => sum + item.deduction, 0)));
});
