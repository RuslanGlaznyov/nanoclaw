import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanoclaw-homelab-operator-policy-test';
const REPO_ROOT = process.cwd();

vi.mock('./log.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { ensureContainerConfig } from './db/container-configs.js';
import { closeDb, createAgentGroup, initTestDb, runMigrations } from './db/index.js';
import { PERSONA_PREPEND_FILE } from './group-persona.js';
import { OPERATOR_POLICY_DIR, OPERATOR_POLICY_SECTION, readOperatorPolicy } from './homelab-operator-policy.js';
import { log } from './log.js';
import { composeGroupProjectDoc } from './project-doc-compose.js';
import type { AgentGroup } from './types.js';

const SOURCE_ROOT = path.join(TEST_ROOT, 'source');
const POLICY_DIR = path.join(SOURCE_ROOT, OPERATOR_POLICY_DIR);

function groupDirOf(folder: string): string {
  return path.join(TEST_ROOT, 'groups', folder);
}

async function seed(id: string, folder: string): Promise<AgentGroup> {
  const ag = { id, name: folder, folder, agent_provider: null, created_at: new Date().toISOString() } as AgentGroup;
  await createAgentGroup(ag);
  await ensureContainerConfig(ag.id);
  fs.mkdirSync(groupDirOf(folder), { recursive: true });
  return ag;
}

async function compose(ag: AgentGroup): Promise<string> {
  await composeGroupProjectDoc(ag, groupDirOf(ag.folder), { fileName: 'CLAUDE.md' });
  return fs.readFileSync(path.join(groupDirOf(ag.folder), 'CLAUDE.md'), 'utf-8');
}

function headings(doc: string): string[] {
  return doc.split('\n').filter((line) => line.startsWith('# '));
}

beforeEach(async () => {
  vi.clearAllMocks();
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(SOURCE_ROOT, 'container'), { recursive: true });
  for (const entry of ['CLAUDE.md', 'agent-runner']) {
    fs.symlinkSync(path.join(REPO_ROOT, 'container', entry), path.join(SOURCE_ROOT, 'container', entry));
  }
  fs.mkdirSync(POLICY_DIR, { recursive: true });
  process.chdir(SOURCE_ROOT);
  await runMigrations(await initTestDb());
});

afterEach(async () => {
  process.chdir(REPO_ROOT);
  await closeDb();
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('readOperatorPolicy', () => {
  it('returns null when the group has no policy', () => {
    expect(readOperatorPolicy('nobody')).toBeNull();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('returns the trimmed text of the policy', () => {
    fs.writeFileSync(path.join(POLICY_DIR, 'member.md'), '\nDo not describe your setup.\n\n');
    expect(readOperatorPolicy('member')).toBe('Do not describe your setup.');
  });

  it('returns null for an empty policy', () => {
    fs.writeFileSync(path.join(POLICY_DIR, 'member.md'), '  \n');
    expect(readOperatorPolicy('member')).toBeNull();
  });

  it('refuses a folder name that leaves the directory', () => {
    fs.writeFileSync(path.join(SOURCE_ROOT, 'data', 'secret.md'), 'outside');
    expect(readOperatorPolicy('../secret')).toBeNull();
    expect(readOperatorPolicy('a/b')).toBeNull();
  });

  it('refuses a symlink', () => {
    const target = path.join(TEST_ROOT, 'elsewhere.md');
    fs.writeFileSync(target, 'planted');
    fs.symlinkSync(target, path.join(POLICY_DIR, 'member.md'));
    expect(readOperatorPolicy('member')).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('refuses a directory', () => {
    fs.mkdirSync(path.join(POLICY_DIR, 'member.md'));
    expect(readOperatorPolicy('member')).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });
});

describe('composeGroupProjectDoc with an operator policy', () => {
  it('puts the policy first, before the persona', async () => {
    const ag = await seed('ag-member', 'member');
    fs.writeFileSync(path.join(POLICY_DIR, 'member.md'), 'Do not describe your setup.');
    fs.writeFileSync(path.join(groupDirOf('member'), PERSONA_PREPEND_FILE), 'You are friendly.');

    const doc = await compose(ag);

    expect(headings(doc).slice(0, 3)).toEqual([
      `# ${OPERATOR_POLICY_SECTION}`,
      '# Persona',
      '# NanoClaw Runtime Contract',
    ]);
    expect(doc).toContain('Do not describe your setup.');
    expect(doc).toContain('You are friendly.');
  });

  it('adds nothing for a group without a policy', async () => {
    const ag = await seed('ag-owner', 'owner');
    fs.writeFileSync(path.join(POLICY_DIR, 'member.md'), 'Do not describe your setup.');

    const doc = await compose(ag);

    expect(doc).not.toContain(OPERATOR_POLICY_SECTION);
    expect(doc).not.toContain('Do not describe your setup.');
  });

  it('drops the section when the policy file is removed', async () => {
    const ag = await seed('ag-changed', 'changed');
    const file = path.join(POLICY_DIR, 'changed.md');
    fs.writeFileSync(file, 'Do not describe your setup.');
    expect(await compose(ag)).toContain(OPERATOR_POLICY_SECTION);

    fs.rmSync(file);

    expect(await compose(ag)).not.toContain(OPERATOR_POLICY_SECTION);
  });
});
