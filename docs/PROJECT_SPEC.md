# FF1-CLI Project Spec

This document defines the current product role, boundaries, and constraints for `ff1-cli`.

It is based on the code in this repository and the current Feral File architecture, operations, reference, and strategy context as of March 17, 2026. It should be used as the planning entry point for substantial changes.

## Why this doc exists

- Give future contributors and coding agents a stable current-state spec before implementation starts.
- Make the CLI's role in the broader FF1 and DP-1 system explicit.
- Record the constraints that should shape changes even when the codebase is refactored.

## Product summary

- Project: `ff1-cli`
- Type: Node.js CLI
- System role: a control and integration surface for FF1 and DP-1 workflows
- Primary purpose: turn user intent or structured parameters into valid DP-1 playlists, then verify, sign, publish, and send them through the canonical FF1 path

In the Feral File architecture bands, `ff1-cli` sits primarily in the presentation and control layer. It is not the canonical source of truth for exhibitions, ownership, device runtime, or protocol evolution. It is a practical operator and developer surface that bridges those systems.

## Strategic role

The CLI supports the broader Feral File goal of making it effortless to live with digital art every day.

Its value is reducing friction in the publish-to-play path:

- assemble playlists quickly
- keep outputs DP-1 conformant
- make FF1 playback and feed publishing easier to exercise
- provide deterministic tooling around model-assisted workflows

The CLI should strengthen the Gold Path, not invent a parallel product model.

## Users and primary use cases

Current likely users:

- internal engineers working on FF1, DP-1, feed, and device flows
- operators and launch teammates validating publish-to-play behavior
- advanced users or partners building and testing playlists
- developers using the CLI as a reference implementation for DP-1 and FF1 command flows

Primary use cases:

- build a playlist from structured JSON inputs
- build a playlist from natural-language prompts using model orchestration plus deterministic tools
- validate or verify a local or hosted DP-1 playlist
- sign a playlist with an Ed25519 key
- publish a validated playlist to a configured feed server
- send a playlist or direct media URL to a configured FF1 device
- manage local config and FF1 SSH access
- exercise compatibility checks against FF1 OS versions before risky commands

## Domain language

Use these terms consistently:

- `FF1`
- `FF1 device`
- `DP-1`
- `DP-1 envelope`
- `DP-1 conformance`
- `computational art playlist`
- `channel endorsement`
- `feed server`
- `playlist`
- `work`

## Product goals

The current code and internal context imply these practical goals:

- Make playlist creation and playback testing fast enough for daily use.
- Keep the path from intent to valid DP-1 output deterministic and inspectable.
- Preserve openness by relying on DP-1 as the compatibility layer instead of a CLI-specific format.
- Support FF1 as the reference playback target without making correctness depend on proprietary-only infrastructure.
- Serve as a reference surface for publish, verify, and play flows used elsewhere in the Feral File stack.

## Non-goals

`ff1-cli` should not become:

- the source of truth for exhibitions, channels, or artwork metadata
- the source of truth for ownership, passkeys, rights, or trust registry state
- a replacement for the mobile app as the primary user-facing controller
- a place to define new DP-1 protocol semantics by convenience
- a long-running backend service with hidden state

## Current system responsibilities

Based on the code today, the CLI is responsible for:

- loading configuration from `config.json`, `.env`, and defaults, with `config.json` taking precedence
- parsing natural-language requests into structured playlist requirements and settings
- orchestrating tool calls for feed fetches, address queries, contract-based NFT queries, domain resolution, playlist building, verification, publishing, and sending
- supporting a deterministic non-AI build path from structured JSON
- building DP-1 playlist envelopes from NFT metadata or direct media URLs
- validating and verifying playlist structure and signatures
- signing playlists when a private key is configured
- publishing validated playlists to configured feed servers
- discovering configured FF1 devices and sending playlists or direct media playback requests
- performing FF1 OS compatibility preflight checks before display and SSH flows

## Architecture boundaries

### What the CLI owns

- command-line UX and command routing
- local config loading and validation
- intent parsing and orchestration glue
- deterministic playlist assembly, verification, and signing helpers
- device and feed integration calls from the client side

### What the CLI depends on but does not own

- DP-1 protocol shape and evolution
- feed server behavior and data persistence
- FF1 runtime and OS behavior
- ownership and identity systems
- trust-path policy, licensing policy, and key registry policy

### Boundary rules

- The CLI may assemble, validate, and transmit DP-1 objects, but it should not silently fork the protocol.
- The CLI may call feed and device endpoints, but it should not become their compatibility abstraction layer of last resort.
- The CLI may use models for orchestration, but deterministic utilities remain the source of truth for output correctness.
- Trust-sensitive correctness must stay vendor-neutral and portable. The CLI can use cloud APIs for model orchestration, but the trust path cannot depend on cloud-specific guarantees.

## Functional shape

Today the CLI groups into these workflow areas:

### Setup and configuration

- `setup`
- `status`
- `config init|show|validate`

### Build and orchestration

- `chat`
- `build`

### DP-1 output integrity

- `verify`
- `validate`
- `sign`

### Delivery

- `send`
- `play`
- `publish`

### Device operations

- `ssh enable|disable`

## Deterministic-first behavior

The CLI supports model-assisted workflows, but the implementation posture should remain deterministic-first:

- models interpret intent
- utilities perform the real data fetching, playlist building, validation, signing, and delivery work
- invalid or malformed outputs should fail validation rather than being accepted because they were model-produced

## Trust, protocol, and rights assumptions

Important constraints from the broader FF system:

- DP-1 should evolve additively and remain forward-compatible where practical.
- Trust-path correctness must remain portable and key-controlled.
- Ownership and stewardship should not be confused with access gating in the CLI.
- The CLI may surface signatures, verification, and publishing, but it should not absorb licensing or identity policy that belongs elsewhere in the system.

## Reliability expectations

- reliability matters more than novelty
- the publish-to-play path should stay simple and testable
- the CLI should help prove the path from canonical JSON to FF1 playback
- compatibility checks should fail clearly when a target FF1 device cannot safely handle a command

## Code and design constraints

- behavior changes should follow a spec-driven, test-first workflow when practical
- TypeScript is preferred for new or updated source
- comments should preserve durable maintenance context when the code encodes non-obvious design choices, trade-offs, invariants, or external constraints
- docs should be updated when user-facing behavior changes
- legacy compatibility paths should not be preserved unless explicitly required

## Verification expectations

The current repo verification path is:

```bash
npm run lint:fix
npm test
npm run build
GROK_API_KEY=dummy node dist/index.js validate examples/sample-playlist.json
GROK_API_KEY=dummy node dist/index.js config validate
```

## Open questions

- Which CLI commands are considered stable public interface versus internal reference tooling?
- How much of the feed and trust workflow should remain directly exposed in the CLI?
- Which FF1 operations deserve stronger compatibility policies or broader smoke coverage?
- How much of the mobile app's long-term control model should also be mirrored in CLI form?
