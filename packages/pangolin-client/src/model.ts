import { z } from 'zod';

export interface PangolinOrg {
  orgId: string;
  name: string | null;
}

/** A site (tunnel endpoint). Keys are never included. */
export interface PangolinSite {
  siteId: number | null;
  niceId: string | null;
  orgId: string | null;
  name: string | null;
  type: string | null;
  online: boolean;
  address: string | null;
  subnet: string | null;
  endpoint: string | null;
  listenPort: number | null;
  status: string | null;
}

/** A published resource. `sso` and `emailWhitelistEnabled` report presence only. */
export interface PangolinResource {
  resourceId: number | null;
  niceId: string | null;
  orgId: string | null;
  name: string | null;
  subdomain: string | null;
  fullDomain: string | null;
  domainId: string | null;
  mode: string | null;
  ssl: boolean;
  enabled: boolean;
  blockAccess: boolean;
  sso: boolean | null;
  emailWhitelistEnabled: boolean | null;
  applyRules: boolean | null;
  health: string | null;
  targets: PangolinEmbeddedTarget[];
}

/** A target as embedded in a resource list row. */
export interface PangolinEmbeddedTarget {
  targetId: number | null;
  siteId: number | null;
  siteName: string | null;
  ip: string | null;
  port: number | null;
  enabled: boolean;
  healthStatus: string | null;
}

export interface PangolinTarget {
  targetId: number | null;
  resourceId: number | null;
  siteId: number | null;
  ip: string | null;
  port: number | null;
  method: string | null;
  mode: string | null;
  enabled: boolean;
  path: string | null;
  pathMatchType: string | null;
  priority: number | null;
}

/** An access rule, in the API's own vocabulary. */
export interface PangolinRule {
  ruleId: number | null;
  resourceId: number | null;
  action: string | null;
  match: string | null;
  value: string | null;
  priority: number | null;
  enabled: boolean;
}

export interface PangolinDomain {
  domainId: string | null;
  orgId: string | null;
  baseDomain: string | null;
  type: string | null;
  verified: boolean;
  failed: boolean;
  tries: number | null;
  configManaged: boolean;
  certResolver: string | null;
  preferWildcardCert: boolean | null;
}

export interface PangolinDnsRecord {
  id: number | null;
  domainId: string | null;
  recordType: string | null;
  baseDomain: string | null;
  value: string | null;
  verified: boolean;
}

/** Some builds serialize SQLite booleans as 0/1 beside JSON booleans. */
const looseBoolean = z.union([z.boolean(), z.number()]).transform((value) => value === true || (typeof value === 'number' && value !== 0));

// Every field is optional: a renamed or missing one degrades to null instead of
// losing the row.

const orgSchema = z.object({
  orgId: z.string(),
  name: z.string().optional(),
});

const siteSchema = z.object({
  siteId: z.union([z.number(), z.string()]).optional(),
  niceId: z.string().optional(),
  orgId: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  online: looseBoolean.optional(),
  address: z.string().nullable().optional(),
  subnet: z.string().nullable().optional(),
  endpoint: z.string().nullable().optional(),
  listenPort: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
});

const resourceSchema = z.object({
  resourceId: z.union([z.number(), z.string()]).optional(),
  niceId: z.string().optional(),
  orgId: z.string().optional(),
  name: z.string().optional(),
  subdomain: z.string().nullable().optional(),
  fullDomain: z.string().nullable().optional(),
  domainId: z.string().nullable().optional(),
  mode: z.string().optional(),
  ssl: looseBoolean.optional(),
  enabled: looseBoolean.optional(),
  blockAccess: looseBoolean.optional(),
  sso: looseBoolean.nullable().optional(),
  emailWhitelistEnabled: looseBoolean.nullable().optional(),
  applyRules: looseBoolean.nullable().optional(),
  health: z.string().nullable().optional(),
  targets: z.array(z.unknown()).nullable().optional(),
});

const embeddedTargetSchema = z.object({
  targetId: z.union([z.number(), z.string()]).optional(),
  siteId: z.union([z.number(), z.string()]).nullable().optional(),
  siteName: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
  port: z.number().nullable().optional(),
  enabled: looseBoolean.optional(),
  healthStatus: z.string().nullable().optional(),
});

const targetSchema = z.object({
  targetId: z.union([z.number(), z.string()]).optional(),
  resourceId: z.union([z.number(), z.string()]).nullable().optional(),
  siteId: z.union([z.number(), z.string()]).nullable().optional(),
  ip: z.string().optional(),
  port: z.number().optional(),
  method: z.string().nullable().optional(),
  mode: z.string().optional(),
  enabled: looseBoolean.optional(),
  path: z.string().nullable().optional(),
  pathMatchType: z.string().nullable().optional(),
  priority: z.number().optional(),
});

const ruleSchema = z.object({
  ruleId: z.union([z.number(), z.string()]).optional(),
  resourceId: z.union([z.number(), z.string()]).nullable().optional(),
  action: z.string().optional(),
  match: z.string().optional(),
  value: z.string().optional(),
  priority: z.number().optional(),
  enabled: looseBoolean.optional(),
});

const domainSchema = z.object({
  domainId: z.string().optional(),
  orgId: z.string().optional(),
  baseDomain: z.string().optional(),
  type: z.string().nullable().optional(),
  verified: looseBoolean.optional(),
  failed: looseBoolean.optional(),
  tries: z.number().nullable().optional(),
  configManaged: looseBoolean.optional(),
  certResolver: z.string().nullable().optional(),
  preferWildcardCert: looseBoolean.nullable().optional(),
});

const dnsRecordSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  domainId: z.string().optional(),
  recordType: z.string().optional(),
  baseDomain: z.string().nullable().optional(),
  value: z.string().optional(),
  verified: looseBoolean.optional(),
});


function toNumberOrNull(value: number | string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseOrg(raw: unknown): PangolinOrg | null {
  const parsed = orgSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { orgId: parsed.data.orgId, name: parsed.data.name ?? null };
}

export function parseSite(raw: unknown): PangolinSite | null {
  const parsed = siteSchema.safeParse(raw);
  if (!parsed.success) return null;
  const v = parsed.data;
  return {
    siteId: toNumberOrNull(v.siteId),
    niceId: v.niceId ?? null,
    orgId: v.orgId ?? null,
    name: v.name ?? null,
    type: v.type ?? null,
    online: v.online ?? false,
    address: v.address ?? null,
    subnet: v.subnet ?? null,
    endpoint: v.endpoint ?? null,
    listenPort: v.listenPort ?? null,
    status: v.status ?? null,
  };
}

export function parseResource(raw: unknown): PangolinResource | null {
  const parsed = resourceSchema.safeParse(raw);
  if (!parsed.success) return null;
  const v = parsed.data;
  return {
    resourceId: toNumberOrNull(v.resourceId),
    niceId: v.niceId ?? null,
    orgId: v.orgId ?? null,
    name: v.name ?? null,
    subdomain: v.subdomain ?? null,
    fullDomain: v.fullDomain ?? null,
    domainId: v.domainId ?? null,
    mode: v.mode ?? null,
    ssl: v.ssl ?? false,
    enabled: v.enabled ?? false,
    blockAccess: v.blockAccess ?? false,
    sso: v.sso ?? null,
    emailWhitelistEnabled: v.emailWhitelistEnabled ?? null,
    applyRules: v.applyRules ?? null,
    health: v.health ?? null,
    targets: (v.targets ?? []).flatMap((raw) => {
      const t = embeddedTargetSchema.safeParse(raw);
      if (!t.success) return [];
      return [
        {
          targetId: toNumberOrNull(t.data.targetId),
          siteId: toNumberOrNull(t.data.siteId ?? undefined),
          siteName: t.data.siteName ?? null,
          ip: t.data.ip ?? null,
          port: t.data.port ?? null,
          enabled: t.data.enabled ?? false,
          healthStatus: t.data.healthStatus ?? null,
        },
      ];
    }),
  };
}

export function parseTarget(raw: unknown): PangolinTarget | null {
  const parsed = targetSchema.safeParse(raw);
  if (!parsed.success) return null;
  const v = parsed.data;
  return {
    targetId: toNumberOrNull(v.targetId),
    resourceId: toNumberOrNull(v.resourceId ?? undefined),
    siteId: toNumberOrNull(v.siteId ?? undefined),
    ip: v.ip ?? null,
    port: v.port ?? null,
    method: v.method ?? null,
    mode: v.mode ?? null,
    enabled: v.enabled ?? false,
    path: v.path ?? null,
    pathMatchType: v.pathMatchType ?? null,
    priority: v.priority ?? null,
  };
}

export function parseRule(raw: unknown): PangolinRule | null {
  const parsed = ruleSchema.safeParse(raw);
  if (!parsed.success) return null;
  const v = parsed.data;
  return {
    ruleId: toNumberOrNull(v.ruleId),
    resourceId: toNumberOrNull(v.resourceId ?? undefined),
    action: v.action ?? null,
    match: v.match ?? null,
    value: v.value ?? null,
    priority: v.priority ?? null,
    enabled: v.enabled ?? false,
  };
}

export function parseDomain(raw: unknown): PangolinDomain | null {
  const parsed = domainSchema.safeParse(raw);
  if (!parsed.success) return null;
  const v = parsed.data;
  return {
    domainId: v.domainId ?? null,
    orgId: v.orgId ?? null,
    baseDomain: v.baseDomain ?? null,
    type: v.type ?? null,
    verified: v.verified ?? false,
    failed: v.failed ?? false,
    tries: v.tries ?? null,
    configManaged: v.configManaged ?? false,
    certResolver: v.certResolver ?? null,
    preferWildcardCert: v.preferWildcardCert ?? null,
  };
}

export function parseDnsRecord(raw: unknown): PangolinDnsRecord | null {
  const parsed = dnsRecordSchema.safeParse(raw);
  if (!parsed.success) return null;
  const v = parsed.data;
  return {
    id: toNumberOrNull(v.id),
    domainId: v.domainId ?? null,
    recordType: v.recordType ?? null,
    baseDomain: v.baseDomain ?? null,
    value: v.value ?? null,
    verified: v.verified ?? false,
  };
}

