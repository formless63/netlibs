/**
 * The contract a registrar adapter implements. Types only: adapters and
 * applications share this shape without sharing code.
 */

/** One domain as a registrar account sees it. `null` means "not stated". */
export interface RegistrarDomain {
  /** Lower-case ASCII (A-label), no trailing dot. */
  name: string;
  /** ISO calendar dates (UTC). */
  registeredOn: string | null;
  expiresOn: string | null;
  autoRenew: boolean | null;
  /** Whether the registrant's details are hidden from public data. */
  privacy: boolean | null;
  transferLock: boolean | null;
  /** Normalized, de-duplicated, sorted. */
  nameservers: string[];
  /** RDAP wording (RFC 8056), e.g. `client transfer prohibited`. Sorted. */
  status: string[];
  /** One-year renewal price. A decimal string, never a float. */
  renewalPrice: Money | null;
  /** Whether DNS is hosted by the registrar itself. */
  usesRegistrarDns: boolean | null;
  expired: boolean | null;
  /** The registrar's own lifecycle word, verbatim and lower-cased. */
  lifecycle: string | null;
  premium: boolean | null;
}

export interface Money {
  /** Decimal string such as `10.98`. */
  amount: string;
  /** ISO 4217, upper-case. */
  currency: string;
}

/** What this adapter's API can actually report, so absence is not read as "no". */
export interface RegistrarCapabilities {
  renewalPrice: boolean;
  status: boolean;
  nameservers: boolean;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface Registrar {
  /** Stable machine id, e.g. `spaceship`. */
  readonly id: string;
  /** Display name, e.g. `Spaceship`. */
  readonly label: string;
  readonly capabilities: RegistrarCapabilities;
  /** Every domain in the account, or an error: never a silently truncated list. */
  listDomains(options?: RequestOptions): Promise<RegistrarDomain[]>;
  /** Rejects with kind `not_found` when the account does not hold the name. */
  getDomain(name: string, options?: RequestOptions): Promise<RegistrarDomain>;
  /** The cheapest authenticated read, to check a credential. */
  probe(options?: RequestOptions): Promise<{ domains: number }>;
}
