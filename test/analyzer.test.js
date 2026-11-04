import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeRepository } from "../packages/analyzer/index.js";

test("analyzes Python and JavaScript security findings", async () => {
  const root = await mkdtemp(join(tmpdir(), "code-review-agent-test-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "app.py"),
      [
        "def lookup(cursor, user_id):",
        "    query = f\"SELECT * FROM users WHERE id = {user_id}\"",
        "    cursor.execute(query)",
        "    try:",
        "        return eval(user_id)",
        "    except:",
        "        pass"
      ].join("\n")
    );
    await writeFile(
      join(root, "src", "view.js"),
      [
        "function render(input) {",
        "  document.body.innerHTML = input;",
        "  const apiKey = 'abcdefghijklmnop';",
        "}"
      ].join("\n")
    );

    const review = await analyzeRepository(root, {
      repository: { owner: "test", name: "repo", url: "" }
    });

    const titles = review.files.flatMap((file) => file.findings.map((finding) => finding.title));
    assert.equal(review.summary.filesReviewed, 2);
    assert.ok(titles.includes("Unsafe dynamic code execution"));
    assert.ok(titles.includes("Possible SQL injection"));
    assert.ok(titles.includes("Bare exception handler"));
    assert.ok(titles.includes("Unsafe HTML injection sink"));
    assert.ok(titles.includes("Possible hardcoded secret"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("function complexity is bounded by real JS/TS and Python function scopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeargus-complexity-"));
  try {
    await writeFile(join(root, "example.tsx"), `const simple = (input: string) => input;\nfunction outer() { function nested(x: number) { if (x) return 1; return 0; } return nested(1); }\nfunction busy(x: number) { ${Array.from({length: 14}, () => "if (x) x--;").join(" ")} return <div>{x}</div>; }`);
    await writeFile(join(root, "example.py"), "def outer():\n    def inner(x):\n        if x:\n            return 1\n        return 0\n    return inner(1)\n");
    const review = await analyzeRepository(root);
    const ts = review.files.find((item) => item.path.endsWith("tsx"));
    assert.equal(ts.functions.find((item) => item.name === "simple").complexity, 1);
    assert.equal(ts.functions.find((item) => item.name === "outer").complexity, 1);
    assert.equal(ts.functions.find((item) => item.name === "nested").complexity, 2);
    assert.equal(ts.functions.find((item) => item.name === "busy").complexity, 15);
    const py = review.files.find((item) => item.path.endsWith("py"));
    assert.equal(py.functions.find((item) => item.name === "outer").complexity, 1);
    assert.equal(py.functions.find((item) => item.name === "inner").complexity, 2);
    assert.equal(ts.summary.normalizedLines, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("overlapping duplicate windows produce one finding with an actual source line", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeargus-duplicate-"));
  try {
    const block = Array.from({length: 12}, (_, i) => `const lengthyVariable${i} = processValue(${i});`).join("\n");
    await writeFile(join(root, "a.js"), block);
    await writeFile(join(root, "b.js"), "// file comment\n\n" + block);
    const review = await analyzeRepository(root);
    const duplicates = review.files.flatMap((item) => item.findings).filter((item) => item.title === "Duplicate code block");
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].line, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("scope excludes checkpoint copies, symlinks, unsupported and oversized files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeargus-scope-"));
  try {
    const { symlink } = await import("node:fs/promises");
    await mkdir(join(root, ".ipynb_checkpoints"));
    await writeFile(join(root, ".ipynb_checkpoints", "copy.js"), "eval(input)");
    await writeFile(join(root, "app.js"), "function safe() { return 1; }");
    await writeFile(join(root, "README.md"), "documentation");
    await writeFile(join(root, "large.js"), "x".repeat(180001));
    await symlink(join(root, "app.js"), join(root, "linked.js"));
    const review = await analyzeRepository(root);
    assert.deepEqual(review.files.map((file) => file.path), ["app.js"]);
    assert.equal(review.summary.findingsCount, 0);
    assert.equal(review.scope.skipped.length, 4);
    assert.ok(review.scope.skipped.some((item) => item.reason.includes("180 KB")));
  } finally { await rm(root, { recursive: true, force: true }); }
});
