# AGENTS.md

Instructions for AI coding agents working on FF1-CLI. This repo is a Node.js CLI for NFT data (Grok AI) and DP-1 playlists. Follow the rules below; run lint and smoke tests before finishing any task.

## Project overview

- **What:** FF1-CLI — CLI for computational art on FF1 (playlists, DP-1 envelopes, validation).
- **Docs:** Only these files in `/docs`: `README.md`, `FUNCTION_CALLING.md`, `EXAMPLES.md`, `CONFIGURATION.md`. Root README is minimal with links to `/docs`. Do not add CHANGELOG, SETUP, or other new doc files.
- **Docs updates:** Only when user-facing behavior changes. No docs for migrations, legacy cleanups, or internal refactors.

## Setup and commands

- Install deps: `npm install`
- Lint (required after code changes): `npm run lint:fix` — no warnings or errors before completing tasks.
- Smoke tests before completing a task:
  - `node index.js validate examples/sample-playlist.json`
  - `node index.js config validate`

## Code style

- **Always use TypeScript** for source code (`.ts`). Do not add or convert to plain JavaScript.
- ESLint + Prettier (see `eslint.config.js`, `.prettierrc`): single quotes, 2-space indent, semicolons, 100 char width.
- `const` by default; `let` only when reassigning. Strict equality (`===`, `!==`). Curly braces in control flow.
- Prefix unused variables with `_` (e.g. `_error`).
- Prefer `async`/`await`; wrap async code in try/catch.

## Voice and writing (docs, comments, CLI output)

- Pragmatic, clear, direct: short sentences; no corporate jargon; honest about limits. Use “we”; concrete next steps.
- Use precise terms: FF1, DP-1 envelope, DP-1 conformance, computational art playlists, channel endorsements, etc. Use `backticks` for files, dirs, functions.
- **Docs:** Start with why, then what/how, then examples. Skimmable headings; lists and short paragraphs.
- **CLI/logs:** One idea per line. Success = one sentence past tense. Errors = cause + minimal context + next action. No stack traces unless `DEBUG`. No emojis; specific nouns (e.g. “DP-1 envelope” not “it”). If recovery exists, include it (e.g. “Re-run `node index.js config validate`”).

## Code philosophy and refactoring

- **No backward compatibility:** Remove legacy code when refactoring; no deprecation period. Remove unused/obsolete code immediately.
- **Functions:** Single responsibility; 10–20 lines preferred. Break complex flows into small composed functions. Pure when possible; clear names.
- **Refactor checklist:** Remove all legacy code; break large functions; extract reuse; add/update JSDoc; remove unused imports/vars; prefer composition.
- **Break up a function when:** >30 lines, >3 nesting levels, multiple unrelated concerns, “Step 1/2” comments, or hard to name.

## JSDoc (required for all functions)

- New functions: full JSDoc before committing. Updated functions: JSDoc updated to match.
- Include: `@param` with types, `@returns` with type and description, `@throws` for exceptions, `@example` for non-trivial usage. Document object properties (e.g. `@param {Object} options`, `options.field`).

## Function calling (new capabilities)

When adding a new function-calling capability:

1. Implement in `src/function-calling/[module].ts`
2. Add schema in `src/function-calling/index.ts` and register in the function registry
3. Update `/docs/FUNCTION_CALLING.md`
4. Run `npm run lint:fix`

Function requirements: return shape with `success`; validate inputs early (fail fast); clear error messages; full JSDoc; single responsibility; small (10–20 lines ideal).

## Configuration and security

- Config priority: `config.json` > `.env` > defaults. Validate config before use.
- Never commit: `config.json`, `.env`, `node_modules`.

## Error handling

- Descriptive messages; log with context; use chalk for CLI output; support DEBUG mode; fail fast with clear validation.

## Testing and temporary scripts

- Test scripts for debugging: put in `/.tmp`; do not commit; delete after verification.

## Git and commits

- When the user asks for a commit: use Conventional Commits. Run `npm run lint:fix` before committing. Prefer atomic commits; legacy removal in a separate commit when possible.
- Format: `<type>(<scope>): <subject>` with optional body/footer. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `style`.

## Task workflows

- **New feature:** Implement in small functions with JSDoc → lint → update relevant doc → add example to EXAMPLES.md if needed → run smoke tests.
- **Bug fix:** Fix → update JSDoc if needed → lint → test → update docs only if behavior changed.
- **Refactor:** Remove legacy → break down large functions → add/update JSDoc → lint → test → update docs if user-facing.
- **Doc update:** Edit one of the four existing docs only; do not create new doc files.
