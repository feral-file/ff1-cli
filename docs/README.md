# FF1-CLI Documentation

Build DP-1 (Display Protocol 1) playlists from NFT data with either natural language (AI‑driven) or deterministic parameters. This doc covers install, config, and day‑to‑day usage.

## Install

```bash
npm i -g ff1-cli
```

## Install (curl)

```bash
curl -fsSL https://feralfile.com/ff1-cli-install | bash
```

Installs a prebuilt binary for macOS/Linux (no Node.js required).

## Configure

```bash
# Create example config and edit API keys
ff1 config init

# Validate configuration
ff1 config validate
```

See the full configuration reference here: `./CONFIGURATION.md`.

### config.json structure (minimal)

```json
{
  "defaultModel": "grok",
  "models": {
    "grok": {
      "apiKey": "xai-your-api-key-here",
      "baseURL": "https://api.x.ai/v1",
      "model": "grok-beta",
      "supportsFunctionCalling": true
    },
    "chatgpt": {
      "apiKey": "sk-your-openai-key-here",
      "baseURL": "https://api.openai.com/v1",
      "model": "gpt-4o",
      "supportsFunctionCalling": true
    },
    "gemini": {
      "apiKey": "your-gemini-key-here",
      "baseURL": "https://generativelanguage.googleapis.com/v1beta/openai/",
      "model": "gemini-2.0-flash-exp",
      "supportsFunctionCalling": true
    }
  },
  "defaultDuration": 10,
  "playlist": {
    "privateKey": "your_ed25519_private_key_base64_here"
  },
  "feed": { "baseURLs": ["https://dp1-feed-operator-api-prod.autonomy-system.workers.dev/api/v1"] },
  "ff1Devices": {
    "devices": [
      {
        "name": "Living Room Display",
        "host": "http://192.168.1.100:1111",
        "apiKey": "",
        "topicID": ""
      }
    ]
  }
}
```

### Environment variables (optional)

See `./CONFIGURATION.md` for environment variable mappings.

## Quick Start

```bash
# Chat
ff1 chat

# Or natural language in one shot
ff1 chat "Get tokens 1,2,3 from Ethereum contract 0xabc" -o playlist.json

# Deterministic (no AI)
ff1 build examples/params-example.json -o playlist.json
```

For development in this repo:

```bash
npm run build
node dist/index.js chat
```

If you're running from source without a build, use:

```bash
npm run dev -- chat
```

## Recommended Deterministic Flow (LLM + Tools)

The model orchestrates; deterministic tools keep us honest and DP1‑conformant.

1. Input: Share the essentials (contract + token IDs, or feed/URL names).
2. Orchestration: The LLM parses your prompt and calls tools that:
   - Fetch NFT metadata via OSS libs (`viem` for Ethereum, `@taquito/taquito` for Tezos)
   - Validate DP1 schema with `dp1-js`
   - Build a DP1 playlist envelope deterministically
   - Optionally sign with Ed25519 (canonical JSON via `dp1-js`)
3. Preview/send: Send to an FF1 on your LAN over HTTP (recommended). Point `ff1Devices.devices[].host` at a local relay if needed.
4. Publish: Optional feed/registry publishing via the `publish` command.

Notes:

- **Deterministic by design**: Validation rejects bad or hallucinated data; we loop until it's valid or stop.
- **OSS‑first**: `viem` and `@taquito/taquito`, with room for local caching.
- **Relay**: Swap the example host for a local Node/Hono relay; avoid vendor lock‑in.

## Commands (cheat sheet)

- `chat [content]` – AI-driven natural language playlists
  - Options: `-o, --output <file>`, `-m, --model <name>`, `-v, --verbose`
- `build [params.json]` – Deterministic build from JSON or stdin
  - Options: `-o, --output <file>`, `-v, --verbose`
- `play <url>` – Send a media URL directly to an FF1 device
  - Options: `-d, --device <name>`, `--skip-verify`
- `validate <file-or-url>` / `verify <file-or-url>` – Validate a DP1 playlist file
- `sign <file>` – Sign playlist with Ed25519
  - Options: `-k, --key <base64>`, `-o, --output <file>`
- `send <file>` – Send a local or hosted DP-1 playlist to an FF1 device
  - Options: `-d, --device <name>`, `--skip-verify`
- `publish <file>` – Publish a playlist to a feed server
  - Options: `-s, --server <index>` (server index if multiple configured)
- `config <init|show|validate>` – Manage configuration

## Usage Highlights

### Natural language (AI)

```bash
npm run dev -- chat "Get token 42 from Tezos contract KT1abc"
npm run dev -- chat "Get tokens 100-105 from Ethereum contract 0xdef" -o playlist.json
npm run dev -- chat "Get 3 from Social Codes and 2 from 0xabc" -v
```

### One-shot complex prompt

The model reads your request via the intent parser and turns it into structured `requirements` and `playlistSettings` (including shuffle, durations, and device). You can do everything in one line:

```bash
# Mix sources, shuffle order, set per-item duration, and send to a named device
npm run dev -- chat "From Ethereum contract 0xabc get tokens 1,2 and from Tezos KT1xyz get token 42; shuffle the order; 7 seconds per item; send to device 'Living Room Display'." -o playlist.json -v
```

How it works (at a glance):

- The intent parser maps your text to `requirements` (what to fetch) and `playlistSettings` (e.g., `durationPerItem`, `preserveOrder=false` for shuffle, `deviceName`, `feedServer`).
- Deterministic tools fetch NFT metadata, build a DP‑1 playlist, and validate it.
- If `deviceName` is present, the CLI will send the validated playlist to that FF1 device.
- If `feedServer` is present (via "publish to my feed"), the CLI will publish the playlist to the selected feed server.

Use `--model grok|chatgpt|gemini` to switch models, or set `defaultModel` in `config.json`.

### Natural language publishing

The intent parser recognizes publishing keywords and can both display and publish in one command:

```bash
# Build and publish
npm run dev -- chat "Build playlist from Ethereum contract 0xb932a70A57673d89f4acfFBE830E8ed7f75Fb9e0 with tokens 52932 and 52457; publish to my feed" -o playlist.json -v

# Display on FF1 AND publish to feed
npm run dev -- chat "Get tokens 1,2 from 0xabc; shuffle; send to my FF1 and publish to feed" -o playlist.json -v
```

Publishing keywords: "publish", "publish to my feed", "push to feed", "send to feed". The CLI will:

1. Detect the keyword and call `get_feed_servers`
2. If multiple servers → ask which one to use
3. Build → verify → publish automatically
4. Display playlist ID and server URL on success

### Deterministic (no AI)

```bash
npm run dev -- build params.json -o playlist.json
cat params.json | npm run dev -- build -o playlist.json
```

`params.json` should include `requirements` and optional `playlistSettings`. See `examples/params-example.json`.

### Validate, sign, and send

```bash
# Validate
npm run dev -- validate playlist.json

# Sign (uses key from config or override via --key)
npm run dev -- sign playlist.json -o signed.json

# Send to device (verifies by default)
npm run dev -- send playlist.json -d "Living Room Display"

# Send a hosted DP-1 playlist
npm run dev -- send "https://cdn.example.com/playlist.json" -d "Living Room Display"

# Play a direct URL
npm run dev -- play "https://example.com/video.mp4" -d "Living Room Display" --skip-verify
```

### Publish to feed server

```bash
# Publish to first configured feed server
npm run dev -- publish playlist.json

# Publish to specific server (if multiple configured)
npm run dev -- publish playlist.json -s 0
npm run dev -- publish playlist.json -s 1
```

The `publish` command:

- Validates the playlist against DP-1 spec
- Shows interactive server selection if multiple are configured
- Sends the validated playlist to the chosen feed server
- Returns the playlist ID on success

Configure feed servers in `config.json`:

```json
{
  "feedServers": [
    {
      "baseUrl": "http://localhost:8787/api/v1",
      "apiKey": "your-api-key-optional"
    },
    {
      "baseUrl": "https://feed.example.com/api/v1",
      "apiKey": "your-api-key-optional"
    }
  ]
}
```

### FF1 device configuration

See selection rules and examples in `./CONFIGURATION.md`.

### Playlist signing (optional)

- Add `playlist.privateKey` (base64 Ed25519) to `config.json` or set `PLAYLIST_PRIVATE_KEY`.
- Signed playlists include a `signature` field compliant with DP1 (via `dp1-js`).

## Constraints

- Max 20 items total across all requirements
- Per-source caps enforced in utilities
- Duration per item defaults to 10s (configurable)

## Links

- Function calling details: `./FUNCTION_CALLING.md`
- Examples: `./EXAMPLES.md`
- Release assets: `./RELEASING.md`
- DP1 spec: `https://github.com/display-protocol/dp1`
