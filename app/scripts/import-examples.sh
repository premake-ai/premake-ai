#!/usr/bin/env bash
# Refresh app/examples from a Premake studio's data folder (its examples/ and showcase/). Safe to re-run.
#   app/scripts/import-examples.sh <studio-data-dir>
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <studio-data-dir>" >&2; exit 2; }
exec node "$(dirname "$0")/import-examples.js" "$@"
