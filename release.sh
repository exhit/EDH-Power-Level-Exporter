#!/usr/bin/env bash
# release.sh — tag a release and build the installable extension zip
#
# Usage:
#   ./release.sh          # uses version from manifest.json
#   ./release.sh 1.6.0    # overrides version in manifest.json, then releases
#
# What it does:
#   1. Reads (or sets) the version in manifest.json
#   2. Creates a git commit + tag for that version
#   3. Builds a clean zip of only the files users need
#   4. Prints next steps for uploading to GitHub Releases

set -euo pipefail

MANIFEST="manifest.json"
DIST_DIR="dist"

# ── 1. Determine version ──────────────────────────────────────────────────────
if [[ $# -ge 1 ]]; then
  NEW_VERSION="$1"
  # Write it into manifest.json
  # Use python for reliable JSON editing without a dependency on jq
  python3 - "$MANIFEST" "$NEW_VERSION" << 'PYEOF'
import sys, json
path, version = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data['version'] = version
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
print(f"Set manifest.json version → {version}")
PYEOF
else
  NEW_VERSION=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['version'])")
fi

TAG="v${NEW_VERSION}"

echo "→ Version: ${NEW_VERSION}  (tag: ${TAG})"

# ── 2. Git: commit manifest change (if any) + tag ────────────────────────────
if ! git diff --quiet "$MANIFEST"; then
  git add "$MANIFEST"
  git commit -m "chore: bump version to ${NEW_VERSION}"
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "⚠  Tag ${TAG} already exists — skipping tag creation"
else
  git tag -a "$TAG" -m "Release ${TAG}"
  echo "✓  Created tag ${TAG}"
fi

# ── 3. Build clean zip (only files the extension needs) ──────────────────────
mkdir -p "$DIST_DIR"
ZIP_NAME="${DIST_DIR}/edh-powerlevel-exporter-${NEW_VERSION}.zip"

# Remove any previous build for this version
rm -f "$ZIP_NAME"

# Only include files that Chrome actually loads — no git history, no scripts,
# no editor files, no dist folder itself
zip -r "$ZIP_NAME" \
  manifest.json \
  popup.html \
  popup.js \
  background.js \
  icons/ \
  src/ \
  --exclude "*.DS_Store" \
  --exclude "*/.gitkeep"

echo "✓  Built ${ZIP_NAME}"
ls -lh "$ZIP_NAME"

# ── 4. Next steps ─────────────────────────────────────────────────────────────
echo ""
echo "Next steps:"
echo "  git push && git push --tags"
echo "  Then upload ${ZIP_NAME} to:"
echo "  https://github.com/YOUR_USERNAME/edh-powerlevel-exporter/releases/new?tag=${TAG}"
