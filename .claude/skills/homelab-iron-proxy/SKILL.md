---
name: homelab-iron-proxy
description: Install or refresh the homelab Iron Proxy gateway. Use when this NanoClaw copy must send agent traffic through the external, shared Iron Proxy that ansible-homelab runs, with one placeholder per agent group. It does not install or run a proxy.
---

# Homelab Iron Proxy gateway

This gateway connects agent groups to an Iron Proxy that runs outside this install.
Ansible (repository `ansible-homelab`) owns the proxy, the keys, and the placeholders.
NanoClaw never sees a key. Each agent group gets:

- the address of its proxy instance in `HTTP_PROXY` and `HTTPS_PROXY`;
- the CA certificate of the proxy, mounted read-only;
- the placeholder of its agent in `NANOCLAW_CREDENTIAL_PLACEHOLDER`.

The proxy swaps the placeholder for the key of that agent. A group that is not in
the routes file does not start. There is no fallback to open egress.

OpenCode must read `NANOCLAW_CREDENTIAL_PLACEHOLDER`. The local patch
`patches/opencode-group-placeholder` adds this. Without the patch, all groups send
the same placeholder and the proxy cannot tell them apart.

## Install the provider payload

Copy the adapter, its test, and the agent guidance into their normal NanoClaw paths.

```nc:copy
payload/src/gateway-providers/homelab-iron-proxy.ts -> src/gateway-providers/homelab-iron-proxy.ts
payload/src/gateway-providers/homelab-iron-proxy.test.ts -> src/gateway-providers/homelab-iron-proxy.test.ts
payload/container/skills/homelab-iron-proxy-gateway/SKILL.md -> container/skills/homelab-iron-proxy-gateway/SKILL.md
payload/container/skills/homelab-iron-proxy-gateway/instructions.md -> container/skills/homelab-iron-proxy-gateway/instructions.md
```

## Register once

```nc:append to:src/gateway-providers/installed.ts
import './homelab-iron-proxy.js';
```

## Validate

```nc:run effect:build
pnpm run build
```

```nc:run effect:test
pnpm exec vitest run src/gateway-providers/homelab-iron-proxy.test.ts src/gateway-providers/gateway-provider-registry.test.ts
```

Select the gateway in `.env`: `NANOCLAW_GATEWAY_PROVIDER=homelab-iron-proxy`.
The setup step `pnpm exec tsx setup/index.ts --step gateway homelab-iron-proxy` applies
this skill and writes that line. Gateway auto-detection looks only at `add-*` skills,
so this line is required.

## Files on the NanoClaw host

Ansible writes these files from the Iron Proxy inventory (plan 3). For a local test,
write them by hand.

`data/homelab-iron-proxy/routes.json` is not secret:

```json
{
  "proxies": { "nanoclaw-open": { "url": "http://10.88.0.1:18080" } },
  "ca": "data/gateway-trust/homelab-iron-ca.pem",
  "groups": {
    "ag-1795086679358-5rterj": { "proxy": "nanoclaw-open", "agent": "nanoclaw-owner" }
  }
}
```

- `proxies.<name>.url`: `http://<host>:<port>` of the tunnel port of the instance. No path, no credentials.
  The agent container must reach this address.
- `ca`: the CA certificate of the proxy (public). It must be under `data/gateway-trust/`.
- `groups.<agent group ID>`: the proxy instance and the agent name from the Iron Proxy inventory.
  Find the IDs with `ncl groups list`.

`data/homelab-iron-proxy/placeholders.env`, mode `0600`, one line per agent:

```text
nanoclaw-owner=ipx_<64 hex>
```

The adapter reads both files at each agent start. A change applies to the next
agent start without a restart of NanoClaw. A running agent keeps its old values
until it stops.

## Provider credentials

The credential store of this gateway refuses every save. Keys live in the Ansible
vault (`app_iron_proxy_key_values`). Configure OpenCode only through `.env`:

```text
OPENCODE_PROVIDER=openai
OPENCODE_BASE_URL=https://api.venice.ai/api/v1
OPENCODE_MODEL=openai/<venice model>
OPENCODE_SMALL_MODEL=openai/<venice model>
```

Do not run `setup --step provider-auth opencode` with this gateway. It stops with the
message from `scripts/credential-store.ts`.

## Troubleshooting

- `agent group <id> is not in .../routes.json`: add the agent to the Iron Proxy inventory
  (`nanoclaw_group`) in `ansible-homelab` and run the playbook.
- `must not be readable by group or others`: `chmod 600 data/homelab-iron-proxy/placeholders.env`.
- `Homelab Iron Proxy is not reachable` in the log: the agent still starts, but its
  requests fail. Check the proxy instance and the address in `routes.json`.
- `403` from the proxy: the allowlist of the instance blocks the host.
