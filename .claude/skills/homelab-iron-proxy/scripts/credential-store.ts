import type { ProviderCredentialStore } from '../../../../setup/gateways/credential-store.js';

export const REFUSAL =
  'homelab-iron-proxy does not store credentials. Keys live in the Ansible vault of ansible-homelab ' +
  '(app_iron_proxy_key_values); the proxy swaps each agent placeholder for its key. ' +
  'See plans/01-iron-proxy.md, section "Добавить агента". Configure the model only through OPENCODE_* in .env.';

/** Every write is refused: NanoClaw never holds a key with this gateway. */
export function createCredentialStore(): ProviderCredentialStore {
  const refuse = async (): Promise<never> => {
    throw new Error(REFUSAL);
  };
  return {
    has: refuse,
    save: refuse,
  };
}
