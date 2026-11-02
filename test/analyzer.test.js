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
