import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Installation identity comes from the routes file that Ansible writes, not
 * from proxy uptime: an unreachable proxy is still the installed gateway.
 */
export function detectInstalledHomelabIronProxy(root = process.cwd()): boolean {
  return fs.existsSync(path.join(root, 'data', 'homelab-iron-proxy', 'routes.json'));
}

if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  console.log(detectInstalledHomelabIronProxy() ? 'installed' : 'absent');
}
