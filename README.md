# CodeArgus

CodeArgus is a web reviewer for student GitHub projects. Paste a public GitHub repository URL and the app clones it, analyzes supported Python and JavaScript/TypeScript files, scores the repository, and produces practical review notes.

CodeArgus combines deterministic static analysis with an optional Gemini review layer. The app still works without a Gemini key. Gemini receives compact analysis facts and writes reviewer notes; it does not execute repository code.

Repository: `KushaalGannoju/CodeArgus`

## Features

- No login flow
- Public GitHub repo URL review
- Python AST analysis
- Babel AST function-complexity analysis for JavaScript/TypeScript, with pattern-based security rules
- Security checks for secrets, unsafe dynamic execution, unsafe HTML injection, command injection, SQL injection, and unsafe deserialization
- Complexity scoring
- Duplicate code detection
- Test suggestions
- Generated `pytest`/`vitest` starter tests
- Code-understanding quiz questions
- Complexity hotspot ranking
- Import-based dependency graph summary
- PR-style markdown review summary
- Risk profile for security, maintainability, correctness, and testing
- Gemini-generated reviewer notes when `GEMINI_API_KEY` is available
- Static fallback when Gemini is not configured or the demo token budget is exhausted
- Visible demo limits for reviews, Gemini calls, and estimated input tokens
- Frontend-ready Netlify config
- Backend-ready Dockerfile for Railway or similar platforms
- Compact light interface with mobile layouts and an offline illustrative review
- Backend wake-up status and streamed cloning, analysis, and reviewer-note stages
- Searchable findings, severity counts, and GitHub source links pinned to the reviewed commit
- Markdown/JSON exports and a clipboard summary
- Explicit review scope with excluded paths and file-size/file-count limits
- Browser-local history (8 reviews) and before/after comparisons by repository and commit
- Detailed review sections with a fix-and-validation plan, included in report exports
- Explainable category-based score deductions, file explorer, category/file filters, and finding sorting

## Review Scope and Comparisons

Python analysis uses the standard-library AST parser. JavaScript/TypeScript function complexity uses `@babel/parser` syntax trees and excludes nested functions from their parent's branch count. Security rules use Python AST checks or JavaScript patterns, without whole-program data-flow analysis. Generated directories such as `.ipynb_checkpoints`, dependencies, symlinks, unsupported files, and files over 180 KB are excluded. Up to 120 eligible files are reviewed in path order. The Scope tab lists reviewed files and skipped paths; excluded directories are listed once without scanning their contents. Duplicate source windows are consolidated per file pair, with original source line references.

Scores are heuristic deductions for findings and test-file presence, not coverage percentages or security certification. Detected tests are not executed. Generated test starters are skipped until adapted with real inputs and assertions.

Scoring method v2 starts at 100. Repeated occurrences of the same rule in one file count once at their highest severity. Security deductions use critical/high/medium/low weights of 12/8/3/1, capped at 60 points; correctness uses 10/6/2/0.5, capped at 25; maintainability uses 4/2/1/0.25, capped at 12. Missing test files cost a fixed 3 points, regardless of repository size. The final score is rounded. This allows a clean tested project to reach 100 and a lightly flagged project to remain above 90, while serious signals still lower the score. An empty review is unscored in the UI. Open "Why this score?" to see every contributing rule and cap. Comparisons across scoring versions suppress numeric score deltas; rerun older reviews for a fair comparison.

The Full review view includes security/correctness, maintainability, testing/edge cases, and scope/confidence, followed by ordered fixes with validation checks. Gemini is asked for roughly 450-650 words where the evidence supports it. Input metadata is compacted to fit the prompt budget; no raw repository source is sent to Gemini. A structured static review is available if Gemini fails. The model's text remains advisory and can be inaccurate; verify file-level findings and validation steps.

Each live review records the cloned HEAD commit. Review a repository, push fixes, and review it again. Open Compare and choose an earlier saved review. Matching uses path, rule title, category, and severity, ignoring line shifts and preserving duplicate counts. Missing findings can reflect changed scope or heuristics; they do not prove a fix. Renames are not tracked. History is stored only in this browser and can be cleared; raw normalized source lines are omitted from saved snapshots. No database or login is required.

The example is a labeled illustrative fixture, works without the backend, and consumes no Gemini budget. It is not a report from a real GitHub repository.

## Run Locally

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`.

Requirements:

- Node.js 20+
- Python 3.11+
- Git installed and available on `PATH`

## Gemini Setup

Create a `.env` file locally:

```bash
cp .env.example .env
```

Add your key:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-flash-latest
```

Keep the key server-side only. Do not put it in `apps/web/config.js`, browser code, screenshots, README examples, or GitHub commits.

## Demo Limits

The limits are intentionally lightweight and in-memory for V2:

```bash
SESSION_REVIEW_LIMIT=10
SESSION_GEMINI_LIMIT=10
SESSION_TOKEN_LIMIT=150000
REVIEW_PROMPT_TOKEN_LIMIT=8000
REVIEW_OUTPUT_TOKEN_LIMIT=4500
```

These limits reset when the backend process restarts or when a user starts with a new browser session id. They are good enough for a resume/demo version, but not a production abuse-prevention system.

AI reviews count attempted generations, including failures; static-only reviews do not spend an AI attempt. Token usage includes the provider's reported total (input, output, and thinking where applicable), with an estimate if metadata is missing. Responses that hit the output cap fall back to the static report and still count consumed tokens. A full input/output allowance is required before starting another generation. Only one review can run per session at a time. Google free-tier limits remain separate; increasing these demo allowances does not increase Google's quota or enable billing.

## Deployment

You can keep this as a monorepo. You do not need separate frontend and backend repositories.

### Backend on Render (Recommended Demo Setup)

After pushing this code, use New > Blueprint in Render, connect this repository, and select `render.yaml`. It configures a Docker web service on the Free instance plan and `/api/health` for health checks. Enter `GEMINI_API_KEY` when prompted. Confirm the selected plan before creating the service. Alternatively, create a Docker Web Service manually with the repository root as build context and `./Dockerfile` as the Dockerfile.

Set `ALLOWED_ORIGINS` to your exact frontend origin (the Blueprint defaults to `https://codeargus.netlify.app`). Let the host supply `PORT`. Keep the working `GEMINI_MODEL` value from your previous deployment if it differs. No database, persistent disk, or separate repository is needed. The same Dockerfile can also run on other container hosts.

Set environment variables:

```bash
HOST=0.0.0.0
NODE_ENV=production
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-flash-latest
ALLOWED_ORIGINS=https://your-netlify-site.netlify.app
SESSION_REVIEW_LIMIT=10
SESSION_GEMINI_LIMIT=10
SESSION_TOKEN_LIMIT=150000
REVIEW_PROMPT_TOKEN_LIMIT=8000
REVIEW_OUTPUT_TOKEN_LIMIT=4500
```

After deployment, open `https://YOUR-SERVICE.onrender.com/api/health` and confirm `{"ok":true}`. Copy the backend origin. Free instances may sleep and restart; the frontend waits up to 90 seconds for a connection and supports manual retry. The in-memory session budgets reset after server restarts. Free hosting and Gemini quotas still apply; this configuration does not guarantee unlimited availability.

For an existing Render service, explicitly update all five limit variables above: existing environment values override new code defaults. Redeploy the backend and frontend to activate the new review structure and parser dependency. The Dockerfile now installs locked Node dependencies with `npm ci --omit=dev`.

### Frontend on Netlify

Connect the same GitHub repo to Netlify.

Use:

```text
Build command: npm run build:web
Publish directory: apps/web
```

Set this Netlify environment variable:

```bash
PUBLIC_API_BASE_URL=https://YOUR-SERVICE.onrender.com
```

Netlify runs `scripts/build-web-config.js`, which writes `apps/web/config.js` with the backend URL.

Trigger a fresh Netlify deployment after changing this variable. Use the backend origin without `/api`. Never set the Gemini key on Netlify. With automatic Git deployments enabled, future pushes rebuild each connected service. JSON API clients remain supported; the website requests newline-delimited JSON to receive progress events from `POST /api/reviews`.

## Roadmap

### V1: Static Review MVP

- Build a basic web app.
- Paste a public repo URL.
- Clone the repo locally.
- Analyze Python and JavaScript/TypeScript files.
- Show findings, score, test suggestions, and quiz questions.

### V2: Gemini Review and Polished Demo

- Remove login entirely.
- Improve the UI into a modern developer-tool dashboard.
- Add visible review/session/token limits.
- Add Gemini review notes through a backend-only API key.
- Keep a static fallback when Gemini is unavailable.
- Prepare deployment for Netlify frontend plus Railway backend.

### Final Update: Resume-Ready Feature Set

- Keep the project lightweight enough to deploy for free.
- Use Gemini for natural reviewer notes, with static fallback.
- Add complexity hotspots and import dependency summaries.
- Add generated test starters for Python and JavaScript/TypeScript.
- Add a markdown PR summary that can be copied into GitHub.
- Keep real GitHub PR posting, database history, and background workers out of scope until a paid/hosted backend is needed.

## Why This Project Stands Out

This is not just an LLM wrapper. Static analysis produces grounded findings first, then Gemini improves prioritization and wording. That makes the system cheaper, more explainable, and more reliable than sending an entire repository directly to a model.
