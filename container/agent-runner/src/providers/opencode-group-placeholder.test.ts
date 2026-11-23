/**
 * Homelab patch opencode-group-placeholder: a gateway may give each agent
 * group its own credential placeholder through NANOCLAW_CREDENTIAL_PLACEHOLDER.
 * Kill condition: drop the env lookup in resolveOpenCodeInference and the
 * "uses the group placeholder" case goes red, so every group would send the
 * shared constant and one proxy could not tell the groups apart.
 */
import { describe, expect, it } from 'bun:test';

import { resolveOpenCodeInference } from './opencode-config.js';
import { OPENCODE_CREDENTIAL_PLACEHOLDER } from './opencode-auth.js';

const GROUP_PLACEHOLDER = `ipx_${'ab'.repeat(32)}`;

function apiKeyFor(environment: NodeJS.ProcessEnv): unknown {
  const inference = resolveOpenCodeInference({}, environment) as {
    provider: Record<string, { options: { apiKey: unknown } }>;
  };
  return inference.provider.openai.options.apiKey;
}

const base = {
  OPENCODE_PROVIDER: 'openai',
  OPENCODE_BASE_URL: 'https://api.venice.ai/api/v1',
  OPENCODE_MODEL: 'openai/some-model',
};

describe('per-group credential placeholder', () => {
  it('uses the group placeholder when the gateway sets one', () => {
    expect(apiKeyFor({ ...base, NANOCLAW_CREDENTIAL_PLACEHOLDER: GROUP_PLACEHOLDER })).toBe(GROUP_PLACEHOLDER);
  });

  it('trims the group placeholder', () => {
    expect(apiKeyFor({ ...base, NANOCLAW_CREDENTIAL_PLACEHOLDER: `  ${GROUP_PLACEHOLDER}\n` })).toBe(GROUP_PLACEHOLDER);
  });

  it('keeps the shared constant without a group placeholder', () => {
    expect(apiKeyFor(base)).toBe(OPENCODE_CREDENTIAL_PLACEHOLDER);
  });

  it('keeps the shared constant for an empty group placeholder', () => {
    expect(apiKeyFor({ ...base, NANOCLAW_CREDENTIAL_PLACEHOLDER: '   ' })).toBe(OPENCODE_CREDENTIAL_PLACEHOLDER);
  });

  it('keeps the base URL next to the group placeholder', () => {
    const inference = resolveOpenCodeInference({}, { ...base, NANOCLAW_CREDENTIAL_PLACEHOLDER: GROUP_PLACEHOLDER }) as {
      provider: Record<string, { npm?: string; options: Record<string, unknown> }>;
    };
    expect(inference.provider.openai).toMatchObject({
      npm: '@ai-sdk/openai-compatible',
      options: { apiKey: GROUP_PLACEHOLDER, baseURL: 'https://api.venice.ai/api/v1' },
    });
  });
});
