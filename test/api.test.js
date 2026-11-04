import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

test("API streams actual stages, pins commit metadata and preserves JSON clients", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codeargus-api-"));
  const sha = "a".repeat(40);
  // Fake only the Git boundary: keep HTTP, analysis and fallback generation real.
  await writeFile(join(root, "git"), `#!/bin/sh\nif [ "$1" = "clone" ]; then\n mkdir -p "$4"\n printf 'function calculate(value) { return value; }\\n' > "$4/app.js"\nelse\n printf '${sha}\\n'\nfi\n`, { mode: 0o755 });
  const child = spawn(process.execPath, ["apps/api/server.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PATH: `${root}:${process.env.PATH}`, PORT: "0", HOST: "127.0.0.1", GEMINI_API_KEY: "", SESSION_REVIEW_LIMIT: "10", SESSION_GEMINI_LIMIT: "10", SESSION_TOKEN_LIMIT: "150000" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const address = await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); });
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`API exited ${code}`)));
    });
    const request = (accept) => fetch(`${address}/api/reviews`, { method: "POST", headers: { "Content-Type": "application/json", Accept: accept }, body: JSON.stringify({ repoUrl: "https://github.com/example/repository", useGemini: false }) });
    const limits = (await (await fetch(`${address}/api/limits`)).json()).limits;
    assert.equal(limits.reviewsRemaining, 10);
    assert.equal(limits.geminiRemaining, 10);
    assert.equal(limits.tokensRemaining, 150000);
    const streamed = await request("application/x-ndjson");
    const events = (await streamed.text()).trim().split("\n").filter(Boolean).map(JSON.parse);
    assert.deepEqual(events.filter((event) => event.type === "progress").map((event) => event.stage), ["Cloning repository", "Analyzing source files", "Writing reviewer notes"]);
    assert.equal(events.at(-1).review.repository.commitSha, sha);
    assert.equal(events.at(-1).review.files.length, 1);
    const json = await request("application/json");
    assert.equal((await json.json()).review.repository.commitSha, sha);
    const invalid = await fetch(`${address}/api/reviews`, { method: "POST", body: JSON.stringify({ repoUrl: "invalid" }) });
    assert.equal(invalid.status, 400);
  } finally {
    const exit = once(child, "exit");
    child.kill();
    await exit;
    await rm(root, { recursive: true, force: true });
  }
});
