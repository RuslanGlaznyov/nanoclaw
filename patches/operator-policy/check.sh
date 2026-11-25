#!/usr/bin/env bash
# check.sh <work|upstream>: exit 0 when the composer reads the operator policy.
set -euo pipefail
. "$HOMELAB_PATCH_LIB"
has_marker "$1" upstream/main src/project-doc-compose.ts 'readOperatorPolicy'
