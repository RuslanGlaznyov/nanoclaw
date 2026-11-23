/**
 * Homelab Iron Proxy gateway: connect agent groups to an external, shared
 * Iron Proxy that this install does not run.
 *
 * Ansible owns the proxy, its keys, and its placeholders. This adapter only
 * reads two files that Ansible writes on the NanoClaw host:
 *
 *   data/homelab-iron-proxy/routes.json       which proxy and agent each group uses (not secret)
 *   data/homelab-iron-proxy/placeholders.env  <agent>=ipx_<64 hex>, mode 0600
 *
 * Each group gets its agent's placeholder as NANOCLAW_CREDENTIAL_PLACEHOLDER.
 * The proxy swaps the placeholder for that agent's key. A group that is not in
 * routes.json does not start: there is no fallback to open egress.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { DATA_DIR } from '../config.js';
import { log } from '../log.js';

import {
  registerGatewayProvider,
  type GatewayContribution,
  type GatewayProviderDefinition,
  type GatewaySessionInput,
  type GatewaySessionLease,
} from './gateway-provider-registry.js';

export const HOMELAB_IRON_PROXY_KIND = 'homelab-iron-proxy';
export const ROUTES_FILE = 'homelab-iron-proxy/routes.json';
export const PLACEHOLDERS_FILE = 'homelab-iron-proxy/placeholders.env';
/** Where the CA lands in the agent container. */
export const AGENT_CA_PATH = '/run/nanoclaw-homelab-iron-ca.crt';
/**
 * The proxy is reached by the address in HTTPS_PROXY. This name only feeds the
 * driver's `--add-host=<endpoint>:host-gateway`; `.invalid` never resolves elsewhere.
 */
export const NETWORK_ENDPOINT = 'homelab-iron-proxy.invalid';
export const PLACEHOLDER_ENV = 'NANOCLAW_CREDENTIAL_PLACEHOLDER';

const PLACEHOLDER_RE = /^ipx_[0-9a-f]{64}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const GROUP_RE = /^[A-Za-z0-9_-]+$/;
const NO_PROXY = 'localhost,127.0.0.1,::1';
const INVENTORY_HINT = 'Add the agent to the Iron Proxy inventory in ansible-homelab and run the playbook.';

export interface HomelabIronProxyRoute {
  agentGroupId: string;
  proxyName: string;
  /** http://<host>:<port>, no credentials, no path. */
  proxyUrl: string;
  agent: string;
  /** Absolute path under data/gateway-trust/. */
  caPath: string;
  placeholder: string;
}

export class HomelabIronProxyConfigError extends Error {
  constructor(message: string) {
    super(`homelab-iron-proxy: ${message}`);
    this.name = 'HomelabIronProxyConfigError';
  }
}

function fail(message: string): never {
  throw new HomelabIronProxyConfigError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    fail(`cannot read ${file}. ${INVENTORY_HINT}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${file} is not valid JSON`);
  }
}

export function parseProxyUrl(name: string, value: unknown): string {
  if (typeof value !== 'string') fail(`proxy ${name}: url must be a string`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`proxy ${name}: url is not a valid URL`);
  }
  if (url.protocol !== 'http:') fail(`proxy ${name}: url must start with http:// (the proxy tunnel port)`);
  if (url.username || url.password) fail(`proxy ${name}: url must not contain credentials`);
  if (!url.port) fail(`proxy ${name}: url must contain a port`);
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) fail(`proxy ${name}: url must not have a path`);
  return `http://${url.host}`;
}

/** Parse `<agent>=<placeholder>` lines. Blank lines and `#` comments are ignored. */
export function parsePlaceholders(text: string, file: string): Map<string, string> {
  const result = new Map<string, string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    const agent = eq > 0 ? line.slice(0, eq).trim() : '';
    const value = eq > 0 ? line.slice(eq + 1).trim() : '';
    // Never echo the value: a malformed line may still be a real placeholder.
    if (!NAME_RE.test(agent)) fail(`${file} line ${index + 1}: expected <agent>=ipx_<64 hex>`);
    if (!PLACEHOLDER_RE.test(value)) fail(`${file} line ${index + 1}: placeholder of ${agent} must be ipx_<64 hex>`);
    if (result.has(agent)) fail(`${file} line ${index + 1}: duplicate agent ${agent}`);
    result.set(agent, value);
  });
  return result;
}

function readPlaceholders(file: string): Map<string, string> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    fail(`cannot read ${file}. ${INVENTORY_HINT}`);
  }
  if (!stat.isFile()) fail(`${file} is not a file`);
  if ((stat.mode & 0o077) !== 0) {
    fail(`${file} must not be readable by group or others (mode ${(stat.mode & 0o777).toString(8)}); run chmod 600`);
  }
  return parsePlaceholders(fs.readFileSync(file, 'utf8'), file);
}

/**
 * Resolve one group's route. Reads both files on every call, so a change by
 * Ansible applies to the next agent start without a NanoClaw restart.
 */
export function resolveHomelabIronProxyRoute(agentGroupId: string, dataDir: string = DATA_DIR): HomelabIronProxyRoute {
  if (!GROUP_RE.test(agentGroupId)) fail(`invalid agent group ID ${JSON.stringify(agentGroupId)}`);
  const routesFile = path.join(dataDir, ROUTES_FILE);
  const routes = readJson(routesFile);
  if (!isRecord(routes) || !isRecord(routes.proxies) || !isRecord(routes.groups)) {
    fail(`${routesFile} must have the objects "proxies" and "groups"`);
  }
  if (!Object.hasOwn(routes.groups, agentGroupId)) {
    fail(`agent group ${agentGroupId} is not in ${routesFile}. ${INVENTORY_HINT}`);
  }
  const group = routes.groups[agentGroupId];
  if (!isRecord(group) || typeof group.proxy !== 'string' || typeof group.agent !== 'string') {
    fail(`group ${agentGroupId} in ${routesFile} must have the strings "proxy" and "agent"`);
  }
  const proxyName = group.proxy;
  const agent = group.agent;
  if (!NAME_RE.test(agent)) fail(`group ${agentGroupId}: invalid agent name ${JSON.stringify(agent)}`);
  if (!Object.hasOwn(routes.proxies, proxyName)) {
    fail(`group ${agentGroupId} uses the unknown proxy instance ${JSON.stringify(proxyName)}`);
  }
  const proxy = routes.proxies[proxyName];
  if (!isRecord(proxy)) fail(`proxy ${proxyName} in ${routesFile} must be an object`);
  const proxyUrl = parseProxyUrl(proxyName, proxy.url);

  // The CA path is relative to the project root, or absolute. Either way it
  // must stay under data/gateway-trust/: only that root may be mounted into
  // an agent as gateway-trust material.
  if (typeof routes.ca !== 'string' || !routes.ca) fail(`${routesFile} must have the string "ca"`);
  const trustRoot = path.join(dataDir, 'gateway-trust');
  const caPath = path.resolve(path.dirname(dataDir), routes.ca);
  if (!caPath.startsWith(`${trustRoot}${path.sep}`)) fail(`ca must be a file under ${trustRoot}`);
  let caText: string;
  try {
    caText = fs.readFileSync(caPath, 'utf8');
  } catch {
    fail(`cannot read the proxy CA ${caPath}`);
  }
  if (!caText.includes('-----BEGIN CERTIFICATE-----')) fail(`${caPath} is not a PEM certificate`);
  if (caText.includes('PRIVATE KEY')) fail(`${caPath} contains a private key; it must hold only the CA certificate`);

  const placeholdersFile = path.join(dataDir, PLACEHOLDERS_FILE);
  const placeholder = readPlaceholders(placeholdersFile).get(agent);
  if (!placeholder) fail(`agent ${agent} (group ${agentGroupId}) has no placeholder in ${placeholdersFile}`);

  return { agentGroupId, proxyName, proxyUrl, agent, caPath, placeholder };
}

export function homelabIronProxyContribution(route: HomelabIronProxyRoute): GatewayContribution {
  return {
    env: {
      HTTP_PROXY: route.proxyUrl,
      HTTPS_PROXY: route.proxyUrl,
      http_proxy: route.proxyUrl,
      https_proxy: route.proxyUrl,
      NO_PROXY,
      no_proxy: NO_PROXY,
      NODE_EXTRA_CA_CERTS: AGENT_CA_PATH,
      SSL_CERT_FILE: AGENT_CA_PATH,
      CURL_CA_BUNDLE: AGENT_CA_PATH,
      GIT_SSL_CAINFO: AGENT_CA_PATH,
      REQUESTS_CA_BUNDLE: AGENT_CA_PATH,
      [PLACEHOLDER_ENV]: route.placeholder,
    },
    mounts: [
      {
        class: 'gateway-trust',
        hostPath: route.caPath,
        containerPath: AGENT_CA_PATH,
        mode: 'ro',
        groupScope: route.agentGroupId,
      },
    ],
    networkAccess: { endpoint: NETWORK_ENDPOINT, target: { kind: 'host' } },
  };
}

/** Resolve true when a TCP connection to the proxy opens within the timeout. */
export function probeProxy(proxyUrl: string, timeoutMs = 3_000): Promise<boolean> {
  const url = new URL(proxyUrl);
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(url.port) });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export interface HomelabIronProxyOptions {
  dataDir?: string;
  /** Injected in tests. Absent: a TCP probe, logged only, never fatal. */
  probe?: (proxyUrl: string) => Promise<boolean>;
}

export function defineHomelabIronProxyProvider(options: HomelabIronProxyOptions = {}): GatewayProviderDefinition {
  const probe = options.probe ?? probeProxy;

  const ensure = async (input: GatewaySessionInput, signal: AbortSignal): Promise<GatewaySessionLease> => {
    if (signal.aborted) throw new HomelabIronProxyConfigError('session ensure was aborted');
    const route = resolveHomelabIronProxyRoute(input.key.agentGroupId, options.dataDir ?? DATA_DIR);
    // Never log the placeholder: it identifies the agent to the proxy.
    log.info('Homelab Iron Proxy route', {
      agentGroupId: route.agentGroupId,
      proxy: route.proxyName,
      proxyUrl: route.proxyUrl,
      agent: route.agent,
      disposition: input.disposition ?? 'create',
    });
    void probe(route.proxyUrl)
      .then((ok) => {
        if (!ok) log.warn('Homelab Iron Proxy is not reachable', { proxy: route.proxyName, proxyUrl: route.proxyUrl });
      })
      .catch(() => {});
    return { contribution: homelabIronProxyContribution(route) };
  };

  return {
    kind: HOMELAB_IRON_PROXY_KIND,
    agentSkills: ['homelab-iron-proxy-gateway'],
    sessions: { ensure },
    approvals: {
      // The external proxy has no approval events. Stay subscribed until the
      // host stops: an ended subscription would close session admission.
      subscribe: (_decide, signal) =>
        new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        }),
    },
  };
}

registerGatewayProvider(defineHomelabIronProxyProvider());
