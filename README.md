# FF1-CLI

A small Node.js CLI for building DP1 playlists from NFT collections.

FF1-CLI turns a simple prompt into a DP-1–conformant playlist you can preview on an FF1. The model orchestrates; deterministic tools do the real work (schema validation, indexing, JSON‑LD). If something comes back invalid, validation rejects it and we loop until it’s right.

Note: Publishing to an open registry is on the roadmap.

## Quick Start

**Set your LLM API key first (default Grok):** `export GROK_API_KEY='xai-your-api-key-here'`

```bash
npm install
npm run dev -- config init
npm run dev chat
```

## Documentation

- Getting started, config, and usage: `./docs/README.md`
- Function calling architecture: `./docs/FUNCTION_CALLING.md`
- Examples: `./docs/EXAMPLES.md`

## Scripts

```bash
npm run dev            # Run CLI in dev (tsx)
npm run build          # Build TypeScript
npm run lint:fix       # Lint + fix
```

## License

MIT
