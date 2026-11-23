#!/usr/bin/env bash
# check.sh <work|upstream>: exit 0 when Telegram topics are already in the code.
# The adapter lives on the upstream `channels` branch, not on main.
set -euo pipefail
. "$HOMELAB_PATCH_LIB"
has_marker "$1" upstream/channels src/channels/telegram.ts 'normalizeTopicThreadId'
