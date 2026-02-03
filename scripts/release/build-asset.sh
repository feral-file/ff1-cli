#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT_DIR="${FF1_CLI_OUTPUT_DIR:-$ROOT_DIR/release}"
VERSION="${FF1_CLI_VERSION:-$(node -p "require('$ROOT_DIR/package.json').version")}"

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
    echo "Unsupported OS: $OS_RAW"
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

PACKAGE_DIR="$WORKDIR/$ASSET_NAME"
mkdir -p "$PACKAGE_DIR/bin" "$PACKAGE_DIR/lib"

cp "$ROOT_DIR/dist/ff1.js" "$PACKAGE_DIR/lib/ff1.js"
cp "$ROOT_DIR/package.json" "$PACKAGE_DIR/package.json"
cp "$ROOT_DIR/LICENSE" "$PACKAGE_DIR/LICENSE"

cat > "$PACKAGE_DIR/bin/ff1" <<'EOF'
#!/usr/bin/env bash
set -e
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$BASE_DIR/lib/ff1.js"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required. Install Node.js, then run this command again."
  exit 1
fi
exec node "$APP" "$@"
EOF

chmod +x "$PACKAGE_DIR/bin/ff1"

cat > "$PACKAGE_DIR/RUNTIME_REQUIREMENTS.txt" <<'EOF'
Runtime requirement:
- Node.js 22 or newer must be installed and available in PATH.

Verify:
- node -v

Run:
- ./bin/ff1 --help
EOF

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
