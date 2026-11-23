import { describe, expect, it } from 'vitest';

import { REFUSAL, createCredentialStore } from './credential-store.js';

describe('homelab-iron-proxy credential store', () => {
  it('refuses every lookup and save with the Ansible vault message', async () => {
    const store = createCredentialStore();
    await expect(store.has('opencode')).rejects.toThrow(REFUSAL);
    await expect(store.save('opencode', { kind: 'api-key', value: 'x' })).rejects.toThrow(/Ansible vault/);
  });

  it('offers no caller-described connections and no endpoint hook', () => {
    const store = createCredentialStore();
    expect(store.connection).toBeUndefined();
    expect(store.modelEndpoint).toBeUndefined();
  });
});
