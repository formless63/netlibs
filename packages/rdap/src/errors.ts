import { ProviderError, type ProviderErrorOptions } from '@formless63/provider-http';

/** RDAP-specific reasons, in addition to the general `kind`. */
/**
 * - `unsupported_tld`: the TLD publishes no RDAP service.
 * - `refused_redirect`: a server redirected to a host this client will not ask.
 * - `refused_server`: the bootstrap file named such a host.
 */
export type RdapErrorCode = 'unsupported_tld' | 'refused_redirect' | 'refused_server';

export class RdapError extends ProviderError {
  readonly code: RdapErrorCode | null;

  constructor(options: Omit<ProviderErrorOptions, 'provider'> & { code?: RdapErrorCode }) {
    super({ ...options, provider: 'RDAP' });
    this.code = options.code ?? null;
  }
}
