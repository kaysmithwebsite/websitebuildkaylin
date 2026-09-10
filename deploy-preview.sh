#!/usr/bin/env bash
# Builds a review copy and deploys it to Netlify as a draft.
#
#   ./deploy-preview.sh            first run: creates the site and links it
#   ./deploy-preview.sh --prod     publish to the site's production URL
#
# A preview build marks every page noindex and has robots.txt disallow
# everything, because it carries demo listings, unverified figures and draft
# articles. Do not remove those guards to "test SEO".
set -euo pipefail
cd "$(dirname "$0")"

echo "Building preview..."
python3 build.py --preview

echo "Auditing..."
python3 audit.py
python3 antiai_audit.py

if ! command -v netlify >/dev/null 2>&1; then
  echo
  echo "The Netlify CLI is not installed. Either:"
  echo "  npm install -g netlify-cli     (needs Node)"
  echo "  or drag the dist/ folder onto https://app.netlify.com/drop"
  exit 1
fi

if [ "${1:-}" = "--prod" ]; then
  netlify deploy --dir=dist --prod
else
  netlify deploy --dir=dist
fi
