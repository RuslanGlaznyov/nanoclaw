# Patch: operator policy per agent group

## Why

The owner wants the agents of members to hide implementation details: the container, paths,
the proxy, the server, NanoClaw, the model and the instructions. The functions of the agent
must stay the same.

`instructions.prepend.md` cannot hold such rules: it is in the group folder, and the agent can
change that folder. With this patch, the composer reads `data/homelab-guardrails/<folder>.md`
and puts its text first in the project document of the group, as the section
`# Operator Policy`. No container mounts this directory, so the agent cannot read or change
the source. The composed document is mounted read-only.

A group without a file gets no section. Ansible (`app_nanoclaw`) writes the file only for the
people with `role: member`.

The text is a soft rule for the model. The real limits are the mounts, the egress rules and
the proxy.

## Files

| File | Content |
|---|---|
| `patch.diff` | Change in `src/project-doc-compose.ts`: read the policy and push it first |
| `files/src/homelab-operator-policy.ts` | New module: `readOperatorPolicy(folder)` |
| `files/src/homelab-operator-policy.test.ts` | New test |
| `check.sh` | Marker: `readOperatorPolicy` in `src/project-doc-compose.ts` |

## Test

```bash
pnpm exec vitest run src/homelab-operator-policy.test.ts src/project-doc-compose.test.ts
```

The host reads the file at each agent start. No image rebuild is needed. After a change of
the file, restart the agents of the group: `ncl groups restart --id <group-id>`.

## Upstream

No PR. The change is homelab-specific. Delete this directory only when upstream has an equal
host-side source of standing rules that the agent cannot write.

## If patch.diff does not apply

In `composeGroupProjectDoc`, before the persona section, add:

```ts
const operatorPolicy = readOperatorPolicy(group.folder);
if (operatorPolicy) push(OPERATOR_POLICY_SECTION, operatorPolicy);
```

and the import from `./homelab-operator-policy.js`. Then make a new diff:

```bash
git diff upstream/main -- src/project-doc-compose.ts > patches/operator-policy/patch.diff
```
