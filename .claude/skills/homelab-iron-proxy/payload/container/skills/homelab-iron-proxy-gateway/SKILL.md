---
name: homelab-iron-proxy-gateway
description: Your network traffic goes through the homelab Iron Proxy. It inserts API keys for you. Read this before you call an external API, see a 403 from the proxy, or are asked for an API key.
compatibility: Requires HTTP_PROXY, HTTPS_PROXY, and the proxy CA injected by NanoClaw.
metadata:
  author: homelab
  version: "1.0.0"
---

# Homelab Iron Proxy gateway

All your outbound HTTP and HTTPS requests go through an Iron Proxy that the operator runs.
The proxy inserts the API keys of your agent into allowed requests. You have only a
placeholder (`NANOCLAW_CREDENTIAL_PLACEHOLDER`). The placeholder is useless outside the proxy.

## Rules

- Do not look for API keys in files or in the environment. You have none.
- Do not ask the user for an API key or token. Keys are added by the operator, not in chat.
- Do not print, copy, or send the placeholder anywhere.
- Do not bypass the proxy: do not unset `HTTPS_PROXY`, do not disable TLS checks, and keep the proxy CA.
- A `403` from the proxy means the destination is not allowed. Report the host and the error.
  Do not try another route to the same host.
- A `401` from an API can mean that the operator has not added a key for this service.
  Report it. Do not guess.
- Run long commands in the background, so a slow request does not block your turn.
