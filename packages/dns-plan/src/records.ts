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

export type DnsOperation = (
  | { kind: 'create'; record: DnsRecord }
  | { kind: 'update'; recordId: string; record: DnsRecord }
  | { kind: 'delete'; recordId: string; record: Pick<DnsRecord, 'type' | 'name' | 'content'> }
) & {
  /**
   * Adjacent operations with the same group are one change: deletes, then the
   * creates that need the name (a type change). A provider with
   * `atomicGroups` applies them in one transaction; another applies them in
   * order. Results stay one per operation.
   */
  group?: string;
};

export interface DnsOperationResult {
  kind: DnsOperation['kind'];
  type: string;
  name: string;
  /** The `already_*` outcomes let a retried plan converge instead of failing. */
  status: 'applied' | 'already_present' | 'already_absent';
  /** The record written or removed; on `already_present`, the one found. */
  recordId: string | null;
  /**
   * On `already_present`: attributes in which the record found differs from the
   * one asked for. Type, name, content and (for MX and SRV) priority always match.
   */
  differingAttributes?: ReadonlyArray<'ttlSeconds' | 'proxied'>;
}

export interface DnsCapabilities {
  proxying: boolean;
  proxiableTypes: readonly string[];
  proxiedWildcards: boolean;
  wildcardRecords: boolean;
  automaticTtl: boolean;
  minTtlSeconds: number;
  maxTtlSeconds: number;
  /** Applies a group of operations (see `DnsOperation.group`) all or nothing. Default false. */
  atomicGroups?: boolean;
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
  /**
   * Applies in order; rejects at the first failure. See `DnsApplyError`. A
   * create refused because the name is taken succeeds only when that exact
   * record is there.
   */
  apply(
    zone: ZoneRef,
    operations: readonly DnsOperation[],
    options?: RequestOptions
  ): Promise<DnsOperationResult[]>;
}

/**
 * The part of a plan that succeeded before `cause` stopped it. The failed
 * operation is at index `completed.length`; when it was part of an atomic
 * group, the group starts there and none of it was applied.
 */
export class DnsApplyError extends Error {
  readonly completed: readonly DnsOperationResult[];
  readonly failed: DnsOperation;
  /** The cause's `kind` (`unauthorized`, `rate_limited`, …) when it has one, so callers can classify. */
  readonly kind: string | null;
  /** The cause's `retryable` flag when it has one. */
  readonly retryable: boolean;

  constructor(completed: readonly DnsOperationResult[], failed: DnsOperation, cause: unknown) {
    super(`DNS ${failed.kind} of ${failed.record.type} ${failed.record.name} failed after ${completed.length} change(s)`, {
      cause
    });
    this.name = 'DnsApplyError';
    this.completed = completed;
    this.failed = failed;
    const facts = typeof cause === 'object' && cause !== null ? (cause as { kind?: unknown; retryable?: unknown }) : {};
    this.kind = typeof facts.kind === 'string' ? facts.kind : null;
    this.retryable = facts.retryable === true;
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

const HOST_CONTENT = new Set(['CNAME', 'NS', 'MX', 'PTR', 'SRV', 'ALIAS', 'ANAME', 'DNAME']);

/**
 * Content in a comparable form: host names (and SRV targets) lose case and the
 * trailing dot, and IPv6 addresses are compressed. TXT content loses its
 * zone-file quoting, with its character strings joined; its case is kept.
 * Without this a correct zone can report drift forever. Compare with this,
 * store what was written.
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
    const parts = /^"(?:[^"\\]|\\.)*"(?:\s*"(?:[^"\\]|\\.)*")*$/s.test(text)
      ? [...text.matchAll(/"((?:[^"\\]|\\.)*)"/gs)].map((match) => match[1]!.replace(/\\(.)/gs, '$1'))
      : null;
    return parts ? parts.join('') : text;
  }
  return content.trim();
}
