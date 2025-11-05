# Configuration Guide

This guide explains how to configure FF1‑CLI, field by field. Configuration priority is:

- `config.json` (highest)
- `.env`
- built‑in defaults (lowest)

## Getting started

```bash
# Create example config and edit it
npm run dev -- config init

# Validate your configuration
npm run dev -- config validate

# Show current config summary
npm run dev -- config show
```

## Top‑level fields

- **defaultModel** (string)
  - The default AI model key to use. Must match a key under `models`.
  - Used by orchestration to pick API, timeouts, and model identifier.

- **defaultDuration** (number, seconds)
  - Intended default per‑item display duration. Some flows pass an explicit duration; when omitted, utilities fall back to 10s.

## models

Each key under `models` defines a model configuration used by the AI orchestrator.

- `<modelName>.apiKey` (string): API key for the provider.
- `<modelName>.baseURL` (string): Base API URL.
- `<modelName>.model` (string): Model identifier (e.g., `grok-beta`, `gpt-4o`).
- `<modelName>.availableModels` (string[], optional): Display/help only.
- `<modelName>.timeout` (number, ms): HTTP timeout for requests.
- `<modelName>.maxRetries` (number): Retry count for requests.
- `<modelName>.temperature` (number): Generation temperature.
- `<modelName>.maxTokens` (number): Token cap.
- `<modelName>.supportsFunctionCalling` (boolean): Must be true; otherwise the CLI rejects the model.

Environment variable helpers:

- Grok: `GROK_API_KEY`, `GROK_MODEL`, `GROK_API_BASE_URL`
- OpenAI: `OPENAI_API_KEY`
- Gemini: `GEMINI_API_KEY`

## browser

Optional settings used where headless/browser‑like behavior is needed.

- `browser.timeout` (number, ms): Operation timeout (default 90000).
- `browser.sanitizationLevel` ("none" | "low" | "medium" | "high" | 0‑3): Converted to numeric via `sanitizationLevelToNumber()`; invalid values are flagged during validation.

## playlist

Used for signing DP‑1 playlists.

- `playlist.privateKey` (string, Ed25519 private key in hex or base64): Used by the `sign` command. Hex may include or omit the `0x` prefix. You can also set this via `PLAYLIST_PRIVATE_KEY` in `.env`.

### Generate an Ed25519 private key

You can generate a key locally. The CLI accepts either base64 (preferred) or hex

OpenSSL (recommended):

```bash
# Base64 (preferred)
openssl genpkey -algorithm ED25519 -outform DER | base64 | tr -d '\n'

# Hex (alternative)
openssl genpkey -algorithm ED25519 -outform DER | xxd -p -c 256
```

Paste either value into `playlist.privateKey`:

- Hex example (either is valid):
  - `0xabc123...` (with prefix)
  - `abc123...` (without prefix)
- Base64 example: `uQd9m8S...==`

If you already have a base64 key and want hex, convert it:

```bash
echo -n "<BASE64_KEY>" | base64 -d | xxd -p -c 256
```

## feed

DP‑1 Feed API configuration.

- `feed.baseURLs` (string[]): Array of DP‑1 Feed Operator API v1 base URLs. The CLI queries all feeds in parallel.
- Legacy support: `feed.baseURL` (string) is still accepted and normalized to an array.
- Default: `https://feed.feralfile.com/api/v1` if not set.
- Compatibility: API v1 of the DP‑1 Feed Operator server. See the repository for endpoints and behavior: [dp1-feed](https://github.com/display-protocol/dp1-feed).

Endpoints used by the CLI:

- `GET /api/v1/playlists` (supports `limit`, `offset`, and sorting)
- `GET /api/v1/playlists/{id}`

Environment variable alternative:

```env
FEED_BASE_URLS=https://feed.feralfile.com/api/v1,https://dp1-feed-operator-api-prod.autonomy-system.workers.dev/api/v1
```

## ff1Devices

Configure devices you want to send playlists to.

- `ff1Devices.devices` (array of objects):
  - `name` (string): Friendly device label. Free‑form; pick anything memorable.
  - `host` (string): Device base URL. For LAN devices, use `http://<ip>:1111`. The device typically listens on port `1111`.

Selection rules when sending:

- If you omit `-d`, the first configured device is used.
- If you pass `-d <name>`, the CLI matches the device by `name` (exact match). If not found, you’ll see an error listing available devices.

Examples:

```bash
# Send to first device
npm run dev -- send playlist.json

# Send to a specific device by exact name
npm run dev -- send playlist.json -d "Living Room Display"
```

Minimal `config.json` example (selected fields):

```json
{
  "defaultModel": "grok",
  "models": {
    "grok": {
      "apiKey": "xai-your-api-key-here",
      "baseURL": "https://api.x.ai/v1",
      "model": "grok-beta",
      "supportsFunctionCalling": true
    }
  },
  "defaultDuration": 10,
  "playlist": {
    "privateKey": "your_ed25519_private_key_hex_or_base64_here"
  },
  "feed": {
    "baseURLs": [
      "https://feed.feralfile.com/api/v1"
    ]
  },
  "ff1Devices": {
    "devices": [
      {
        "name": "Living Room Display",
        "host": "http://192.168.1.100:1111"
      }
    ]
  }
}
```

## Security and validation

- Do not commit secrets. Keep `config.json`, `.env`, and keys out of version control.
- Validate changes regularly:

```bash
npm run dev -- config validate
```

If configuration is invalid, the CLI prints actionable errors and a non‑zero exit code.


