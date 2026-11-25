import { normalizeHostname, normalizeNameservers, normalizeStatuses } from '@formless63/domain-intel';
import { z } from 'zod';

import { RdapError } from './errors.ts';

/** One RDAP domain answer. `null` means the server did not say. */
export interface RdapDomain {
  name: string;
  /** The RDAP URL that answered. */
  url: string;
  registrar: string | null;
  registrarIanaId: string | null;
  /** ISO calendar dates (UTC). */
  registeredOn: string | null;
  expiresOn: string | null;
  lastChangedOn: string | null;
  /** RDAP wording, lower-case, sorted. */
  status: string[];
  /** Lower-case, no trailing dot, sorted. */
  nameservers: string[];
  dnssec: boolean | null;
  /** True when the registrant is redacted or behind a privacy service. */
  privacy: boolean | null;
}

interface Remark {
  title?: string | undefined;
  description?: string[] | undefined;
}
interface Entity {
  roles?: string[] | undefined;
  vcardArray?: unknown;
  publicIds?: Array<{ type?: string | undefined; identifier?: string | undefined }> | undefined;
  remarks?: Remark[] | undefined;
  entities?: Entity[] | undefined;
}

const remarksSchema = z
  .array(z.looseObject({ title: z.string().optional(), description: z.array(z.string()).optional() }))
  .optional();

const entitySchema: z.ZodType<Entity> = z.lazy(() =>
  z.looseObject({
    roles: z.array(z.string()).optional(),
    vcardArray: z.unknown().optional(),
    publicIds: z
      .array(z.looseObject({ type: z.string().optional(), identifier: z.string().optional() }))
      .optional(),
    remarks: remarksSchema,
    entities: z.array(entitySchema).optional()
  })
);

const domainSchema = z.looseObject({
  objectClassName: z.string().optional(),
  ldhName: z.string().optional(),
  status: z.array(z.string()).optional(),
  events: z
    .array(z.looseObject({ eventAction: z.string().optional(), eventDate: z.string().optional() }))
    .optional(),
  nameservers: z.array(z.looseObject({ ldhName: z.string().optional() })).optional(),
  secureDNS: z.looseObject({ delegationSigned: z.boolean().optional() }).optional(),
  entities: z.array(entitySchema).optional(),
  remarks: remarksSchema,
  /** RFC 9537. */
  redacted: z
    .array(
      z.looseObject({
        name: z.looseObject({ description: z.string().optional(), type: z.string().optional() }).optional()
      })
    )
    .optional()
});

function isoDate(value: string | undefined): string | null {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

function vcardProperties(vcard: unknown): unknown[][] {
  if (!Array.isArray(vcard) || !Array.isArray(vcard[1])) return [];
  return (vcard[1] as unknown[]).filter((property): property is unknown[] => Array.isArray(property));
}

function vcardName(vcard: unknown): string | null {
  for (const property of vcardProperties(vcard)) {
    const value = property[3];
    if (property[0] === 'fn' && typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function vcardText(vcard: unknown): string {
  return vcardProperties(vcard)
    .flatMap((property) => property.slice(3).flat(2))
    .filter((value) => typeof value === 'string')
    .join(' ');
}

function remarkText(remarks: readonly Remark[] | undefined): string {
  return (remarks ?? [])
    .map((remark) => `${remark.title ?? ''} ${(remark.description ?? []).join(' ')}`)
    .join(' ');
}

const PRIVACY =
  /redacted|privacy|private|withheld|proxy|protect|whoisguard|data protected|not disclosed/i;

function flatten(entities: readonly Entity[] | undefined): Entity[] {
  return (entities ?? []).flatMap((entity) => [entity, ...flatten(entity.entities)]);
}

function registrantPrivacy(domain: z.infer<typeof domainSchema>, entities: Entity[]): boolean | null {
  const marked = (domain.redacted ?? []).some((entry) =>
    /registrant/i.test(`${entry.name?.description ?? ''} ${entry.name?.type ?? ''}`)
  );
  if (marked) return true;
  const registrant = entities.find((entity) => entity.roles?.includes('registrant'));
  if (registrant) {
    // Registries blank the values of a redacted registrant rather than omit it.
    if (vcardName(registrant.vcardArray) === null) return true;
    return PRIVACY.test(`${vcardText(registrant.vcardArray)} ${remarkText(registrant.remarks)}`);
  }
  return PRIVACY.test(remarkText(domain.remarks)) ? true : null;
}

/** Normalizes one RDAP domain object (RFC 9083). Throws `invalid_response` for anything else. */
export function normalizeRdapDomain(payload: unknown, url: string, requested?: string): RdapDomain {
  const parsed = domainSchema.safeParse(payload);
  if (!parsed.success || (parsed.data.objectClassName ?? 'domain') !== 'domain') {
    throw new RdapError({
      kind: 'invalid_response',
      message: 'the RDAP server did not answer with a domain object'
    });
  }
  const domain = parsed.data;
  const entities = flatten(domain.entities);
  const registrar = entities.find((entity) => entity.roles?.includes('registrar'));
  const ianaId = registrar?.publicIds?.find((id) => /iana/i.test(id.type ?? ''))?.identifier?.trim();
  const event = (action: string): string | null =>
    isoDate(domain.events?.find((entry) => entry.eventAction?.toLowerCase() === action)?.eventDate);
  return {
    name: normalizeHostname(domain.ldhName ?? requested ?? ''),
    url,
    registrar: registrar ? vcardName(registrar.vcardArray) : null,
    registrarIanaId: ianaId || null,
    registeredOn: event('registration'),
    expiresOn: event('expiration'),
    lastChangedOn: event('last changed'),
    status: normalizeStatuses(domain.status ?? []).slice(0, 30),
    nameservers: normalizeNameservers((domain.nameservers ?? []).map((ns) => ns.ldhName ?? '')).slice(0, 30),
    dnssec: domain.secureDNS?.delegationSigned ?? null,
    privacy: registrantPrivacy(domain, entities)
  };
}
