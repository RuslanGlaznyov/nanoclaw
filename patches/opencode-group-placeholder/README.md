# Patch: per-group credential placeholder in OpenCode

## Why

OpenCode in the agent container always sends the API key `nc-opencode-token-v1`.
It is the same for all agent groups. A shared Iron Proxy cannot tell group A from group B
by this value, so it cannot swap in the key of the correct person.

With the patch, OpenCode takes the placeholder from the environment variable
`NANOCLAW_CREDENTIAL_PLACEHOLDER`. The gateway `homelab-iron-proxy` sets this variable
for each group. Without the variable, OpenCode uses the old constant. Other gateways
(OneCLI, upstream Iron Proxy) do not change.

The ChatGPT mode (`opencode-auth.ts`) does not change.

## Files

| File | Content |
|---|---|
| `patch.diff` | Change in `opencode-config.ts`: in the skill payload and in the installed copy |
| `files/container/agent-runner/src/providers/opencode-group-placeholder.test.ts` | New test |
| `check.sh` | Marker: `NANOCLAW_CREDENTIAL_PLACEHOLDER` in both files |

The payload file is changed too. Then `/update-skills` copies the changed file,
and a merge from upstream shows a git conflict if upstream changes the same lines.

## Test

```bash
cd container/agent-runner && bun test --isolate src/providers/opencode*.test.ts
```

After the patch, rebuild the agent image: `./container/build.sh build`
(or `pnpm exec tsx setup/index.ts --step container`).

## Upstream

No PR yet. It is a good PR candidate: "a gateway can set the credential placeholder for a group".
When upstream has an equal change, `patches.sh check` shows `UPSTREAM yes`.
Then delete this directory. If upstream uses a different variable name, change
`src/gateway-providers/homelab-iron-proxy.ts` to set that name.

## If patch.diff does not apply

Make the change by hand in both files: in `resolveOpenCodeInference`, use
`environment.NANOCLAW_CREDENTIAL_PLACEHOLDER?.trim() || OPENCODE_CREDENTIAL_PLACEHOLDER`
as `apiKey`. Then make a new diff:

```bash
git diff upstream/main -- .claude/skills/add-opencode/payload/container/agent-runner/src/providers/opencode-config.ts \
  > patches/opencode-group-placeholder/patch.diff
git diff -- container/agent-runner/src/providers/opencode-config.ts >> patches/opencode-group-placeholder/patch.diff
```

The second command needs the installed copy from the payload of upstream, without the patch.
