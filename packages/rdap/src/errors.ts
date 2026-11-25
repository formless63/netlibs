import { ProviderError, type ProviderErrorOptions } from '@formless63/provider-http';

/** RDAP-specific reasons, in addition to the general `kind`. */
export type RdapErrorCode = 'unsupported_tld' | 'refused_redirect';

export class RdapError extends ProviderError {
  readonly code: RdapErrorCode | null;

  constructor(options: Omit<ProviderErrorOptions, 'provider'> & { code?: RdapErrorCode }) {
    super({ ...options, provider: 'RDAP' });
    this.code = options.code ?? null;
  }
}
