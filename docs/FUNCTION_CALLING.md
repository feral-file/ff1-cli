# Function Calling Architecture

How FF1‑CLI uses AI function calling to build playlists deterministically. The model orchestrates function calls; tools enforce schema and assemble the DP1 envelope.

## Overview

Natural language requests become structured parameters. An AI orchestrator then calls functions to fetch items, build a DP1 playlist, verify it, optionally sign, and send to a device.

Pipeline:

```
Intent Parser → Orchestrator (function calls) → Utilities → DP1 Playlist
```

Key files:

- `src/intent-parser/` – Parses user text into `requirements` + `playlistSettings`
- `src/ai-orchestrator/index.js` – Function schemas and orchestration logic
- `src/utilities/` – Concrete implementations used by the orchestrator
- `src/main.ts` – Bridges CLI commands to parser/orchestrator/utilities

## Function Schemas (AI‑visible)

Defined in `src/ai-orchestrator/index.js` as tool schemas for OpenAI‑compatible clients.

- `query_requirement(requirement, duration)`
  - Types: `build_playlist`, `fetch_feed`, `query_address`
  - For `build_playlist`: requires `blockchain`, `contractAddress`, `tokenIds`, optional `quantity`
  - For `query_address`: requires `ownerAddress`, optional `quantity` (random selection)
  - For `fetch_feed`: requires `playlistName`, `quantity`

- `search_feed_playlist(playlistName)` → fuzzy-match across configured feeds
- `fetch_feed_playlist_items(playlistName, quantity, duration)`
- `build_playlist(items, title?, slug?, shuffle?)` → returns DP1 playlist
- `verify_playlist(playlist)` → validates DP1 compliance (must precede send)
- `send_to_device(playlist, deviceName?)`
- `resolve_domains(domains[], displayResults?)` → ENS/TNS resolution

Notes enforced by the orchestrator:

- Always pass complete requirement objects (no truncating addresses/token IDs)
- Resolve domains (`.eth`, `.tez`) before `query_address`
- Build, then verify before sending to devices
- Shuffle is controlled by `playlistSettings.preserveOrder`

## Implementations (server‑side)

Located in `src/utilities/` and wired in `src/ai-orchestrator/index.js`:

- `buildDP1Playlist({ items, title, slug })` → `src/utilities/playlist-builder.js`
- `sendPlaylistToDevice({ playlist, deviceName })` → `src/utilities/ff1-device.ts`
- `resolveDomains({ domains, displayResults })` → `src/utilities/domain-resolver.ts`
- `verifyPlaylist({ playlist })` → `src/utilities/playlist-verifier.ts`
- Feed utilities: `feed-fetcher.js`

## Deterministic Paths

Two options are available:

1) No-AI deterministic build (recommended for automation): Use CLI `build` command with a JSON file or stdin containing:

```json
{
  "requirements": [
    { "type": "fetch_feed", "playlistName": "Social Codes", "quantity": 3 },
    { "type": "build_playlist", "blockchain": "ethereum", "contractAddress": "0x...", "tokenIds": ["1","2"], "quantity": 2 }
  ],
  "playlistSettings": { "durationPerItem": 10, "preserveOrder": true, "title": "My Mix" }
}
```

This path bypasses the intent parser/orchestrator and calls utilities directly. Validation and sensible defaults are applied in `src/main.ts`.

2) AI‑orchestrated deterministic build (recommended for prompts): Use `chat` with `--verbose` to see tool calls. The orchestrator enforces complete requirement objects, then validates the result with `verify_playlist` before sending.

## Extending Functionality (OSS‑first)

1. Add a new function in `src/utilities/` (prefer OSS libs: `viem` for Ethereum, `@taquito/taquito` for Tezos; add local caching where it helps)
2. Export and wire it in `src/utilities/index.js`
3. Add a corresponding schema in `src/ai-orchestrator/index.js`
4. Update this doc if user‑facing behavior changes
5. Run `npm run lint:fix`

## Validation & Constraints

- Verify via `dp1-js` for DP1 conformance (canonical JSON + Ed25519 signing supported)
- Enforce max item counts and ordering/shuffle rules during build
- Batch domain resolution; report failures without crashing the flow


