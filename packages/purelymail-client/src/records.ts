import { toFqdn, toRelativeName, type DnsRecord } from '@formless63/dns-plan';

/**
 * The DNS records Purelymail requires for a custom domain.
 *
 * Source: https://purelymail.com/docs/domainDocs ("Custom Domain Setup"),
 * checked 2026-11-26. Its numbering is kept:
 *
 * ```text
 * #1  MX     @                       mailserver.purelymail.com   priority 50
 * #2  TXT    @                       v=spf1 include:_spf.purelymail.com ~all
 * #3  TXT    @                       <ownership code>            one per account
 * #4  CNAME  purelymail1._domainkey  key1.dkimroot.purelymail.com
 * #5  CNAME  purelymail2._domainkey  key2.dkimroot.purelymail.com
 * #6  CNAME  purelymail3._domainkey  key3.dkimroot.purelymail.com
 * #7  CNAME  _dmarc                  dmarcroot.purelymail.com
 * ```
 *
 * - DMARC is a CNAME that delegates the policy to Purelymail, not a TXT policy.
 * - There are three DKIM keys because Purelymail rotates between them;
 *   publishing one makes two thirds of mail fail DKIM.
 * - The CNAMEs must not be proxied ("set it as DNS only (this is very
 *   important)"), so every record here has `proxied: false`.
 * - TTLs "can generally be left to their defaults": `ttlSeconds` is null.
 * - The ownership code is published verbatim; it has no prefix.
 */

export type PurelymailRecordPurpose = 'mx' | 'spf' | 'ownership' | 'dkim' | 'dmarc';

/** A `dns-plan` record, labelled with what it is for. */
export interface PurelymailDnsRecord extends DnsRecord {
  type: 'MX' | 'TXT' | 'CNAME';
  purpose: PurelymailRecordPurpose;
}

export const PURELYMAIL_MX_HOST = 'mailserver.purelymail.com';
export const PURELYMAIL_MX_PRIORITY = 50;
export const PURELYMAIL_SPF_CONTENT = 'v=spf1 include:_spf.purelymail.com ~all';
export const PURELYMAIL_DKIM_SELECTORS = Object.freeze([
  Object.freeze({ name: 'purelymail1._domainkey', content: 'key1.dkimroot.purelymail.com' }),
  Object.freeze({ name: 'purelymail2._domainkey', content: 'key2.dkimroot.purelymail.com' }),
  Object.freeze({ name: 'purelymail3._domainkey', content: 'key3.dkimroot.purelymail.com' })
]);
export const PURELYMAIL_DMARC_NAME = '_dmarc';
export const PURELYMAIL_DMARC_CONTENT = 'dmarcroot.purelymail.com';
/** Records in a fully published domain. */
export const PURELYMAIL_RECORD_COUNT = 7;

export interface PurelymailRecordsInput {
  /** The mail domain, e.g. `example.com` or `mail.example.com`. */
  domain: string;
  /** The zone the names are relative to. Default: `domain` itself. */
  zone?: string;
  /** From `getOwnershipCode()`. Null or empty leaves the ownership record out. */
  ownershipCode?: string | null;
}

const record = (
  type: PurelymailDnsRecord['type'],
  name: string,
  content: string,
  purpose: PurelymailRecordPurpose,
  priority: number | null = null
): PurelymailDnsRecord => ({ type, name, content, ttlSeconds: null, priority, proxied: false, purpose });

/**
 * The records a domain needs, named relative to `zone`: `@`, `_dmarc` and
 * `purelymail1._domainkey` for the zone's own apex, `mail`,
 * `_dmarc.mail` and so on for `mail.example.com` in `example.com`.
 *
 * Without an ownership code the six other records are returned; they can be
 * published while the code is fetched. The ownership record comes last. Each
 * call returns new objects.
 */
export function purelymailDnsRecords(input: PurelymailRecordsInput): PurelymailDnsRecord[] {
  const domain = toFqdn(input.domain, input.domain);
  const zone = toFqdn(input.zone ?? domain, input.zone ?? domain);
  if (domain === '' || (domain !== zone && !domain.endsWith(`.${zone}`))) {
    throw new RangeError(`${input.domain} is not inside the zone ${input.zone ?? ''}`);
  }
  const at = (label: string | null): string =>
    toRelativeName(label === null ? domain : `${label}.${domain}`, zone);
  const records = [
    record('MX', at(null), PURELYMAIL_MX_HOST, 'mx', PURELYMAIL_MX_PRIORITY),
    record('TXT', at(null), PURELYMAIL_SPF_CONTENT, 'spf'),
    ...PURELYMAIL_DKIM_SELECTORS.map((selector) => record('CNAME', at(selector.name), selector.content, 'dkim')),
    record('CNAME', at(PURELYMAIL_DMARC_NAME), PURELYMAIL_DMARC_CONTENT, 'dmarc')
  ];
  if (input.ownershipCode !== undefined && input.ownershipCode !== null && input.ownershipCode !== '') {
    records.push(record('TXT', at(null), input.ownershipCode, 'ownership'));
  }
  return records;
}
