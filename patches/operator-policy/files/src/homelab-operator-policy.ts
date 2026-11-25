/**
 * Homelab: operator policy of an agent group.
 *
 * The operator (Ansible) writes `data/homelab-guardrails/<folder>.md` for the
 * groups that need extra standing rules, for example the groups of members.
 * The composer puts the text first in the project document of the group.
 *
 * The directory is under `data/` but outside every container mount, so the
 * agent can neither read the source file nor change it. This is the
 * difference from `instructions.prepend.md`, which lives in the agent-writable
 * group folder. The composed document itself is mounted read-only.
 *
 * Resolved at call time from process.cwd() (the project root), like the other
 * sources of `project-doc-compose.ts`.
 */
import fs from 'fs';
import path from 'path';

import { log } from './log.js';

/** Directory of the policy files, relative to the project root. */
export const OPERATOR_POLICY_DIR = path.join('data', 'homelab-guardrails');

/** Heading of the section in the composed project document. */
export const OPERATOR_POLICY_SECTION = 'Operator Policy';

const FOLDER_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

/** Read the policy of a group folder. Returns null when there is none. */
export function readOperatorPolicy(folder: string): string | null {
  if (!FOLDER_PATTERN.test(folder)) return null;
  const file = path.join(process.cwd(), OPERATOR_POLICY_DIR, `${folder}.md`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    if (!fs.fstatSync(fd).isFile()) {
      log.error('Operator policy is not a regular file; omitting it', { file });
      return null;
    }
    const content = fs.readFileSync(fd, 'utf-8').trim();
    return content || null;
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') return null;
    log.error('Could not read the operator policy; omitting it', {
      file,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
