# Releasing Binary Assets

The curl installer downloads prebuilt binaries from GitHub Releases. Build one asset per OS/arch and upload both the archive and its `.sha256` checksum.

## Build a Release Asset (local)

```bash
./scripts/release/build-asset.sh
```

This produces:

- `release/ff1-cli-darwin-x64.tar.gz`
- `release/ff1-cli-darwin-x64.tar.gz.sha256`

The exact filename depends on the OS/arch you build on. Run the script on each target platform (macOS + Linux, x64/arm64) and upload each pair to the GitHub release.

## Environment Overrides

- `FF1_CLI_VERSION`: overrides the version label in logs
- `FF1_CLI_NODE_VERSION`: Node version to bundle (default: 20.12.2)
- `FF1_CLI_OUTPUT_DIR`: output directory (default: `./release`)
