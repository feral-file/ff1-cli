#!/usr/bin/env bash
# Atomic release cutter: bump version, push tag, create GitHub Release.
# Usage: ./scripts/release/cut-release.sh <patch|minor|major|x.y.z>
#
# Three releases (1.0.13–1.0.15) silently failed to publish to npm because
# tags were pushed without the corresponding GitHub Release that triggers
# the publish workflow. This script makes the three steps atomic.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <patch|minor|major|x.y.z>" >&2
  exit 2
fi

BUMP="$1"

# Refuse to cut from anywhere but a clean main checked out at origin/main.
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo "error: must be on main, currently on '$BRANCH'" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty; commit or stash first" >&2
  exit 1
fi

git fetch origin main --tags
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "error: local main ($LOCAL) is not at origin/main ($REMOTE); pull or push first" >&2
  exit 1
fi

# Verify locally before cutting anything.
echo "==> Running verify"
npm run verify

# `npm version` updates package.json + package-lock.json, commits, and tags.
# .npmrc pins `tag-version-prefix=` so the tag matches this repo's existing
# unprefixed history (e.g. `1.0.17`, not `v1.0.17`).
echo "==> Bumping version ($BUMP)"
NEW_VERSION="$(npm version "$BUMP" -m "chore(release): %s")"
NEW_VERSION="${NEW_VERSION#v}"
TAG="$NEW_VERSION"
# Belt-and-braces: if .npmrc was overridden and npm tagged with a v prefix,
# rename the local tag to the unprefixed form before pushing.
if git rev-parse "v$NEW_VERSION" >/dev/null 2>&1 && ! git rev-parse "$NEW_VERSION" >/dev/null 2>&1; then
  git tag "$NEW_VERSION" "v$NEW_VERSION"
  git tag -d "v$NEW_VERSION"
fi

echo "==> Pushing commit and tag $TAG"
git push origin main
git push origin "$TAG"

echo "==> Creating GitHub Release $TAG (this triggers the publish workflow)"
NOTES_FILE="$(mktemp)"
trap 'rm -f "$NOTES_FILE"' EXIT
{
  echo "## Changes"
  echo
  PREV_TAG="$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || true)"
  if [ -n "$PREV_TAG" ]; then
    git log --no-merges --pretty='format:- %s' "$PREV_TAG..$TAG^"
  else
    git log --no-merges --pretty='format:- %s' "$TAG^"
  fi
  echo
} > "$NOTES_FILE"

gh release create "$TAG" --title "$TAG" --notes-file "$NOTES_FILE"

echo
echo "==> Done. $TAG is published."
echo "    Watch: gh run list --workflow release.yml --limit 1"
