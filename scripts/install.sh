#!/usr/bin/env bash
set -euo pipefail

REPO="feral-file/ff1-cli"
INSTALL_DIR_DEFAULT="$HOME/.local/ff1-cli"
BIN_DIR_DEFAULT="$HOME/.local/bin"

INSTALL_DIR="${FF1_CLI_INSTALL_DIR:-$INSTALL_DIR_DEFAULT}"
BIN_DIR="${FF1_CLI_BIN_DIR:-$BIN_DIR_DEFAULT}"
VERSION="${FF1_CLI_VERSION:-latest}"
BASE_URL="${FF1_CLI_BASE_URL:-https://github.com/$REPO/releases}"

OS_RAW="$(uname -s)"
ARCH_RAW="$(uname -m)"

case "$OS_RAW" in
  Darwin)
    OS="darwin"
    ;;
  Linux)
    OS="linux"
    ;;
  *)
    echo "ff1-cli installer: unsupported OS: $OS_RAW"
    exit 1
    ;;
esac

case "$ARCH_RAW" in
  x86_64|amd64)
    ARCH="x64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    ;;
  *)
    echo "ff1-cli installer: unsupported architecture: $ARCH_RAW"
    exit 1
    ;;
esac

ASSET="ff1-cli-$OS-$ARCH.tar.gz"
CHECKSUM="$ASSET.sha256"

if [ "$VERSION" = "latest" ]; then
  DOWNLOAD_URL="$BASE_URL/latest/download/$ASSET"
  CHECKSUM_URL="$BASE_URL/latest/download/$CHECKSUM"
else
  DOWNLOAD_URL="$BASE_URL/download/v$VERSION/$ASSET"
  CHECKSUM_URL="$BASE_URL/download/v$VERSION/$CHECKSUM"
fi

WORKDIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "Downloading ff1-cli ($OS/$ARCH)..."
curl -fsSL "$DOWNLOAD_URL" -o "$WORKDIR/$ASSET"
curl -fsSL "$CHECKSUM_URL" -o "$WORKDIR/$CHECKSUM"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$WORKDIR" && sha256sum -c "$CHECKSUM")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$WORKDIR" && shasum -a 256 -c "$CHECKSUM")
else
  echo "ff1-cli installer: missing sha256sum/shasum for verification."
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
tar -xzf "$WORKDIR/$ASSET" -C "$INSTALL_DIR" --strip-components=1

ln -sf "$INSTALL_DIR/bin/ff1" "$BIN_DIR/ff1"

if ! command -v ff1 >/dev/null 2>&1; then
  echo "Installed ff1 to $BIN_DIR, but it is not on your PATH."
  echo "Add this to your shell profile: export PATH=\"$BIN_DIR:\$PATH\""
else
  echo "ff1-cli installed. Run: ff1 --help"
fi
