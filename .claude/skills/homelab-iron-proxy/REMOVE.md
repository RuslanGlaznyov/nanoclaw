# Remove the homelab Iron Proxy gateway

1. Select and install another gateway first. Without a registered gateway, NanoClaw does not start.
2. Use NanoClaw's journal-derived skill removal. It removes `import './homelab-iron-proxy.js';`
   from `src/gateway-providers/installed.ts` and the copied files. By hand, remove:
   - `src/gateway-providers/homelab-iron-proxy.ts`
   - `src/gateway-providers/homelab-iron-proxy.test.ts`
   - `container/skills/homelab-iron-proxy-gateway/`
3. Set `NANOCLAW_GATEWAY_PROVIDER` in `.env` to the new gateway.
4. Remove `data/homelab-iron-proxy/` and `data/gateway-trust/homelab-iron-ca.pem` if nothing else uses them.
   Ansible writes them again if the host is still in the inventory.
5. Do not touch the Iron Proxy, its keys, or the Ansible vault. They belong to `ansible-homelab`.
6. `pnpm run build`, then restart NanoClaw.
