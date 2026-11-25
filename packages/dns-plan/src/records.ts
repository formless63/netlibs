/** A DNS record in provider-neutral form. */
export interface DnsRecord {
  type: string;
  /** Zone-relative: `@`, `*`, `www`, `key1._domainkey`. */
  name: string;
  content: string;
  /** `null` means the provider's default. */
  ttlSeconds: number | null;
  priority: number | null;
  /** The provider answers for the name and forwards to the origin. */
  proxied: boolean;
}

/** A record as it exists at a provider. */
export interface ObservedRecord extends DnsRecord {
  recordId: string;
  proxiable: boolean;
}

export interface DnsZone {
  zoneId: string;
  name: string;
  /** The provider's own status word, verbatim. */
  status: string;
  nameservers: string[];
}

export type DnsOperation =
  | { kind: 'create'; record: DnsRecord }
  | { kind: 'update'; recordId: string; record: DnsRecord }
  | { kind: 'delete'; recordId: string; record: Pick<DnsRecord, 'type' | 'name' | 'content'> };

export interface DnsOperationResult {
  kind: DnsOperation['kind'];
  type: string;
  name: string;
  /** The `already_*` outcomes let a retried plan converge instead of failing. */
  status: 'applied' | 'already_present' | 'already_absent';
  recordId: string | null;
}

export interface DnsCapabilities {
  proxying: boolean;
  proxiableTypes: readonly string[];
  proxiedWildcards: boolean;
  wildcardRecords: boolean;
  automaticTtl: boolean;
  minTtlSeconds: number;
  maxTtlSeconds: number;
}

export interface ZoneRef {
  zoneId: string;
  zoneName: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** What a DNS host adapter implements. */
export interface DnsProvider {
  readonly id: string;
  readonly label: string;
  capabilities(): DnsCapabilities;
  findZone(name: string, options?: RequestOptions): Promise<DnsZone | null>;
  /** Every record in the zone, or an error: never a silently truncated list. */
  listRecords(zone: ZoneRef, options?: RequestOptions): Promise<ObservedRecord[]>;
  /** Applies in order; rejects at the first failure. See `DnsApplyError`. */
  apply(
    zone: ZoneRef,
    operations: readonly DnsOperation[],
    options?: RequestOptions
  ): Promise<DnsOperationResult[]>;
}

/** The part of a plan that succeeded before `cause` stopped it. */
export class DnsApplyError extends Error {
  readonly completed: readonly DnsOperationResult[];
  readonly failed: DnsOperation;

  constructor(completed: readonly DnsOperationResult[], failed: DnsOperation, cause: unknown) {
    super(`DNS ${failed.kind} of ${failed.record.type} ${failed.record.name} failed after ${completed.length} change(s)`, {
      cause
    });
    this.name = 'DnsApplyError';
    this.completed = completed;
    this.failed = failed;
  }
}

const clean = (name: string): string => name.trim().toLowerCase().replace(/\.$/, '');

/** A zone-relative name as a fully qualified one. Already-qualified names pass through. */
export function toFqdn(name: string, zoneName: string): string {
  const relative = clean(name);
  const zone = clean(zoneName);
  if (relative === '' || relative === '@' || relative === zone) return zone;
  return relative.endsWith(`.${zone}`) ? relative : `${relative}.${zone}`;
}

/** A fully qualified name as a zone-relative one. */
export function toRelativeName(name: string, zoneName: string): string {
  const fqdn = clean(name);
  const zone = clean(zoneName);
  if (fqdn === zone) return '@';
  return fqdn.endsWith(`.${zone}`) ? fqdn.slice(0, -(zone.length + 1)) : fqdn;
}

const HOST_CONTENT = new Set(['CNAME', 'NS', 'MX', 'PTR', 'ALIAS', 'ANAME']);

/**
 * Content in a comparable form: host names lose case and the trailing dot, and
 * IPv6 addresses are compressed. Without this a correct zone can report drift
 * forever. TXT content is compared without surrounding quotes.
 */
export function normalizeContent(type: string, content: string): string {
  const kind = type.toUpperCase();
  if (HOST_CONTENT.has(kind)) return clean(content);
  if (kind === 'AAAA') {
    try {
      return new URL(`http://[${content.trim()}]`).hostname.slice(1, -1);
    } catch {
      return content.trim().toLowerCase();
    }
  }
  if (kind === 'TXT') {
    const text = content.trim();
    const parts = text.match(/^"(?:[^"\\]|\\.)*"(?:\s+"(?:[^"\\]|\\.)*")*$/)
      ? [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]!.replace(/\\(.)/g, '$1'))
      : null;
    return parts ? parts.join('') : text;
  }
  return content.trim();
}
