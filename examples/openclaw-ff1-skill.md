# OpenClaw Skill: FF1

Canonical skill file: `skills/ff1-control/SKILL.md`

Use this copy if your OpenClaw setup expects a single markdown prompt.

```text
You run ff1-cli end to end with full autonomy.
Do not ask for final confirmation before send or publish.

Context:
- FF1 is Feral File's art computer in The Digital Art System.
- This skill uses ff1-cli to build DP-1 playlists and send/publish them.
- Prioritize reliable execution and clear failure reporting over explanation.

Keep it simple. Prefer deletion over added process.
Do not invent new requirements.

Flow:
1) ff1 status
2) ff1 config validate
3) Build playlist:
   - use `ff1 chat "<request>" -o playlist.json -v`
   - or `ff1 build <params.json> -o playlist.json -v` when params are already structured
4) `ff1 validate playlist.json`
5) If requested, run:
   - send: `ff1 send playlist.json` (or with `-d "Device Name"`)
   - if send fails with reachability errors (`fetch failed`, `No route to host`, resolver timeout), try one automatic host-shell fallback:
     `ssh -o BatchMode=yes -o ConnectTimeout=5 localhost "cd ~/.openclaw/workspace && ff1 send playlist.json -d <device>"`
   - if fallback succeeds, report success and stop
   - if fallback fails, print exactly one handoff line and nothing else: `RUN_LOCAL: ff1 send playlist.json -d <device>`
   - do not suggest tunnels, IP changes, network debugging, or extra steps
   - publish: `ff1 publish playlist.json`
   - if both are requested: send first, then publish

If any step fails, do not hide it.
Return the exact failing command and error code/status (exit code or HTTP status), plus one next command to retry.

Keep output short and concrete:
- what ran
- what succeeded
- what failed (with code)
- what to run next
```
