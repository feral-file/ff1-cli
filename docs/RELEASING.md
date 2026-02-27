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

- `release/ff1-cli-darwin-arm64.tar.gz` (and `.sha256`) on macOS
- `release/ff1-cli-linux-x64.tar.gz` (and `.sha256`) on Linux
- `release/ff1-cli-windows-x64.zip` (and `.sha256`) on Windows

Run the appropriate script on each target platform and upload each pair to the GitHub release.

## GitHub Actions

- **Build** (`build.yml`): Trigger manually (Actions → Build → Run workflow) or on pull requests. Builds binaries on macOS, Linux, and Windows and uploads them as workflow artifacts for download.
- **Release** (`release.yml`): Triggered when you **publish a release** (create a release from the repo Releases page, or publish an existing draft). Validates that `package.json` matches the tag, publishes to npm, builds binaries, then uploads them to that release. Pushing a tag alone does not run this; only creating/publishing a release does.

## npm Publish Requirements

- Set `NPM_TOKEN` in GitHub Actions secrets with an npm automation token.
- Ensure `package.json` version matches the release tag (e.g. tag `1.0.2` → `"version": "1.0.2"`). The release job fails fast when they differ.

## Installer Redirect

`https://feralfile.com/ff1-cli-install` should redirect to:

```
https://raw.githubusercontent.com/feral-file/ff1-cli/main/scripts/install.sh
```

The installer script then fetches the release assets from GitHub Releases.

## Environment Overrides

- `FF1_CLI_VERSION`: overrides the version label in logs
- `FF1_CLI_NODE_VERSION`: Node version to bundle (default: 20.12.2)
- `FF1_CLI_OUTPUT_DIR`: output directory (default: `./release`)
