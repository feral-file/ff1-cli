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


### Natural‑language one‑shot examples (proven)

- **ETH contract + token IDs (shuffle/mix, generic device)**
  - Format:
    ```bash
    npm run dev -- chat "Compose a playlist from Ethereum contract <0x...> with tokens <id> and <id>; [shuffle|mix]; [send to device|send to '<device>']" -o <output.json> -v
    ```
  - Example:
    ```bash
    npm run dev -- chat "Compose a playlist from Ethereum contract 0xb932a70A57673d89f4acfFBE830E8ed7f75Fb9e0 with tokens 52932 and 52457; mix them up; send to device" -o playlist-eth.json -v
    ```

- **TEZ contract + token IDs (shuffle, named device)**
  - Format:
    ```bash
    npm run dev -- chat "Build a playlist from Tezos contract <KT1...> with tokens <id> and <id>; shuffle; send to '<device>'" -o <output.json> -v
    ```
  - Example:
    ```bash
    npm run dev -- chat "Build a playlist from Tezos contract KT1BcNnzWze3vCviwiETYNwcFSwjv6RihZEQ with tokens 22 and 8; shuffle; send to 'Living Room'" -o playlist-tez.json -v
    ```

- **Owner address (ENS → ETH), shuffled**
  - Format:
    ```bash
    npm run dev -- chat "Create a playlist from address <ens> (<n> items); [shuffle|mix]; [send/push to my device]" -o <output.json> -v
    ```
  - Example:
    ```bash
    npm run dev -- chat "Create a playlist from address reas.eth (5 items); shuffle; push to my device" -o playlist-ens.json -v
    ```

- **Owner address (Tezos tz1), shuffled**
  - Format:
    ```bash
    npm run dev -- chat "Create a playlist from Tezos address <tz1...> (<n> items); [shuffle|mix]; [send to device]" -o <output.json> -v
    ```
  - Example:
    ```bash
    npm run dev -- chat "Create a playlist from Tezos address tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb (3 items); mix them up; send to device" -o playlist-tz1.json -v
    ```

- **Feed playlists (named), shuffled**
  - Format:
    ```bash
    npm run dev -- chat "[Create|Build] a playlist from feed '<name>' (<n> items); shuffle; [send to device]" -o <output.json> -v
    ```
  - Examples:
    ```bash
    npm run dev -- chat "Create a playlist from feed 'Unsupervised' (3 items); shuffle; send to device" -o playlist-feed1.json -v
    npm run dev -- chat "Build a playlist from feed 'Social Codes' (3 items); shuffle; send to device" -o playlist-feed2.json -v
    ```

- **Mixed in one prompt (ETH + TEZ + feed + ENS), shuffled, named device**
  - Format:
    ```bash
    npm run dev -- chat "Compose a playlist: Tezos <KT1...> tokens <id>, <id>; Ethereum <0x...> tokens <id>, <id>; <n> from '<feed>'; <m> from <ens>; shuffle; send to '<device>'" -o <output.json> -v
    ```
  - Example:
    ```bash
    npm run dev -- chat "Compose a playlist: Tezos KT1BcNnzWze3vCviwiETYNwcFSwjv6RihZEQ tokens 22, 8; Ethereum 0xb932a70A57673d89f4acfFBE830E8ed7f75Fb9e0 tokens 52932, 52457; 3 from 'Unsupervised'; 1 from reas.eth; shuffle; send to 'Living Room'" -o playlist-mixed.json -v
    ```

- **Multiple instructions in one prompt (incremental), shuffled**
  - Format:
    ```bash
    npm run dev -- chat "Create a playlist from Ethereum contract <0x...> tokens <id>, <id>; then add <n> from '<feed>'; then add <m> from <ens>; shuffle; [send/push to my device]" -o <output.json> -v
    ```
  - Example:
    ```bash
    npm run dev -- chat "Create a playlist from Ethereum contract 0xb932a70A57673d89f4acfFBE830E8ed7f75Fb9e0 tokens 52932, 52457; then add 2 from 'Social Codes'; then add 1 from reas.eth; shuffle; push to my device" -o playlist-multi.json -v
    ```

- **Synonym variants for the same ETH case**
  - Format:
    ```bash
    npm run dev -- chat "[Build|Create|Compose] a playlist from Ethereum contract <0x...> tokens <id> and <id>; send to device" -o <output.json> -v
    ```
  - Examples:
    ```bash
    npm run dev -- chat "Build a playlist from Ethereum contract 0xb932a70A57673d89f4acfFBE830E8ed7f75Fb9e0 tokens 52932 and 52457; send to device" -o playlist-eth-build.json -v
    npm run dev -- chat "Create a playlist from Ethereum contract 0xb932a70A57673d89f4acfFBE830E8ed7f75Fb9e0 tokens 52932 and 52457; send to device" -o playlist-eth-create.json -v
    ```

- **Device targeting: generic vs named**
  - Format:
    ```bash
    npm run dev -- chat "Compose a playlist from <ens/address> (<n> items); send to device" -o <output.json> -v
    npm run dev -- chat "Compose a playlist from <ens/address> (<n> items); send to '<device>'" -o <output.json> -v
    ```
  - Examples:
    ```bash
    npm run dev -- chat "Compose a playlist from reas.eth (3 items); send to device" -o playlist-generic-device.json -v
    npm run dev -- chat "Compose a playlist from reas.eth (3 items); send to 'Living Room'" -o playlist-named-device.json -v
    ```