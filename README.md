# FF1-CLI

A small Node.js CLI for building DP-1 playlists from NFT collections.

**Runtime:** Node.js 22 or newer (matches CI and the `dp1-js` dependency). That engine floor is a **breaking** change if you previously used Node 18 or 20—check the **GitHub Release** for the version you move to; release authors follow `docs/RELEASING.md` so the notes stay explicit.

FF1-CLI turns a simple prompt into a DP-1–conformant playlist you can preview on an FF1. The model orchestrates; deterministic tools do the real work (schema validation, indexing, JSON‑LD). If something comes back invalid, validation rejects it and we loop until it’s right.

## Install

```bash
npm i -g ff1-cli
```

## Install (curl)

```bash
curl -fsSL https://feralfile.com/ff1-cli-install | bash
```

Installs a prebuilt binary for macOS/Linux (no Node.js required).

## One-off Usage (npx)

```bash
npx ff1-cli setup
npx ff1-cli chat
```

## Quick Start

**Set your LLM API key first (default Grok):** `export GROK_API_KEY='xai-your-api-key-here'`

```bash
ff1 setup
ff1 chat
ff1 play "https://example.com/video.mp4" --skip-verify
```

If you need manual config actions instead of guided setup:

```bash
ff1 config init
ff1 config validate
```

## Dev Quick Start

**Set your LLM API key first (default Grok):** `export GROK_API_KEY='xai-your-api-key-here'`

```bash
npm ci
npm run dev -- setup
npm run dev -- chat
npm run dev -- play "https://example.com/video.mp4" --skip-verify
```

## Documentation

- Getting started and usage: `./docs/README.md`
- Configuration: `./docs/CONFIGURATION.md`
- Function calling architecture: `./docs/FUNCTION_CALLING.md`
- Examples: `./docs/EXAMPLES.md`
- SSH access: `ff1 ssh enable|disable` in `./docs/README.md`

## Verification

GitHub Actions runs `.github/workflows/ci.yml` for pull requests, pushes to `main`/`master`, and reusable `workflow_call` jobs. CI uses Node.js 22, installs dependencies with `npm ci`, sets `GROK_API_KEY=dummy`, and runs the repo-wide verification entrypoint:

```bash
GROK_API_KEY=dummy npm run verify
```

Run the same command locally before opening a PR. It checks formatting, lint, tests, TypeScript build, playlist validation smoke, and config validation smoke without mutating source files.

Other GitHub Actions workflows:

- `.github/workflows/build.yml` builds release assets when called by release automation or manually dispatched.
- `.github/workflows/release.yml` reuses CI, verifies the release version, publishes npm, uploads assets, and checks the published release.
- `.github/workflows/dependency-review.yml` reviews dependency changes on pull requests.
- `.github/workflows/codeql.yml` runs CodeQL analysis on pull requests and pushes to `main`/`master`.

## Scripts

```bash
npm run dev            # Run CLI in dev (tsx)
npm run build          # Build TypeScript
npm run check          # Format check + lint + tests
npm run smoke          # Build + CLI smoke checks
npm run verify         # CI-equivalent validation entrypoint
npm run lint:fix       # Optional mutating lint fix; review changes before committing
```

## License

MIT
