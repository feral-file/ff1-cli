# Examples

Copy‑pasteable commands that work with the current CLI.

## Setup

```bash
npm install
npm run dev -- config init
npm run dev -- config validate
```

## Natural Language

```bash
# Interactive chat
npm run dev chat

# One-shot requests
npm run dev -- chat "Get tokens 1,2,3 from Ethereum contract 0xabc" -o playlist.json
npm run dev -- chat "Get token 42 from Tezos contract KT1abc"
npm run dev -- chat "Get 3 items from Social Codes and 2 from 0xdef" -v

# Switch model
npm run dev -- chat "your request" --model grok
npm run dev -- chat "your request" --model chatgpt
npm run dev -- chat "your request" --model gemini
```

## Deterministic Build (no AI)

```bash
# From file
npm run dev -- build examples/params-example.json -o playlist.json

# From stdin
cat examples/params-example.json | npm run dev -- build -o playlist.json
```

## AI‑Orchestrated Deterministic Flow (prompts)

```bash
# Show tool‑call progress and validation
npm run dev -- chat "Build a playlist of my Tezos works from address tz1... plus 3 from Social Codes" -v -o playlist.json

# Switch model if desired
npm run dev -- chat "Build playlist from Ethereum address 0x... and 2 from Social Codes" --model chatgpt -v
```

### One‑shot complex prompt

The CLI can parse rich requests and do it all in one go: fetch, build a DP‑1 playlist, shuffle, set durations, and send to a named device.

```bash
# Example: combine sources, shuffle, set 6s per item, and send to device
npm run dev -- chat "Get tokens 1,2 from contract 0xabc and token 42 from KT1xyz; shuffle; 6 seconds each; send to 'Living Room Display'." -o playlist.json -v
```

## Validate / Sign / Send

```bash
# Validate playlist
npm run dev -- validate playlist.json

# Sign playlist
npm run dev -- sign playlist.json -o signed.json

# Send to device
npm run dev -- send playlist.json -d "Living Room Display"
```

## Troubleshooting

```bash
# Show current configuration
npm run dev -- config show

# Reinitialize config
npm run dev -- config init
```


