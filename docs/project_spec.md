# FF1-CLI Project Spec

This document is the placeholder project spec for `ff1-cli`.

It exists so future agentic coding sessions have a stable location for system intent, constraints, and open design decisions before implementation begins.

## Why this doc exists

- Give future contributors and coding agents a canonical planning entry point.
- Record the current project purpose and domain language.
- Reserve architecture and API design sections for the repo owner to define later.

## Project summary

- Project: `ff1-cli`
- Type: Node.js CLI
- Primary purpose: build, validate, sign, publish, and send DP-1 playlists for FF1 workflows
- Current status: `TBD by repo owner`

## Domain language

Use these terms consistently:

- `FF1`
- `DP-1 envelope`
- `DP-1 conformance`
- `computational art playlist`
- `channel endorsement`
- `FF1 device`

## Users and use cases

`TBD by repo owner`

## Product goals

`TBD by repo owner`

## Non-goals

`TBD by repo owner`

## Current system responsibilities

At a high level, the CLI currently appears responsible for:

- validating DP-1 playlists
- building playlists from deterministic inputs
- orchestrating model-assisted playlist workflows
- signing and publishing playlists
- interacting with FF1 devices

This section should be refined by the repo owner as the source of truth evolves.

## Architecture boundaries

`TBD by repo owner`

## API design rules

`TBD by repo owner`

## Invariants and constraints

Known repo-level constraints today:

- config precedence is `config.json` over `.env` over defaults
- behavior changes should follow a spec-driven, test-first workflow when practical
- comments should preserve durable design context when the code carries non-obvious trade-offs or constraints

Additional product and runtime invariants: `TBD by repo owner`

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

- What architectural boundaries should be treated as stable?
- What API design rules should remain uniform across commands and utilities?
- Which flows are considered user-critical versus internal implementation detail?
- Which behaviors require stronger regression coverage?

## Owner fill-in checklist

- replace all `TBD by repo owner` sections
- add product goals and non-goals
- define architecture boundaries
- define API design rules
- record critical invariants that future agents must preserve
