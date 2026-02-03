#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT_DIR="${FF1_CLI_OUTPUT_DIR:-$ROOT_DIR/release}"
NODE_VERSION="${FF1_CLI_NODE_VERSION:-20.12.2}"
VERSION="${FF1_CLI_VERSION:-$(node -p "require('$ROOT_DIR/package.json').version")}"

OS_RAW="$(uname -s)"
ARCH_RAW="$(uname -m)"

case "$OS_RAW" in
  Darwin)
    OS="darwin"
    NODE_OS="darwin"
    ;;
  Linux)
    OS="linux"
    NODE_OS="linux"
    ;;
  *)
    echo "Unsupported OS: $OS_RAW"
    exit 1
    ;;
esac

case "$ARCH_RAW" in
  x86_64|amd64)
    ARCH="x64"
    NODE_ARCH="x64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    NODE_ARCH="arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH_RAW"
    exit 1
    ;;
esac

ASSET_NAME="ff1-cli-$OS-$ARCH"
ARCHIVE_NAME="$ASSET_NAME.tar.gz"

WORKDIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "Building ff1-cli bundle..."
cd "$ROOT_DIR"
npm ci
npm run bundle

NODE_ARCHIVE="node-v$NODE_VERSION-$NODE_OS-$NODE_ARCH.tar.gz"
NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/$NODE_ARCHIVE"

echo "Downloading Node.js $NODE_VERSION ($NODE_OS/$NODE_ARCH)..."
curl -fsSL "$NODE_URL" -o "$WORKDIR/$NODE_ARCHIVE"
tar -xzf "$WORKDIR/$NODE_ARCHIVE" -C "$WORKDIR"

PACKAGE_DIR="$WORKDIR/$ASSET_NAME"
mkdir -p "$PACKAGE_DIR/bin" "$PACKAGE_DIR/lib" "$PACKAGE_DIR/node/bin"

cp "$ROOT_DIR/dist/ff1.js" "$PACKAGE_DIR/lib/ff1.js"
cp "$WORKDIR/node-v$NODE_VERSION-$NODE_OS-$NODE_ARCH/bin/node" "$PACKAGE_DIR/node/bin/node"
cp "$ROOT_DIR/package.json" "$PACKAGE_DIR/package.json"
cp "$ROOT_DIR/LICENSE" "$PACKAGE_DIR/LICENSE"

cat > "$PACKAGE_DIR/bin/ff1" <<'EOF'
#!/usr/bin/env bash
set -e
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$BASE_DIR/node/bin/node"
APP="$BASE_DIR/lib/ff1.js"
exec "$NODE" "$APP" "$@"
EOF

chmod +x "$PACKAGE_DIR/bin/ff1"

mkdir -p "$OUTPUT_DIR"
tar -czf "$OUTPUT_DIR/$ARCHIVE_NAME" -C "$WORKDIR" "$ASSET_NAME"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && sha256sum "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && shasum -a 256 "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256")
else
  echo "Missing sha256sum/shasum for checksum generation"
  exit 1
fi

echo "Built $ARCHIVE_NAME (version $VERSION) in $OUTPUT_DIR"
