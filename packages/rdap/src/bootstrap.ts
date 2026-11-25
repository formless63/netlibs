import { z } from 'zod';

import { RdapError } from './errors.ts';

export const IANA_RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';

const bootstrapSchema = z.looseObject({
  services: z.array(z.tuple([z.array(z.string()), z.array(z.string())]))
});

/**
 * The RDAP base URL for a name in a parsed RFC 9224 bootstrap file (longest
 * suffix match, https preferred), or null when its TLD has no RDAP service.
 */
export function rdapBaseUrl(bootstrap: unknown, name: string): string | null {
  const parsed = bootstrapSchema.safeParse(bootstrap);
  if (!parsed.success) {
    throw new RdapError({
      kind: 'invalid_response',
      message: 'the RDAP bootstrap file is not in RFC 9224 form'
    });
  }
  const labels = name.toLowerCase().split('.');
  let best: { depth: number; urls: string[] } | null = null;
  for (const [suffixes, urls] of parsed.data.services) {
    for (const suffix of suffixes) {
      const parts = suffix.toLowerCase().split('.');
      if (parts.length >= labels.length) continue;
      if (labels.slice(-parts.length).join('.') !== parts.join('.')) continue;
      if (!best || parts.length > best.depth) best = { depth: parts.length, urls };
    }
  }
  const url = best?.urls.find((candidate) => candidate.startsWith('https://')) ?? best?.urls[0];
  return url ? (url.endsWith('/') ? url : `${url}/`) : null;
}
