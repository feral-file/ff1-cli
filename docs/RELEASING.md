# Releasing Binary Assets

The curl installer downloads prebuilt binaries from GitHub Releases. Build one asset per OS/arch and upload both the archive and its `.sha256` checksum.

## Build a Release Asset (local)

**macOS / Linux:**

```bash
./scripts/release/build-asset.sh
```

**Windows (PowerShell):**

```powershell
.\scripts\release\build-asset-windows.ps1
```

This produces (names vary by OS/arch):

- `release/ff-cli-darwin-arm64.tar.gz` (and `.sha256`) on macOS
- `release/ff-cli-linux-x64.tar.gz` (and `.sha256`) on Linux
- `release/ff-cli-windows-x64.zip` (and `.sha256`) on Windows

Run the appropriate script on each target platform and upload each pair to the GitHub release.

## GitHub Actions

- **Build** (`build.yml`): Trigger manually (Actions → Build → Run workflow) or on pull requests. Builds binaries on macOS, Linux, and Windows and uploads them as workflow artifacts for download.
- **Release** (`release.yml`): On **published** GitHub Releases, validates that `package.json` matches the tag, publishes to npm, then builds binaries and uploads assets. A GitHub Release marked as a pre-release publishes to the **`beta`** dist-tag; the version must also contain `beta`. A manual workflow dispatch can also publish a beta version when you need to bypass the normal release flow, but run it from `main`.

## npm Publish Requirements

- Set `NPM_TOKEN` in GitHub Actions secrets with an npm automation token.
- Ensure `package.json` version matches the release tag (e.g. tag `1.0.2` → `"version": "1.0.2"`). The release job fails fast when they differ.
- A **regular** (non-prerelease) GitHub Release publishes with the default dist-tag **`latest`**.
- A GitHub Release marked **Set as a pre-release** publishes to the **`beta`** dist-tag, and its version must contain `beta` so the package version stays aligned with the beta channel.
- Manual workflow dispatch runs publish to the **`beta`** dist-tag too, and the `version` input must contain `beta`, match `package.json`, and be dispatched from `main`.

## Release notes and breaking changes

GitHub Release text (and any user-facing summary you publish with the version) should state compatibility changes in plain language. **Do not rely on `package.json` `engines` alone**; npm and installers surface it inconsistently, and operators skim release notes first.

### Node.js engine floor (breaking)

`package.json` declares `"engines": { "node": ">=22" }`. Raising the floor from Node 18 (or 20) is a **breaking change** for:

- global installs and `npx ff-cli` on older runtimes
- CI jobs and images pinned to Node 18 or 20
- anyone developing from source without upgrading Node

**For the release that first ships this requirement**, copy or adapt the following into the GitHub Release description (and repeat in the upgrade section of internal comms if needed):

> **Breaking — Node.js:** ff-cli now requires **Node.js 22 or newer** (`package.json` `engines`). Node 18 and Node 20 are no longer supported. Upgrade Node on your machines and in CI, or stay on an older ff-cli version until you can migrate.

Later releases only need to repeat this block if the engine floor changes again.

## Installer Redirect

`https://feralfile.com/ff-cli-install` should redirect to:

```
https://raw.githubusercontent.com/feral-file/ff-cli/main/scripts/install.sh
```

The installer script then fetches the release assets from GitHub Releases.

## Environment Overrides

- `FF_CLI_VERSION`: overrides the version label in logs
- `FF_CLI_NODE_VERSION`: Reserved in script headers for future use; current CI, npm `engines`, and release wrappers assume **Node.js 22+** (required by `dp1-js`).
- `FF_CLI_OUTPUT_DIR`: output directory (default: `./release`)
