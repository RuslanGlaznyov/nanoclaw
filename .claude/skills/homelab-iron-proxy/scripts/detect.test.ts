import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { detectInstalledHomelabIronProxy } from './detect.js';

it('detects the install by the routes file that Ansible writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homelab-iron-detect-'));
  try {
    expect(detectInstalledHomelabIronProxy(root)).toBe(false);
    fs.mkdirSync(path.join(root, 'data/homelab-iron-proxy'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data/homelab-iron-proxy/routes.json'), '{}');
    expect(detectInstalledHomelabIronProxy(root)).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
