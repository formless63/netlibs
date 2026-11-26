import { z } from 'zod';

/** Purelymail's own check of a domain's DNS. Absent or non-boolean values are false. */
export interface PurelymailDnsSummary {
  passesMx: boolean;
  passesSpf: boolean;
  passesDkim: boolean;
  passesDmarc: boolean;
}

export interface PurelymailDomain {
  name: string;
  /**
   * Whether the domain can reset the account's admin password. Purelymail warns
   * that anyone controlling the domain's DNS could then take over the account.
   */
  allowAccountReset: boolean;
  symbolicSubaddressing: boolean;
  /** A Purelymail-owned shared domain. */
  isShared: boolean;
  dns: PurelymailDnsSummary;
}

/** How an alias or catch-all is expressed. */
export interface PurelymailRoutingRule {
  /** An int64 in the API; the only argument `deleteRoutingRule` takes. */
  id: number;
  domainName: string;
  /** `matchUser` is a prefix rather than the whole local part. */
  prefix: boolean;
  /** Local part, e.g. `abuse`; empty for a catch-all. */
  matchUser: string;
  targetAddresses: string[];
  /** Does not fire when the address belongs to a real user. */
  catchall: boolean;
}

const flag = z.unknown().optional().transform((value) => value === true);
const name = z.string().min(1);

export const domainSchema = z.object({
  name,
  allowAccountReset: flag,
  symbolicSubaddressing: flag,
  isShared: flag,
  dnsSummary: z
    .unknown()
    .optional()
    .transform((value) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}))
    .pipe(z.object({ passesMx: flag, passesSpf: flag, passesDkim: flag, passesDmarc: flag }))
});

export const routingRuleSchema = z.object({
  id: z.number().refine(Number.isFinite),
  domainName: name,
  prefix: flag,
  matchUser: z.unknown().optional().transform((value) => (typeof value === 'string' ? value : '')),
  targetAddresses: z
    .unknown()
    .optional()
    .transform((value) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [])),
  catchall: flag
});

export function toDomain(row: z.infer<typeof domainSchema>): PurelymailDomain {
  const { dnsSummary, ...rest } = row;
  return { ...rest, dns: dnsSummary };
}
