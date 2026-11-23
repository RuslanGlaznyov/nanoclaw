#!/usr/bin/env bash
# check.sh <work|upstream>: exit 0 when OpenCode reads the group placeholder.
# work checks the skill payload and the installed copy; upstream checks the payload on main.
set -euo pipefail
. "$HOMELAB_PATCH_LIB"
marker='NANOCLAW_CREDENTIAL_PLACEHOLDER'
payload=.claude/skills/add-opencode/payload/container/agent-runner/src/providers/opencode-config.ts
installed=container/agent-runner/src/providers/opencode-config.ts
has_marker "$1" upstream/main "$payload" "$marker"
if [ "$1" = work ]; then
  has_marker work - "$installed" "$marker"
fi
