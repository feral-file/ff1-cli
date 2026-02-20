# FF1-CLI

A small Node.js CLI for building DP-1 playlists from NFT collections.

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
npx ff1-cli config init
npx ff1-cli chat
```

## Quick Start

**Set your LLM API key first (default Grok):** `export GROK_API_KEY='xai-your-api-key-here'`

```bash
ff1 config init
ff1 chat
ff1 play "https://example.com/video.mp4" -d "Living Room Display" --skip-verify
```

## Dev Quick Start

**Set your LLM API key first (default Grok):** `export GROK_API_KEY='xai-your-api-key-here'`

```bash
npm install
npm run dev -- config init
npm run dev chat
npm run dev -- play "https://example.com/video.mp4" -d "Living Room Display" --skip-verify
```

## Documentation

- Getting started, config, and usage: `./docs/README.md`
- Function calling architecture: `./docs/FUNCTION_CALLING.md`
- Examples: `./docs/EXAMPLES.md`
- SSH access: `ff1 ssh enable|disable` in `./docs/README.md`

## Scripts

```bash
npm run dev            # Run CLI in dev (tsx)
npm run build          # Build TypeScript
npm run lint:fix       # Lint + fix
```

## License

MIT
