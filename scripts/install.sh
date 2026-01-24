#!/usr/bin/env bash
set -e

PACKAGE="ff1-cli"
PREFIX_DEFAULT="$HOME/.local"
PREFIX="${FF1_CLI_PREFIX:-$PREFIX_DEFAULT}"

if ! command -v node >/dev/null 2>&1; then
  echo "ff1-cli installer: Node.js is required but was not found."
  echo "Install Node.js from https://nodejs.org/ and re-run this command."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ff1-cli installer: npm is required but was not found."
  echo "Install npm with Node.js and re-run this command."
  exit 1
fi

echo "Installing $PACKAGE..."

if npm install -g "$PACKAGE"; then
  echo "Installed $PACKAGE. Run: ff1 --help"
  exit 0
fi

echo "Global install failed. Trying local prefix: $PREFIX"

if npm install -g --prefix "$PREFIX" "$PACKAGE"; then
  echo "Installed $PACKAGE to $PREFIX."
  echo "Add to PATH: export PATH=\"$PREFIX/bin:\$PATH\""
  echo "Then run: ff1 --help"
  exit 0
fi

echo "Installation failed. You may need sudo or a writable npm prefix."
echo "Try: npm install -g --prefix \"$PREFIX\" $PACKAGE"
exit 1
