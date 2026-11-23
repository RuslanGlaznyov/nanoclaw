import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../log.js';
import { validateSpec } from '../drivers/types.js';
import { FIXTURE_POLICY, fixtureSpec } from '../drivers/spec-fixture.js';
import {
  AGENT_CA_PATH,
  NETWORK_ENDPOINT,
  PLACEHOLDER_ENV,
  defineHomelabIronProxyProvider,
  homelabIronProxyContribution,
  parsePlaceholders,
  resolveHomelabIronProxyRoute,
} from './homelab-iron-proxy.js';
import { getGatewayProviderRegistration, type GatewaySessionInput } from './gateway-provider-registry.js';

const GROUP_A = 'ag-1795086679358-5rterj';
const GROUP_B = 'ag-1795086679359-bbbbbb';
const PH_A = `ipx_${'a1'.repeat(32)}`;
const PH_B = `ipx_${'b2'.repeat(32)}`;
const CA = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

let root: string;
let dataDir: string;

function writeRoutes(routes: unknown): void {
  fs.writeFileSync(path.join(dataDir, 'homelab-iron-proxy/routes.json'), JSON.stringify(routes));
}

function writePlaceholders(text: string, mode = 0o600): void {
  const file = path.join(dataDir, 'homelab-iron-proxy/placeholders.env');
  fs.writeFileSync(file, text);
  fs.chmodSync(file, mode);
}

function defaultRoutes(): Record<string, unknown> {
  return {
    proxies: { 'nanoclaw-open': { url: 'http://10.88.0.1:18080' } },
    ca: 'data/gateway-trust/homelab-iron-ca.pem',
    groups: {
      [GROUP_A]: { proxy: 'nanoclaw-open', agent: 'nanoclaw-owner' },
      [GROUP_B]: { proxy: 'nanoclaw-open', agent: 'nanoclaw-nadi' },
    },
  };
}

function sessionInput(agentGroupId: string): GatewaySessionInput {
  return {
    key: { installSlug: 'test', agentGroupId, sessionId: 'sess-1' },
    runtimeIdentity: `test/${agentGroupId}/sess-1`,
    groupName: 'Test',
    provider: 'opencode',
    containerName: 'nanoclaw-test',
    capabilities: {} as GatewaySessionInput['capabilities'],
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'homelab-iron-proxy-'));
  dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(dataDir, 'homelab-iron-proxy'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'gateway-trust'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'gateway-trust/homelab-iron-ca.pem'), CA);
  writeRoutes(defaultRoutes());
  writePlaceholders(`# managed by Ansible\nnanoclaw-owner=${PH_A}\n\nnanoclaw-nadi=${PH_B}\n`);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('homelab-iron-proxy route', () => {
  it('gives each group its own placeholder, the proxy env, the CA mount and host network access', () => {
    const a = homelabIronProxyContribution(resolveHomelabIronProxyRoute(GROUP_A, dataDir));
    const b = homelabIronProxyContribution(resolveHomelabIronProxyRoute(GROUP_B, dataDir));

    expect(a.env?.[PLACEHOLDER_ENV]).toBe(PH_A);
    expect(b.env?.[PLACEHOLDER_ENV]).toBe(PH_B);
    expect(a.env).toMatchObject({
      HTTP_PROXY: 'http://10.88.0.1:18080',
      HTTPS_PROXY: 'http://10.88.0.1:18080',
      http_proxy: 'http://10.88.0.1:18080',
      https_proxy: 'http://10.88.0.1:18080',
      NO_PROXY: 'localhost,127.0.0.1,::1',
      no_proxy: 'localhost,127.0.0.1,::1',
      NODE_EXTRA_CA_CERTS: AGENT_CA_PATH,
      SSL_CERT_FILE: AGENT_CA_PATH,
      CURL_CA_BUNDLE: AGENT_CA_PATH,
      GIT_SSL_CAINFO: AGENT_CA_PATH,
    });
    expect(a.mounts).toEqual([
      {
        class: 'gateway-trust',
        hostPath: path.join(dataDir, 'gateway-trust/homelab-iron-ca.pem'),
        containerPath: AGENT_CA_PATH,
        mode: 'ro',
        groupScope: GROUP_A,
      },
    ]);
    expect(a.networkAccess).toEqual({ endpoint: NETWORK_ENDPOINT, target: { kind: 'host' } });
  });

  it('passes core spec validation: CA under the gateway-trust root, placeholder not seen as a credential', () => {
    const policy = { ...FIXTURE_POLICY, dataRoot: dataDir, gatewayTrustRoot: path.join(dataDir, 'gateway-trust') };
    const contribution = homelabIronProxyContribution(resolveHomelabIronProxyRoute(GROUP_A, dataDir));
    const base = fixtureSpec();
    const spec = {
      ...base,
      key: { ...base.key, agentGroupId: GROUP_A },
      networkAccess: contribution.networkAccess,
      containers: base.containers.map((container) => ({
        ...container,
        // Group-state paths in the fixture belong to another group and root.
        mounts: [...container.mounts.filter((m) => m.class !== 'group-state'), ...(contribution.mounts ?? [])],
        contributedEnv: { ...(container.contributedEnv ?? {}), ...contribution.env },
      })),
    };
    expect(() => validateSpec(spec, policy)).not.toThrow();
  });

  it('refuses a group that is not in routes.json and names it', () => {
    expect(() => resolveHomelabIronProxyRoute('ag-unknown', dataDir)).toThrow(
      /agent group ag-unknown is not in .*inventory/s,
    );
  });

  it('refuses placeholders.env readable by group or others', () => {
    writePlaceholders(`nanoclaw-owner=${PH_A}\n`, 0o640);
    expect(() => resolveHomelabIronProxyRoute(GROUP_A, dataDir)).toThrow(/must not be readable by group or others/);
  });

  it('refuses a placeholder in the wrong format and does not echo it', () => {
    const bad = `ipx_${'A1'.repeat(32)}`;
    writePlaceholders(`nanoclaw-owner=${bad}\n`);
    let message = '';
    try {
      resolveHomelabIronProxyRoute(GROUP_A, dataDir);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/placeholder of nanoclaw-owner must be ipx_<64 hex>/);
    expect(message).not.toContain(bad);
  });

  it('refuses an agent without a placeholder', () => {
    writePlaceholders(`nanoclaw-owner=${PH_A}\n`);
    expect(() => resolveHomelabIronProxyRoute(GROUP_B, dataDir)).toThrow(/agent nanoclaw-nadi .* has no placeholder/);
  });

  it('refuses a group that uses an unknown proxy instance', () => {
    const routes = defaultRoutes();
    (routes.groups as Record<string, unknown>)[GROUP_A] = { proxy: 'nanoclaw-strict', agent: 'nanoclaw-owner' };
    writeRoutes(routes);
    expect(() => resolveHomelabIronProxyRoute(GROUP_A, dataDir)).toThrow(/unknown proxy instance "nanoclaw-strict"/);
  });

  it('refuses a CA outside the gateway-trust root', () => {
    fs.writeFileSync(path.join(dataDir, 'ca.pem'), CA);
    writeRoutes({ ...defaultRoutes(), ca: 'data/ca.pem' });
    expect(() => resolveHomelabIronProxyRoute(GROUP_A, dataDir)).toThrow(/ca must be a file under/);
    writeRoutes({ ...defaultRoutes(), ca: 'data/gateway-trust/../ca.pem' });
    expect(() => resolveHomelabIronProxyRoute(GROUP_A, dataDir)).toThrow(/ca must be a file under/);
  });

  it('refuses a CA file that holds a private key', () => {
    fs.writeFileSync(
      path.join(dataDir, 'gateway-trust/homelab-iron-ca.pem'),
      `${CA}-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n`,
    );
    expect(() => resolveHomelabIronProxyRoute(GROUP_A, dataDir)).toThrow(/contains a private key/);
  });

  it('refuses proxy URLs that are not a plain http://host:port', () => {
    for (const url of ['https://10.88.0.1:18080', 'http://u:p@10.88.0.1:18080', 'http://10.88.0.1', 'http://h:1/x']) {
      writeRoutes({ ...defaultRoutes(), proxies: { 'nanoclaw-open': { url } } });
      expect(() => resolveHomelabIronProxyRoute(GROUP_A, dataDir), url).toThrow(/proxy nanoclaw-open: url/);
    }
  });

  it('reads the files again on every call, so an Ansible change needs no restart', () => {
    expect(resolveHomelabIronProxyRoute(GROUP_A, dataDir).placeholder).toBe(PH_A);
    const rotated = `ipx_${'c3'.repeat(32)}`;
    writePlaceholders(`nanoclaw-owner=${rotated}\nnanoclaw-nadi=${PH_B}\n`);
    expect(resolveHomelabIronProxyRoute(GROUP_A, dataDir).placeholder).toBe(rotated);
  });

  it('parses comments and blank lines, refuses duplicates', () => {
    expect(parsePlaceholders(`# x\n\nnanoclaw-owner=${PH_A}\n`, 'f').get('nanoclaw-owner')).toBe(PH_A);
    expect(() => parsePlaceholders(`a=${PH_A}\na=${PH_B}\n`, 'f')).toThrow(/duplicate agent a/);
  });
});

describe('homelab-iron-proxy provider', () => {
  it('registers itself under its kind', () => {
    expect(getGatewayProviderRegistration('homelab-iron-proxy')?.agentSkills).toEqual(['homelab-iron-proxy-gateway']);
  });

  it('ensure returns the contribution and never logs the placeholder', async () => {
    const calls: unknown[] = [];
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(log, level).mockImplementation((...args: unknown[]) => {
        calls.push(args);
      });
    }
    const probe = vi.fn().mockResolvedValue(false);
    const provider = defineHomelabIronProxyProvider({ dataDir, probe });
    const lease = await provider.sessions.ensure(sessionInput(GROUP_A), new AbortController().signal);
    await new Promise((resolve) => setImmediate(resolve));

    expect(lease.contribution.env?.[PLACEHOLDER_ENV]).toBe(PH_A);
    expect(probe).toHaveBeenCalledWith('http://10.88.0.1:18080');
    expect(calls.length).toBeGreaterThan(0);
    const logged = JSON.stringify(calls);
    expect(logged).toContain('Homelab Iron Proxy is not reachable');
    expect(logged).not.toContain(PH_A);
    expect(logged).not.toContain(PH_B);
  });

  it('ensure fails for an unknown group, so the agent does not start', async () => {
    const provider = defineHomelabIronProxyProvider({ dataDir, probe: async () => true });
    await expect(provider.sessions.ensure(sessionInput('ag-missing'), new AbortController().signal)).rejects.toThrow(
      /agent group ag-missing is not in/,
    );
  });

  it('approval subscription stays open until the signal aborts', async () => {
    const provider = defineHomelabIronProxyProvider({ dataDir });
    const controller = new AbortController();
    let settled = false;
    const subscription = provider.approvals
      .subscribe(async () => 'deny', controller.signal)
      .then(() => {
        settled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    controller.abort();
    await subscription;
    expect(settled).toBe(true);
  });
});
