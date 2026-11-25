const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
// A top-level label is alphabetic or an A-label, so dotted numbers are not names.
const NAME = new RegExp(`^(?:${LABEL}\\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{0,57}[a-z0-9])$`);

/** Lower-cases a host name and removes surrounding space and one trailing dot. */
export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Whether `name` is a normalized domain name: lower-case ASCII (A-labels), at
 * least two labels, no trailing dot. Purely syntactic: it does not consult the
 * public suffix list, so `co.uk` and `a.b.example.com` both pass.
 */
export function isDomainName(name: string): boolean {
  return name.length <= 253 && NAME.test(name);
}

/**
 * Turns what a person typed or pasted into a domain name, or null. Accepts a
 * bare name, a trailing dot, an http(s) URL, and internationalized names.
 */
export function normalizeDomainName(raw: string): string | null {
  let name = normalizeHostname(raw.trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/s, ''));
  // oxlint-disable-next-line no-control-regex
  if (/[^\u0000-\u007f]/.test(name)) {
    if (/[\s@:\\]/.test(name)) return null;
    try {
      name = normalizeHostname(new URL(`http://${name}`).hostname);
    } catch {
      return null;
    }
  }
  return isDomainName(name) ? name : null;
}

/** Normalized, de-duplicated and sorted nameserver hosts. */
export function normalizeNameservers(hosts: readonly string[]): string[] {
  return [...new Set(hosts.map(normalizeHostname).filter((host) => host !== ''))].toSorted();
}
