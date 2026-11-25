import { normalizeHostname, normalizeNameservers } from './names.ts';

export interface DnsProviderRule {
  /** Matched against a normalized nameserver host. */
  pattern: RegExp;
  provider: string;
}

const rule = (pattern: RegExp, provider: string): DnsProviderRule => ({ pattern, provider });

/** Well-known DNS hosts by nameserver suffix. Extend by passing your own list. */
export const DNS_PROVIDER_RULES: readonly DnsProviderRule[] = [
  rule(/\.ns\.cloudflare\.com$/, 'Cloudflare'),
  rule(/\.domaincontrol\.com$/, 'GoDaddy'),
  rule(/\.registrar-servers\.com$/, 'Namecheap'),
  rule(/\.porkbun\.com$/, 'Porkbun'),
  rule(/\.awsdns-\d+\.(com|net|org|co\.uk)$/, 'Amazon Route 53'),
  rule(/\.googledomains\.com$/, 'Google Cloud DNS'),
  rule(/\.azure-dns\.(com|net|org|info)$/, 'Azure DNS'),
  rule(/\.digitalocean\.com$/, 'DigitalOcean'),
  rule(/\.linode\.com$/, 'Linode'),
  rule(/\.vultr\.com$/, 'Vultr'),
  rule(/\.hetzner\.(com|de)$|\.your-server\.de$/, 'Hetzner'),
  rule(/\.spaceship\.net$/, 'Spaceship'),
  rule(/\.name\.com$/, 'Name.com'),
  rule(/\.dnsimple\.com$/, 'DNSimple'),
  rule(/\.nsone\.net$/, 'NS1'),
  rule(/\.ultradns\.(com|net|org|biz)$/, 'UltraDNS'),
  rule(/\.gandi\.net$/, 'Gandi'),
  rule(/\.hover\.com$/, 'Hover'),
  rule(/\.dynect\.net$/, 'Dyn'),
  rule(/\.wixdns\.net$/, 'Wix'),
  rule(/\.squarespacedns\.com$/, 'Squarespace'),
  rule(/\.vercel-dns\.com$/, 'Vercel'),
  rule(/\.netlify\.com$/, 'Netlify'),
  rule(/\.bunny\.net$|\.bunnyinfra\.net$/, 'Bunny DNS'),
  rule(/\.desec\.(io|org)$/, 'deSEC')
];

/** The DNS host the nameservers belong to, or null when unknown or split between hosts. */
export function inferDnsProvider(
  nameservers: readonly string[],
  rules: readonly DnsProviderRule[] = DNS_PROVIDER_RULES
): string | null {
  const found = new Set(
    nameservers.map(
      (host) => rules.find(({ pattern }) => pattern.test(normalizeHostname(host)))?.provider ?? null
    )
  );
  return found.size === 1 ? [...found][0]! : null;
}

/** Whether two nameserver sets belong to different DNS hosts. */
export function dnsProviderMoved(
  before: readonly string[],
  after: readonly string[],
  rules: readonly DnsProviderRule[] = DNS_PROVIDER_RULES
): boolean {
  const a = normalizeNameservers(before);
  const b = normalizeNameservers(after);
  if (a.length === 0 || b.length === 0 || a.join() === b.join()) return false;
  const from = inferDnsProvider(a, rules);
  const to = inferDnsProvider(b, rules);
  if (from !== null && to !== null) return from !== to;
  // Unrecognized hosts: moved when no nameserver shares a parent domain.
  const parent = (host: string): string => host.split('.').slice(-2).join('.');
  const parents = new Set(a.map(parent));
  return !b.some((host) => parents.has(parent(host)));
}
